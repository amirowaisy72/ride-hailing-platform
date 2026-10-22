const PushDevice = require("../models/PushDevice");

async function registerDevice(req, res) {
    try {
        const { token, platform } = req.body || {};

        if (
            typeof token !== "string" ||
            token.length < 20 ||
            token.length > 4096 ||
            !["android", "ios"].includes(platform)
        ) {
            return res.status(400).json({
                success: false,
                message: "Invalid push device",
            });
        }

        await PushDevice.findOneAndUpdate(
            { token },
            {
                $set: {
                    userId: req.user._id,
                    platform,
                    updatedAt: new Date(),
                },
            },
            { upsert: true, runValidators: true }
        );

        return res.json({
            success: true,
            message: "Push device registered",
        });
    } catch (error) {
        console.error("Push registration:", error.message);
        return res.status(500).json({
            success: false,
            message: "Push registration failed",
        });
    }
}

module.exports = { registerDevice };