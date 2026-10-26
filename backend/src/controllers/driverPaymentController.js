const crypto = require("crypto");
const Driver = require("../models/Driver");
const PaymentOrder = require("../models/PaymentOrder");
const PaymentGatewayConfig = require("../models/PaymentGatewayConfig");
const CommissionSettings = require("../models/CommissionSettings");
const { decryptCredentials } = require("../services/paymentCredentialEncryption");
const { createJazzCashCheckout } = require("../services/jazzCashPaymentService");

const PROVIDERS = [
    "JAZZCASH",
    "EASYPAISA",
    "UBL",
    "BANK_TRANSFER",
];

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

        if (provider !== "JAZZCASH") {
            return res.status(501).json({
                success: false,
                message: "This payment provider is not integrated yet.",
            });
        }

        const environment =
            settings.paymentEnvironment === "LIVE" ? "LIVE" : "TEST";

        const config = await PaymentGatewayConfig.findOne({
            provider: "JAZZCASH",
            enabled: true,
            environment,
            ...(environment === "LIVE" ? { verified: true } : {}),
        }).select("+encryptedCredentials").lean();

        if (!config) {
            return res.status(503).json({
                success: false,
                message: "Yeh payment method abhi available nahi hai.",
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

        if (
            typeof process.env.PAYMENT_RETURN_URL !== "string" ||
            !process.env.PAYMENT_RETURN_URL.trim() ||
            typeof process.env.PAYMENT_RESULT_URL !== "string" ||
            !process.env.PAYMENT_RESULT_URL.trim()
        ) {
            return res.status(503).json({
                success: false,
                message: "Payment return URLs are not configured.",
            });
        }

        const existingOrder = await PaymentOrder.findOne({
            driverId: driver._id,
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

            checkout = createJazzCashCheckout({
                order,
                credentials,
                returnUrl: process.env.PAYMENT_RETURN_URL,
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
            .select("onlineTopUpEnabled paymentGateway paymentEnvironment")
            .lean();

        if (
            settings?.onlineTopUpEnabled !== true ||
            !["JAZZCASH", "SANDBOX"].includes(settings.paymentGateway)
        ) {
            return res.json({ success: true, methods: [] });
        }

        const environment =
            settings.paymentEnvironment === "LIVE" ? "LIVE" : "TEST";

        const gateway = await PaymentGatewayConfig.findOne({
            provider: "JAZZCASH",
            enabled: true,
            environment,
            ...(environment === "LIVE" ? { verified: true } : {}),
        })
            .select("provider environment")
            .lean();

        return res.json({
            success: true,
            methods: gateway
                ? [{
                    provider: gateway.provider,
                    environment: gateway.environment,
                }]
                : [],
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