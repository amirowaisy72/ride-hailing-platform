const CommissionSettings = require("../models/CommissionSettings");
const PaymentGatewayConfig = require("../models/PaymentGatewayConfig");

async function getCommissionSettings(req, res) {
    try {
        const settings = await CommissionSettings.findOne({
            key: "GLOBAL",
        }).lean();

        return res.json({
            success: true,
            settings: settings || null,
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: "Unable to load commission settings",
        });
    }
}

async function updateCommissionSettings(req, res) {
    try {
        const {
            percentage,
            minimumWalletBalance,
            topUpRequired,
            paymentGateway,
            paymentEnvironment,
            paymentReturnUrl,
            paymentResultUrl,
            bankName,
            bankAccountTitle,
            bankAccountNumber,
            bankTransferNote,
            onlineTopUpEnabled,
            isActive,
            freeWaitingMinutes,
            waitingChargePerMinute,
        } = req.body || {};

        if (
            typeof percentage !== "number" ||
            !Number.isFinite(percentage) ||
            percentage < 0 ||
            percentage > 100 ||
            Math.round(percentage * 100) !== percentage * 100 ||
            !Number.isSafeInteger(minimumWalletBalance) ||
            minimumWalletBalance < 0 ||
            (topUpRequired !== undefined && typeof topUpRequired !== "boolean") ||
            (paymentGateway !== undefined &&
                !["DISABLED", "SANDBOX", "JAZZCASH", "EASYPAISA", "UBL", "BANK_TRANSFER"].includes(paymentGateway)) ||
            (paymentGateway === "SANDBOX" &&
                paymentEnvironment === "LIVE") ||
            (paymentEnvironment !== undefined &&
                !["TEST", "LIVE"].includes(paymentEnvironment)) ||
            (onlineTopUpEnabled !== undefined &&
                typeof onlineTopUpEnabled !== "boolean") ||
            !Number.isInteger(freeWaitingMinutes) ||
            freeWaitingMinutes < 0 ||
            freeWaitingMinutes > 120 ||
            typeof waitingChargePerMinute !== "number" ||
            !Number.isFinite(waitingChargePerMinute) ||
            waitingChargePerMinute < 0 ||
            typeof isActive !== "boolean"
        ) {
            return res.status(400).json({
                success: false,
                message: "Invalid commission configuration",
            });
        }

        if (topUpRequired === true) {
            const verifiedGateway = await PaymentGatewayConfig.exists({
                enabled: true,
                verified: true,
            });

            if (!verifiedGateway) {
                return res.status(400).json({
                    success: false,
                    message: "Top-up Required ON karne se pehle payment gateway verify aur enable karna zaroori hai.",
                });
            }
        }

        // Optional receiving-bank fields for manual bank-transfer
        // top-ups. Empty string clears a field.
        for (const [field, value, max] of [
            ["bankName", bankName, 120],
            ["bankAccountTitle", bankAccountTitle, 120],
            ["bankAccountNumber", bankAccountNumber, 64],
            ["bankTransferNote", bankTransferNote, 500],
        ]) {
            if (value === undefined) continue;

            if (typeof value !== "string" || value.length > max) {
                return res.status(400).json({
                    success: false,
                    message: `Invalid ${field}`,
                });
            }
        }

        // Optional dashboard-managed payment URLs. Empty string clears
        // the value (consumers then fall back to the environment).
        for (const [field, value] of [
            ["paymentReturnUrl", paymentReturnUrl],
            ["paymentResultUrl", paymentResultUrl],
        ]) {
            if (value === undefined) continue;

            if (typeof value !== "string" || value.length > 500) {
                return res.status(400).json({
                    success: false,
                    message: `Invalid ${field}`,
                });
            }

            const trimmed = value.trim();

            if (!trimmed) continue;

            let parsed;

            try {
                parsed = new URL(trimmed);
            } catch {
                return res.status(400).json({
                    success: false,
                    message: `Invalid ${field}`,
                });
            }

            if (field === "paymentReturnUrl") {
                if (
                    parsed.protocol !== "https:" ||
                    parsed.pathname !==
                        "/api/v1/payments/jazzcash/callback"
                ) {
                    return res.status(400).json({
                        success: false,
                        message:
                            "Payment return URL must be the HTTPS JazzCash callback URL of this backend.",
                    });
                }
            } else {
                const isAppReturn =
                    parsed.protocol === "com.safar.ridehailing:" &&
                    parsed.hostname === "driver" &&
                    parsed.pathname === "/earnings";

                const isLocalhost =
                    parsed.hostname === "localhost" &&
                    ["http:", "https:"].includes(parsed.protocol);

                if (
                    parsed.protocol !== "https:" &&
                    !isAppReturn &&
                    !isLocalhost
                ) {
                    return res.status(400).json({
                        success: false,
                        message: "Invalid payment result URL",
                    });
                }
            }
        }

        const settings = await CommissionSettings.findOneAndUpdate(
            { key: "GLOBAL" },
            {
                $set: {
                    percentage,
                    minimumWalletBalance,
                    ...(topUpRequired !== undefined ? { topUpRequired } : {}),
                    ...(paymentGateway !== undefined ? { paymentGateway } : {}),
                    onlineTopUpEnabled: onlineTopUpEnabled ?? false,
                    // Environment comes from the dashboard (TEST/LIVE).
                    // It is only changed when the admin sends it; the
                    // schema default keeps new settings at TEST.
                    ...(paymentEnvironment !== undefined ? { paymentEnvironment } : {}),
                    ...(paymentReturnUrl !== undefined
                        ? { paymentReturnUrl: paymentReturnUrl.trim() }
                        : {}),
                    ...(paymentResultUrl !== undefined
                        ? { paymentResultUrl: paymentResultUrl.trim() }
                        : {}),
                    ...(bankName !== undefined
                        ? { bankName: bankName.trim() }
                        : {}),
                    ...(bankAccountTitle !== undefined
                        ? { bankAccountTitle: bankAccountTitle.trim() }
                        : {}),
                    ...(bankAccountNumber !== undefined
                        ? { bankAccountNumber: bankAccountNumber.trim() }
                        : {}),
                    ...(bankTransferNote !== undefined
                        ? { bankTransferNote: bankTransferNote.trim() }
                        : {}),
                    isActive,
                    freeWaitingMinutes,
                    waitingChargePerMinute,
                    updatedBy: req.user._id,
                },
                $setOnInsert: {
                    key: "GLOBAL",
                },
            },
            {
                new: true,
                upsert: true,
                runValidators: true,
            }
        );

        return res.json({
            success: true,
            settings,
            message: "Commission settings updated",
        });
    } catch (error) {
        console.error("Commission settings error:", error.message);

        return res.status(500).json({
            success: false,
            message: "Unable to update commission settings",
        });
    }
}

module.exports = {
    getCommissionSettings,
    updateCommissionSettings,
};