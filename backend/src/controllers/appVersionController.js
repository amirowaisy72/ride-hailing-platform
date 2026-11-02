const AppVersionConfig = require("../models/AppVersionConfig");

const PLAY_URL =
    "https://play.google.com/store/apps/details?id=com.safar.ridehailing";

async function getAppVersion(req, res) {
    try {
        const config = await AppVersionConfig.findOne({
            platform: "android",
        }).lean();

        if (!config) {
            return res.json({
                success: true,
                configured: false,
                playUrl: PLAY_URL,
            });
        }

        return res.json({
            success: true,
            configured: true,
            latestVersionCode: config.latestVersionCode,
            latestVersionName: config.latestVersionName,
            message: config.message || "",
            playUrl: PLAY_URL,
        });
    } catch (error) {
        console.error("App version read error:", error.message);
        return res.status(500).json({
            success: false,
            message: "Unable to read app version.",
        });
    }
}

async function setAppVersion(req, res) {
    try {
        const { latestVersionCode, latestVersionName, message } =
            req.body || {};

        const code = Number(latestVersionCode);
        if (
            !Number.isInteger(code) ||
            code < 1 ||
            typeof latestVersionName !== "string" ||
            !latestVersionName.trim() ||
            latestVersionName.trim().length > 50 ||
            (message !== undefined &&
                (typeof message !== "string" || message.length > 240))
        ) {
            return res.status(400).json({
                success: false,
                message: "Enter a valid version code, version name and message.",
            });
        }

        const config = await AppVersionConfig.findOneAndUpdate(
            { platform: "android" },
            {
                platform: "android",
                latestVersionCode: code,
                latestVersionName: latestVersionName.trim(),
                message: (message || "").trim(),
            },
            { upsert: true, new: true, runValidators: true }
        ).lean();

        return res.json({
            success: true,
            message: "App version updated.",
            latestVersionCode: config.latestVersionCode,
            latestVersionName: config.latestVersionName,
        });
    } catch (error) {
        console.error("App version save error:", error.message);
        return res.status(500).json({
            success: false,
            message: "Unable to save app version.",
        });
    }
}

module.exports = { getAppVersion, setAppVersion };
