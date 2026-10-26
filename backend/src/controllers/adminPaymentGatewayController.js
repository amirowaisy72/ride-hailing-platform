const PaymentGatewayConfig = require("../models/PaymentGatewayConfig");
const {
    encryptCredentials,
} = require("../services/paymentCredentialEncryption");

const PROVIDERS = [
    "JAZZCASH",
    "EASYPAISA",
    "UBL",
    "BANK_TRANSFER",
];

async function listPaymentGateways(req, res) {
    try {
        const configs = await PaymentGatewayConfig.find({})
            .select("+encryptedCredentials")
            .sort({ provider: 1 })
            .lean();

        return res.json({
            success: true,
            gateways: configs.map((config) => ({
                provider: config.provider,
                environment: config.environment,
                enabled: config.enabled,
                verified: config.verified,
                configured: Boolean(config.encryptedCredentials),
                verifiedAt: config.verifiedAt,
            })),
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: "Unable to load payment gateway settings",
        });
    }
}

async function savePaymentGateway(req, res) {
    try {
        const { provider, environment, credentials } = req.body || {};

        if (
            !PROVIDERS.includes(provider) ||
            !["TEST", "LIVE"].includes(environment) ||
            !credentials ||
            typeof credentials !== "object" ||
            Array.isArray(credentials) ||
            Object.keys(credentials).length === 0 ||
            Object.entries(credentials).some(
                ([key, value]) =>
                    !/^[a-zA-Z0-9_]{1,80}$/.test(key) ||
                    typeof value !== "string" ||
                    !value.trim() ||
                    value.length > 2000
            )
        ) {
            return res.status(400).json({
                success: false,
                message: "Valid provider, environment and credentials are required",
            });
        }

        if (provider === "JAZZCASH") {
            const requiredFields = [
                "merchantId",
                "password",
                "integritySalt",
                "paymentUrl",
                "transactionType",
            ];

            if (
                requiredFields.some(
                    (key) =>
                        typeof credentials[key] !== "string" ||
                        !credentials[key].trim()
                )
            ) {
                return res.status(400).json({
                    success: false,
                    message: "All JazzCash merchant credential fields are required.",
                });
            }

            let gatewayUrl;

            try {
                gatewayUrl = new URL(credentials.paymentUrl);
            } catch {
                return res.status(400).json({
                    success: false,
                    message: "Invalid JazzCash payment URL.",
                });
            }

            const allowedHosts = [
                "sandbox.jazzcash.com.pk",
                "payments.jazzcash.com.pk",
            ];

            if (
                gatewayUrl.protocol !== "https:" ||
                !allowedHosts.includes(gatewayUrl.hostname) ||
                !["MWALLET", "OTC", "MPAY"].includes(credentials.transactionType)
            ) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid JazzCash URL or transaction type.",
                });
            }
        }

        const encryptedCredentials = encryptCredentials(credentials);

        const config = await PaymentGatewayConfig.findOneAndUpdate(
            { provider },
            {
                $set: {
                    environment,
                    encryptedCredentials,
                    enabled: provider === "JAZZCASH" && environment === "TEST",
                    verified: false,
                    verifiedAt: null,
                    updatedBy: req.user._id,
                },
                $setOnInsert: {
                    provider,
                },
            },
            {
                upsert: true,
                new: true,
                runValidators: true,
            }
        );

        return res.json({
            success: true,
            message: "Gateway credentials saved securely. Gateway remains disabled until verified.",
            gateway: {
                provider: config.provider,
                environment: config.environment,
                enabled: config.enabled,
                verified: config.verified,
                configured: true,
            },
        });
    } catch (error) {
        return res.status(400).json({
            success: false,
            message: "Unable to save gateway configuration",
        });
    }
}

module.exports = {
    listPaymentGateways,
    savePaymentGateway,
};