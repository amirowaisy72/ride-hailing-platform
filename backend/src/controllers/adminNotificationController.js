const mongoose = require("mongoose");
const User = require("../models/User");
const PushDevice = require("../models/PushDevice");
const IntegrationSetting = require("../models/IntegrationSetting");
const { sendPushToUser } = require("../services/pushService");

function escapeRegex(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function searchNotificationUsers(req, res) {
    try {
        const query = String(req.query.q || "").trim();

        if (query.length < 2 || query.length > 100) {
            return res.status(400).json({
                success: false,
                message: "Enter at least 2 characters to search.",
            });
        }

        const expression = new RegExp(escapeRegex(query), "i");

        const users = await User.find({
            status: { $ne: "SUSPENDED" },
            $or: [
                { firstName: expression },
                { lastName: expression },
                { name: expression },
                { email: expression },
            ],
        })
            .select("_id firstName lastName name email role status")
            .sort({ createdAt: -1 })
            .limit(30)
            .lean();

        const userIds = users.map((user) => user._id);

        const deviceCounts = userIds.length
            ? await PushDevice.aggregate([
                { $match: { userId: { $in: userIds } } },
                { $group: { _id: "$userId", count: { $sum: 1 } } },
            ])
            : [];

        const counts = new Map(
            deviceCounts.map((item) => [
                String(item._id),
                item.count,
            ])
        );

        return res.json({
            success: true,
            users: users.map((user) => ({
                id: String(user._id),
                name:
                    [user.firstName, user.lastName]
                        .filter(Boolean)
                        .join(" ") ||
                    user.name ||
                    "User",
                email: user.email,
                role: user.role,
                pushDevices: counts.get(String(user._id)) || 0,
            })),
        });
    } catch (error) {
        console.error("Notification user search:", error.message);
        return res.status(500).json({
            success: false,
            message: "Unable to search users.",
        });
    }
}

async function sendCustomNotification(req, res) {
    try {
        const { userId, title, body } = req.body || {};

        if (
            !mongoose.isValidObjectId(userId) ||
            typeof title !== "string" ||
            typeof body !== "string" ||
            title.trim().length < 2 ||
            title.trim().length > 80 ||
            body.trim().length < 2 ||
            body.trim().length > 240
        ) {
            return res.status(400).json({
                success: false,
                message: "Enter a valid user, title and message.",
            });
        }

        const user = await User.findById(userId)
            .select("_id firstName lastName email")
            .lean();

        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User not found.",
            });
        }

        const setting = await IntegrationSetting.findOne({
            key: "push-notifications",
        }).lean();

        if (setting?.enabled === false) {
            return res.status(503).json({
                success: false,
                message: "Push notifications are disabled by Admin.",
            });
        }

        const deviceCount = await PushDevice.countDocuments({ userId });

        if (!deviceCount) {
            return res.status(409).json({
                success: false,
                message: "This user has no registered push-enabled device.",
            });
        }

        const delivery = await sendPushToUser(
            user._id,
            title.trim(),
            body.trim(),
            { type: "ADMIN_CUSTOM", source: "ADMIN" }
        );

        if (delivery?.error || !delivery?.successCount) {
            return res.status(502).json({
                success: false,
                message: "Push delivery failed. Check Firebase configuration and backend logs.",
                delivery: {
                    successCount: delivery?.successCount || 0,
                    failureCount: delivery?.failureCount || 0,
                },
            });
        }

        return res.json({
            success: true,
            message: "Notification sent to registered device(s).",
            delivery: {
                successCount: delivery.successCount,
                failureCount: delivery.failureCount,
            },
        });
    } catch (error) {
        console.error("Custom notification error:", error.message);
        return res.status(500).json({
            success: false,
            message: "Unable to send notification.",
        });
    }
}

module.exports = {
    searchNotificationUsers,
    sendCustomNotification,
};