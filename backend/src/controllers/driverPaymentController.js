const crypto = require("crypto");
const Driver = require("../models/Driver");
const PaymentOrder = require("../models/PaymentOrder");
const PaymentGatewayConfig = require("../models/PaymentGatewayConfig");
const CommissionSettings = require("../models/CommissionSettings");
const { decryptCredentials } = require("../services/paymentCredentialEncryption");
const { createJazzCashCheckout } = require("../services/jazzCashPaymentService");
const { createEasyPaisaCheckout } = require("../services/easyPaisaPaymentService");
const { createUblCheckout } = require("../services/ublPaymentService");
const {
    getGatewayCallbackUrl,
    bankTransferConfigured,
} = require("../services/paymentsConfigService");

const PROVIDERS = [
    "JAZZCASH",
    "EASYPAISA",
    "UBL",
    "BANK_TRANSFER",
];

const CHECKOUT_BUILDERS = {
    JAZZCASH: createJazzCashCheckout,
    EASYPAISA: createEasyPaisaCheckout,
    UBL: createUblCheckout,
};

async function createTopUpOrder(req, res) {
    try {
        const amount = req.body?.amount;
        const provider = req.body?.provider;

        if (
            !Number.isSafeInteger(amount) ||
            amount < 100 ||
            amount > 1000000 ||
            !PROVIDERS.includes(provider)
        ) {
            return res.status(400).json({
                success: false,
                message: "PKR 100 se 1,000,000 tak valid amount aur payment method select karein.",
            });
        }

        const settings = await CommissionSettings.findOne({
            key: "GLOBAL",
        }).lean();

        if (settings?.onlineTopUpEnabled !== true) {
            return res.status(403).json({
                success: false,
                message: "Online wallet top-up is disabled by Admin.",
            });
        }

        const selectedGateway = settings.paymentGateway;
        const providerAllowed =
            selectedGateway === provider ||
            (selectedGateway === "SANDBOX" && provider === "JAZZCASH");

        if (!providerAllowed) {
            return res.status(403).json({
                success: false,
                message: "This payment method is not enabled by Admin.",
            });
        }

        const driver = await Driver.findOne({
            userId: req.user._id,
            verificationStatus: "APPROVED",
        }).select("_id").lean();

        if (!driver) {
            return res.status(403).json({
                success: false,
                message: "Approved driver account required.",
            });
        }

        const environment =
            settings.paymentEnvironment === "LIVE" ? "LIVE" : "TEST";

        // Bank transfer: no gateway checkout. The order stays PENDING
        // with the platform's receiving-bank details; the driver
        // transfers manually and an admin verifies + credits it from
        // the dashboard (adminPaymentOrderController.verifyBankTransfer).
        if (provider === "BANK_TRANSFER") {
            if (!bankTransferConfigured(settings)) {
                return res.status(503).json({
                    success: false,
                    message: "Bank transfer abhi available nahi hai.",
                });
            }

            const existingBankOrder = await PaymentOrder.findOne({
                driverId: driver._id,
                gateway: "BANK_TRANSFER",
                status: { $in: ["PENDING", "VERIFIED"] },
                expiresAt: { $gt: new Date() },
            }).select("_id").lean();

            if (existingBankOrder) {
                return res.status(409).json({
                    success: false,
                    message: "Aapki ek payment pehle se pending hai. Pehle uska status check karein.",
                    orderId: existingBankOrder._id,
                });
            }

            const bankMerchantTxnReference =
                `SF${Date.now().toString(36).toUpperCase()}${crypto.randomBytes(4).toString("hex").toUpperCase()}`;

            const bankOrder = await PaymentOrder.create({
                merchantTxnReference: bankMerchantTxnReference,
                driverId: driver._id,
                gateway: "BANK_TRANSFER",
                environment,
                amount,
                currency: "PKR",
                status: "PENDING",
                expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000),
            });

            return res.status(201).json({
                success: true,
                message: "Bank transfer order create ho gaya hai. Amount neeche diye gaye account mein transfer karein — admin verification ke baad wallet credit ho jayega.",
                order: {
                    id: bankOrder._id,
                    provider: bankOrder.gateway,
                    amount: bankOrder.amount,
                    currency: bankOrder.currency,
                    status: bankOrder.status,
                    expiresAt: bankOrder.expiresAt,
                },
                bankTransfer: {
                    bankName: settings.bankName,
                    accountTitle: settings.bankAccountTitle,
                    accountNumber: settings.bankAccountNumber,
                    note: settings.bankTransferNote || "",
                    reference: bankMerchantTxnReference,
                },
            });
        }

        const config = await PaymentGatewayConfig.findOne({
            provider,
            enabled: true,
            environment,
        }).select("+encryptedCredentials").lean();

        if (!config) {
            return res.status(503).json({
                success: false,
                message: "Yeh payment method abhi available nahi hai.",
            });
        }

        // Return URL is dashboard-managed (commission settings),
        // with PAYMENT_RETURN_URL and the production callback route
        // as fallbacks — see services/paymentsConfigService.
        const returnUrl = getGatewayCallbackUrl(settings, provider);

        const existingOrder = await PaymentOrder.findOne({
            driverId: driver._id,
            gateway: provider,
            status: { $in: ["PENDING", "VERIFIED"] },
            expiresAt: { $gt: new Date() },
        }).select("_id").lean();

        if (existingOrder) {
            return res.status(409).json({
                success: false,
                message: "Aapki ek payment pehle se pending hai. Pehle uska status check karein.",
                orderId: existingOrder._id,
            });
        }

        const merchantTxnReference =
            `SF${Date.now().toString(36).toUpperCase()}${crypto.randomBytes(4).toString("hex").toUpperCase()}`;

        const order = await PaymentOrder.create({
            merchantTxnReference,
            driverId: driver._id,
            gateway: provider,
            environment,
            amount,
            currency: "PKR",
            status: "PENDING",
            expiresAt: new Date(Date.now() + 15 * 60 * 1000),
        });

        let checkout;

        try {
            const credentials = decryptCredentials(
                config.encryptedCredentials
            );

            checkout = CHECKOUT_BUILDERS[provider]({
                order,
                credentials,
                returnUrl,
            });
        } catch (error) {
            await PaymentOrder.updateOne(
                { _id: order._id, status: "PENDING" },
                {
                    $set: {
                        status: "FAILED",
                        failureReason: "Gateway checkout configuration failed.",
                    },
                }
            );

            throw error;
        }

        return res.status(201).json({
            success: true,
            message: "Payment order created. Payment complete hone ke baad server verification zaroori hai.",
            order: {
                id: order._id,
                provider: order.gateway,
                amount: order.amount,
                currency: order.currency,
                status: order.status,
                expiresAt: order.expiresAt,
            },
            checkout,
        });
    } catch (error) {
        console.error("Top-up order error:", error.message);
        return res.status(500).json({
            success: false,
            message: "Payment order create nahi ho saka.",
        });
    }
}

async function getTopUpOrderStatus(req, res) {
    try {
        const driver = await Driver.findOne({
            userId: req.user._id,
        }).select("_id").lean();

        if (!driver) {
            return res.status(404).json({
                success: false,
                message: "Driver profile not found.",
            });
        }

        const order = await PaymentOrder.findOne({
            _id: req.params.orderId,
            driverId: driver._id,
        }).select(
            "gateway amount currency status expiresAt creditedAt"
        ).lean();

        if (!order) {
            return res.status(404).json({
                success: false,
                message: "Payment order not found.",
            });
        }

        return res.json({
            success: true,
            order,
        });
    } catch {
        return res.status(400).json({
            success: false,
            message: "Invalid payment order request.",
        });
    }
}

async function getAvailableTopUpMethods(req, res) {
    try {
        const settings = await CommissionSettings.findOne({
            key: "GLOBAL",
        })
            .select("onlineTopUpEnabled paymentGateway paymentEnvironment bankName bankAccountTitle bankAccountNumber")
            .lean();

        if (settings?.onlineTopUpEnabled !== true) {
            return res.json({ success: true, methods: [] });
        }

        const environment =
            settings.paymentEnvironment === "LIVE" ? "LIVE" : "TEST";

        const selectedGateway = settings.paymentGateway;

        const providerAllowed = (provider) =>
            selectedGateway === provider ||
            (selectedGateway === "SANDBOX" && provider === "JAZZCASH");

        const methods = [];

        for (const provider of ["JAZZCASH", "EASYPAISA", "UBL"]) {
            if (!providerAllowed(provider)) continue;

            const gateway = await PaymentGatewayConfig.findOne({
                provider,
                enabled: true,
                environment,
            })
                .select("provider environment")
                .lean();

            if (gateway) {
                methods.push({
                    provider: gateway.provider,
                    environment: gateway.environment,
                });
            }
        }

        if (
            providerAllowed("BANK_TRANSFER") &&
            bankTransferConfigured(settings)
        ) {
            methods.push({
                provider: "BANK_TRANSFER",
                environment,
            });
        }

        return res.json({
            success: true,
            methods,
        });
    } catch (error) {
        console.error("Payment methods error:", error.message);
        return res.status(500).json({
            success: false,
            message: "Unable to load available payment methods.",
        });
    }
}

module.exports = {
    createTopUpOrder,
    getTopUpOrderStatus,
    getAvailableTopUpMethods,
};