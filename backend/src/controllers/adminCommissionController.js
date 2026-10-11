const CommissionSettings = require("../models/CommissionSettings");

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
            isActive,
        } = req.body || {};

        if (
            typeof percentage !== "number" ||
            !Number.isFinite(percentage) ||
            percentage < 0 ||
            percentage > 100 ||
            Math.round(percentage * 100) !== percentage * 100 ||
            !Number.isSafeInteger(minimumWalletBalance) ||
            minimumWalletBalance < 0 ||
            typeof isActive !== "boolean"
        ) {
            return res.status(400).json({
                success: false,
                message: "Invalid commission configuration",
            });
        }

        const settings = await CommissionSettings.findOneAndUpdate(
            { key: "GLOBAL" },
            {
                $set: {
                    percentage,
                    minimumWalletBalance,
                    isActive,
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