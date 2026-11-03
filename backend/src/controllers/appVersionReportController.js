const User = require("../models/User");
const UserAppVersion = require("../models/UserAppVersion");

// POST /account/app-version — the app reports its own version on
// launch/login. Best-effort from the app's side: a failure here must
// never block sign-in, so the app swallows errors.
async function reportAppVersion(req, res) {
    try {
        const { appVersion, appVersionCode, platform } = req.body || {};
        const code = Number(appVersionCode);

        if (
            typeof appVersion !== "string" ||
            !appVersion.trim() ||
            appVersion.trim().length > 50 ||
            !Number.isInteger(code) ||
            code < 1 ||
            code > 999999 ||
            (platform !== undefined && !["android", "ios"].includes(platform))
        ) {
            return res.status(400).json({
                success: false,
                message: "Invalid app version",
            });
        }

        await UserAppVersion.findOneAndUpdate(
            { userId: req.user._id },
            {
                $set: {
                    appVersion: appVersion.trim(),
                    appVersionCode: code,
                    platform: platform || "android",
                    updatedAt: new Date(),
                },
            },
            { upsert: true, runValidators: true }
        );

        return res.json({ success: true });
    } catch (error) {
        console.error("App version report error:", error.message);
        return res.status(500).json({
            success: false,
            message: "Unable to record app version",
        });
    }
}

// GET /admin/app-version/usage — how many users are on each version.
// "Unknown" = registered non-admin users with no report yet (builds
// older than the reporting feature, or users who never opened a
// reporting build).
async function getVersionUsage(req, res) {
    try {
        const [versions, totalUsers] = await Promise.all([
            UserAppVersion.aggregate([
                {
                    $group: {
                        _id: {
                            appVersionCode: "$appVersionCode",
                            appVersion: "$appVersion",
                        },
                        users: { $sum: 1 },
                    },
                },
                { $sort: { "_id.appVersionCode": -1 } },
            ]),
            User.countDocuments({ role: { $ne: "ADMIN" } }),
        ]);

        const reportedUsers = versions.reduce(
            (sum, row) => sum + row.users,
            0
        );

        return res.json({
            success: true,
            versions: versions.map((row) => ({
                appVersion: row._id.appVersion,
                appVersionCode: row._id.appVersionCode,
                users: row.users,
            })),
            totalUsers,
            reportedUsers,
            unknownUsers: Math.max(0, totalUsers - reportedUsers),
        });
    } catch (error) {
        console.error("App version usage error:", error.message);
        return res.status(500).json({
            success: false,
            message: "Unable to load version usage",
        });
    }
}

module.exports = { reportAppVersion, getVersionUsage };
