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
            .sort({ provider: 1, environment: 1 })
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

        if (provider === "EASYPAISA") {
            const requiredFields = [
                "storeId",
                "hashKey",
                "paymentUrl",
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
                    message: "All EasyPaisa merchant credential fields are required.",
                });
            }

            let gatewayUrl;

            try {
                gatewayUrl = new URL(credentials.paymentUrl);
            } catch {
                return res.status(400).json({
                    success: false,
                    message: "Invalid EasyPaisa payment URL.",
                });
            }

            const allowedHosts = [
                "easypay.easypaisa.com.pk",
                "easypaystg.easypaisa.com.pk",
            ];

            if (
                gatewayUrl.protocol !== "https:" ||
                !allowedHosts.includes(gatewayUrl.hostname)
            ) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid EasyPaisa URL.",
                });
            }
        }

        if (provider === "UBL") {
            const requiredFields = [
                "merchantId",
                "password",
                "hashKey",
                "paymentUrl",
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
                    message: "All UBL merchant credential fields are required.",
                });
            }

            let gatewayUrl;

            try {
                gatewayUrl = new URL(credentials.paymentUrl);
            } catch {
                return res.status(400).json({
                    success: false,
                    message: "Invalid UBL payment URL.",
                });
            }

            if (gatewayUrl.protocol !== "https:") {
                return res.status(400).json({
                    success: false,
                    message: "Invalid UBL URL.",
                });
            }
        }

        const encryptedCredentials = encryptCredentials(credentials);

        // One document per { provider, environment }: saving LIVE
        // credentials never overwrites the TEST document (and vice
        // versa). Saving always disables the gateway and clears its
        // verification — credentials must be reviewed, then explicitly
        // enabled, and are verified by the first successful callback.
        const config = await PaymentGatewayConfig.findOneAndUpdate(
            { provider, environment },
            {
                $set: {
                    encryptedCredentials,
                    enabled: false,
                    verified: false,
                    verifiedAt: null,
                    updatedBy: req.user._id,
                },
                $setOnInsert: {
                    provider,
                    environment,
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
            message: "Gateway credentials saved securely. Gateway is disabled — enable it from the configured gateways list; it is verified by the first successful payment.",
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

async function setPaymentGatewayEnabled(req, res, enabled) {
    try {
        const { provider, environment } = req.params;

        if (
            !PROVIDERS.includes(provider) ||
            !["TEST", "LIVE"].includes(environment)
        ) {
            return res.status(400).json({
                success: false,
                message: "Valid provider and environment are required",
            });
        }

        const config = await PaymentGatewayConfig.findOne({
            provider,
            environment,
        }).select("+encryptedCredentials");

        if (!config) {
            return res.status(404).json({
                success: false,
                message: "Gateway is not configured for this environment. Save its credentials first.",
            });
        }

        if (enabled && !config.encryptedCredentials) {
            return res.status(400).json({
                success: false,
                message: "Gateway credentials are missing. Save credentials before enabling.",
            });
        }

        config.enabled = enabled;
        config.updatedBy = req.user._id;
        await config.save();

        return res.json({
            success: true,
            message: enabled
                ? "Gateway enabled. It will be marked verified after the first successful payment."
                : "Gateway disabled.",
            gateway: {
                provider: config.provider,
                environment: config.environment,
                enabled: config.enabled,
                verified: config.verified,
                configured: true,
            },
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: "Unable to update gateway status",
        });
    }
}

function enablePaymentGateway(req, res) {
    return setPaymentGatewayEnabled(req, res, true);
}

function disablePaymentGateway(req, res) {
    return setPaymentGatewayEnabled(req, res, false);
}

module.exports = {
    listPaymentGateways,
    savePaymentGateway,
    enablePaymentGateway,
    disablePaymentGateway,
};