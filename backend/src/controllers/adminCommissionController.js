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
                req.body.paymentEnvironment === "LIVE") ||
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

        const settings = await CommissionSettings.findOneAndUpdate(
            { key: "GLOBAL" },
            {
                $set: {
                    percentage,
                    minimumWalletBalance,
                    ...(topUpRequired !== undefined ? { topUpRequired } : {}),
                    ...(paymentGateway !== undefined ? { paymentGateway } : {}),
                    onlineTopUpEnabled: onlineTopUpEnabled ?? false,
                    paymentEnvironment: "TEST",
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