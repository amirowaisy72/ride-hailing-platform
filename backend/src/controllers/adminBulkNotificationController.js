const mongoose = require("mongoose");
const User = require("../models/User");
const Driver = require("../models/Driver");
const DriverDocument = require("../models/DriverDocument");
const PushDevice = require("../models/PushDevice");
const IntegrationSetting = require("../models/IntegrationSetting");
const BulkNotification = require("../models/BulkNotification");
const LastAdminNotification = require("../models/LastAdminNotification");
const { sendPushToUser } = require("../services/pushService");

const MAX_BULK_RECIPIENTS = 500;

function parseFilters(body) {
    const raw = body || {};
    const audience =
        raw.audience === "PASSENGER" || raw.audience === "DRIVER"
            ? raw.audience
            : "ALL";
    const driverDocuments =
        raw.driverDocuments === "NO_DOCUMENTS" ? "NO_DOCUMENTS" : "ALL";
    const onlyNotBulkNotified = raw.onlyNotBulkNotified === true;
    let lastHours = null;
    if (raw.lastHours !== "" && raw.lastHours !== null && raw.lastHours !== undefined) {
        const parsed = Number(raw.lastHours);
        if (!Number.isInteger(parsed) || parsed < 1 || parsed > 720) {
            return { error: "Last hours must be a whole number between 1 and 720." };
        }
        lastHours = parsed;
    }
    let notNotifiedInLastHours = null;
    if (
        raw.notNotifiedInLastHours !== "" &&
        raw.notNotifiedInLastHours !== null &&
        raw.notNotifiedInLastHours !== undefined
    ) {
        const parsed = Number(raw.notNotifiedInLastHours);
        if (!Number.isInteger(parsed) || parsed < 1 || parsed > 720) {
            return { error: "Not-notified hours must be a whole number between 1 and 720." };
        }
        notNotifiedInLastHours = parsed;
    }
    return { audience, driverDocuments, onlyNotBulkNotified, lastHours, notNotifiedInLastHours };
}

function displayName(user) {
    return (
        [user.firstName, user.lastName].filter(Boolean).join(" ") ||
        user.name ||
        "User"
    );
}

// Shared by preview and send: returns push-enabled recipients plus counts.
// Live-app safety: this only reads User/Driver/DriverDocument/PushDevice
// and sends through the existing sendPushToUser path; it never changes a
// user, driver, document, ride, order, or any existing response shape.
async function findRecipients(filter) {
    const userQuery = { status: { $ne: "SUSPENDED" }, role: { $ne: "ADMIN" } };

    if (filter.audience !== "ALL") {
        userQuery.role = filter.audience;
    }

    if (filter.lastHours) {
        userQuery.createdAt = {
            $gte: new Date(Date.now() - filter.lastHours * 60 * 60 * 1000),
        };
    }

    let users = await User.find(userQuery)
        .select("_id firstName lastName name email role createdAt")
        .sort({ createdAt: -1 })
        .lean();

    // "No documents uploaded": only drivers who have a Driver record and
    // zero DriverDocument rows for that Driver record.
    if (filter.driverDocuments === "NO_DOCUMENTS") {
        const drivers = await Driver.find({
            userId: { $in: users.map((user) => user._id) },
        })
            .select("_id userId")
            .lean();
        const driverByUser = new Map(
            drivers.map((driver) => [String(driver.userId), driver._id])
        );
        const documentedDriverIds = new Set(
            (
                await DriverDocument.distinct("driverId", {
                    driverId: { $in: drivers.map((driver) => driver._id) },
                })
            ).map(String)
        );
        users = users.filter((user) => {
            const driverId = driverByUser.get(String(user._id));
            return driverId && !documentedDriverIds.has(String(driverId));
        });
    }

    if (filter.onlyNotBulkNotified) {
        const notified = await BulkNotification.distinct("notifiedUserIds");
        const notifiedSet = new Set(notified.map(String));
        users = users.filter((user) => !notifiedSet.has(String(user._id)));
    }

    // "Not notified in the last N hours": keep users with no last-notification
    // row at all, or whose last admin notification is older than N hours.
    if (filter.notNotifiedInLastHours) {
        const cutoff = new Date(
            Date.now() - filter.notNotifiedInLastHours * 60 * 60 * 1000
        );
        const recentlyNotified = await LastAdminNotification.distinct("userId", {
            sentAt: { $gte: cutoff },
        });
        const recentlySet = new Set(recentlyNotified.map(String));
        users = users.filter((user) => !recentlySet.has(String(user._id)));
    }

    const userIds = users.map((user) => user._id);
    const deviceCounts = userIds.length
        ? await PushDevice.aggregate([
            { $match: { userId: { $in: userIds } } },
            { $group: { _id: "$userId", count: { $sum: 1 } } },
        ])
        : [];
    const counts = new Map(
        deviceCounts.map((item) => [String(item._id), item.count])
    );

    const pushEnabled = [];
    let skippedNoDeviceCount = 0;
    for (const user of users) {
        const devices = counts.get(String(user._id)) || 0;
        if (devices < 1) {
            skippedNoDeviceCount += 1;
        } else {
            pushEnabled.push({
                id: String(user._id),
                name: displayName(user),
                email: user.email,
                role: user.role,
                createdAt: user.createdAt,
                pushDevices: devices,
            });
        }
    }

    return {
        totalMatched: users.length,
        pushEnabled,
        skippedNoDeviceCount,
    };
}

async function previewBulkNotification(req, res) {
    try {
        const filter = parseFilters(req.body);
        if (filter.error) {
            return res.status(400).json({ success: false, message: filter.error });
        }
        const { totalMatched, pushEnabled, skippedNoDeviceCount } =
            await findRecipients(filter);
        const sample = pushEnabled.slice(0, 20);
        const lastRows = sample.length
            ? await LastAdminNotification.find({
                userId: { $in: sample.map((user) => user.id) },
            })
                .select("userId title body sentAt")
                .lean()
            : [];
        const lastByUser = new Map(
            lastRows.map((row) => [String(row.userId), row])
        );
        return res.json({
            success: true,
            filter,
            totalMatched,
            pushEnabledCount: pushEnabled.length,
            skippedNoDeviceCount,
            // Preview is capped at 20 rows; the send itself is capped at 500.
            sample: sample.map((user) => {
                const last = lastByUser.get(user.id);
                return {
                    ...user,
                    lastNotification: last
                        ? {
                            title: last.title,
                            body: last.body,
                            sentAt: last.sentAt,
                        }
                        : null,
                };
            }),
            sendLimit: MAX_BULK_RECIPIENTS,
        });
    } catch (error) {
        console.error("Bulk notification preview error:", error.message);
        return res.status(500).json({
            success: false,
            message: "Unable to preview recipients.",
        });
    }
}

async function sendBulkNotification(req, res) {
    try {
        const filter = parseFilters(req.body);
        if (filter.error) {
            return res.status(400).json({ success: false, message: filter.error });
        }

        const { title, body } = req.body || {};
        if (
            typeof title !== "string" ||
            typeof body !== "string" ||
            title.trim().length < 2 ||
            title.trim().length > 80 ||
            body.trim().length < 2 ||
            body.trim().length > 240
        ) {
            return res.status(400).json({
                success: false,
                message: "Enter a valid title (2-80 chars) and message (2-240 chars).",
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

        const { totalMatched, pushEnabled, skippedNoDeviceCount } =
            await findRecipients(filter);
        const recipients = pushEnabled.slice(0, MAX_BULK_RECIPIENTS);

        if (!recipients.length) {
            return res.status(409).json({
                success: false,
                message:
                    "No push-enabled user matches these filters. Nothing was sent.",
                totalMatched,
                skippedNoDeviceCount,
            });
        }

        let successCount = 0;
        let failureCount = 0;
        const notifiedUserIds = [];
        for (const recipient of recipients) {
            const delivery = await sendPushToUser(
                recipient.id,
                title.trim(),
                body.trim(),
                { type: "ADMIN_BULK", source: "ADMIN" }
            );
            successCount += delivery?.successCount || 0;
            failureCount += delivery?.failureCount || 0;
            if (delivery?.successCount) {
                notifiedUserIds.push(
                    new mongoose.Types.ObjectId(recipient.id)
                );
            }
        }

        // Last-notification tracking: one row per successfully notified
        // user, overwritten with this bulk's title/body/time.
        if (notifiedUserIds.length) {
            await LastAdminNotification.bulkWrite(
                notifiedUserIds.map((userId) => ({
                    updateOne: {
                        filter: { userId },
                        update: {
                            userId,
                            title: title.trim(),
                            body: body.trim(),
                            source: "BULK",
                            sentAt: new Date(),
                        },
                        upsert: true,
                    },
                }))
            );
        }

        const log = await BulkNotification.create({
            title: title.trim(),
            body: body.trim(),
            filter,
            recipientUserIds: recipients.map(
                (recipient) => new mongoose.Types.ObjectId(recipient.id)
            ),
            notifiedUserIds,
            successCount,
            failureCount,
            skippedNoDeviceCount,
            sentAt: new Date(),
        });

        return res.json({
            success: true,
            message: "Bulk notification sent.",
            bulkId: String(log._id),
            recipientsAttempted: recipients.length,
            totalMatched,
            skippedNoDeviceCount,
            delivery: { successCount, failureCount },
        });
    } catch (error) {
        console.error("Bulk notification send error:", error.message);
        return res.status(500).json({
            success: false,
            message: "Unable to send bulk notification.",
        });
    }
}

async function listBulkNotificationHistory(req, res) {
    try {
        const logs = await BulkNotification.find({})
            .sort({ sentAt: -1 })
            .limit(50)
            .lean();
        return res.json({
            success: true,
            history: logs.map((log) => ({
                id: String(log._id),
                title: log.title,
                body: log.body,
                filter: log.filter,
                recipientsAttempted: (log.recipientUserIds || []).length,
                notifiedCount: (log.notifiedUserIds || []).length,
                successCount: log.successCount || 0,
                failureCount: log.failureCount || 0,
                skippedNoDeviceCount: log.skippedNoDeviceCount || 0,
                sentAt: log.sentAt,
            })),
        });
    } catch (error) {
        console.error("Bulk notification history error:", error.message);
        return res.status(500).json({
            success: false,
            message: "Unable to load bulk notification history.",
        });
    }
}

module.exports = {
    previewBulkNotification,
    sendBulkNotification,
    listBulkNotificationHistory,
};
