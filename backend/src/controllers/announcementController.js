const User = require("../models/User");
const Driver = require("../models/Driver");
const DriverDocument = require("../models/DriverDocument");
const AdminAnnouncement = require("../models/AdminAnnouncement");
const AnnouncementRead = require("../models/AnnouncementRead");

const MAX_ANNOUNCEMENT_TARGETS = 5000;

function parseFilter(body) {
    const raw = body || {};
    const audience =
        raw.audience === "PASSENGER" || raw.audience === "DRIVER"
            ? raw.audience
            : "ALL";
    const driverDocuments =
        raw.driverDocuments === "NO_DOCUMENTS" ? "NO_DOCUMENTS" : "ALL";
    let lastHours = null;
    if (raw.lastHours !== "" && raw.lastHours !== null && raw.lastHours !== undefined) {
        const parsed = Number(raw.lastHours);
        if (!Number.isInteger(parsed) || parsed < 1 || parsed > 720) {
            return { error: "Last hours must be a whole number between 1 and 720." };
        }
        lastHours = parsed;
    }
    return { audience, driverDocuments, lastHours };
}

// Same matching rules as the bulk-notification filters, except no
// push-device requirement: an in-app popup only needs the user to
// open the app, not a registered device.
async function computeTargetUserIds(filter) {
    const query = { status: { $ne: "SUSPENDED" }, role: { $ne: "ADMIN" } };
    if (filter.audience !== "ALL") {
        query.role = filter.audience;
    }
    if (filter.lastHours) {
        query.createdAt = {
            $gte: new Date(Date.now() - filter.lastHours * 60 * 60 * 1000),
        };
    }
    let users = await User.find(query).select("_id").lean();

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

    return users.map((user) => user._id);
}

async function previewAnnouncementTargets(req, res) {
    try {
        const filter = parseFilter(req.body);
        if (filter.error) {
            return res.status(400).json({ success: false, message: filter.error });
        }
        const targetUserIds = await computeTargetUserIds(filter);
        return res.json({
            success: true,
            filter,
            targetCount: targetUserIds.length,
            limit: MAX_ANNOUNCEMENT_TARGETS,
        });
    } catch (error) {
        console.error("Announcement preview error:", error.message);
        return res.status(500).json({
            success: false,
            message: "Unable to preview targets.",
        });
    }
}

async function createAnnouncement(req, res) {
    try {
        const filter = parseFilter(req.body);
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
            body.trim().length > 1000
        ) {
            return res.status(400).json({
                success: false,
                message: "Enter a valid title (2-80 chars) and message (2-1000 chars).",
            });
        }
        const targetUserIds = await computeTargetUserIds(filter);
        if (!targetUserIds.length) {
            return res.status(409).json({
                success: false,
                message: "No user matches these filters. Nothing was created.",
            });
        }
        if (targetUserIds.length > MAX_ANNOUNCEMENT_TARGETS) {
            return res.status(409).json({
                success: false,
                message: `Too many targets (${targetUserIds.length}). Narrow the filters to at most ${MAX_ANNOUNCEMENT_TARGETS}.`,
            });
        }
        const announcement = await AdminAnnouncement.create({
            title: title.trim(),
            body: body.trim(),
            filter,
            targetUserIds,
            active: true,
        });
        return res.json({
            success: true,
            message: "Announcement created.",
            announcementId: String(announcement._id),
            targetCount: targetUserIds.length,
        });
    } catch (error) {
        console.error("Announcement create error:", error.message);
        return res.status(500).json({
            success: false,
            message: "Unable to create announcement.",
        });
    }
}

async function listAnnouncements(req, res) {
    try {
        const announcements = await AdminAnnouncement.find({})
            .sort({ createdAt: -1 })
            .limit(50)
            .lean();
        const readCounts = announcements.length
            ? await AnnouncementRead.aggregate([
                {
                    $match: {
                        announcementId: {
                            $in: announcements.map((item) => item._id),
                        },
                    },
                },
                { $group: { _id: "$announcementId", count: { $sum: 1 } } },
            ])
            : [];
        const counts = new Map(
            readCounts.map((item) => [String(item._id), item.count])
        );
        return res.json({
            success: true,
            announcements: announcements.map((item) => ({
                id: String(item._id),
                title: item.title,
                body: item.body,
                filter: item.filter,
                targetCount: (item.targetUserIds || []).length,
                readCount: counts.get(String(item._id)) || 0,
                active: item.active,
                createdAt: item.createdAt,
            })),
        });
    } catch (error) {
        console.error("Announcement list error:", error.message);
        return res.status(500).json({
            success: false,
            message: "Unable to load announcements.",
        });
    }
}

async function setAnnouncementActive(req, res) {
    try {
        const announcement = await AdminAnnouncement.findByIdAndUpdate(
            req.params.id,
            { active: req.body?.active === true },
            { new: true }
        ).lean();
        if (!announcement) {
            return res.status(404).json({
                success: false,
                message: "Announcement not found.",
            });
        }
        return res.json({
            success: true,
            message: announcement.active ? "Announcement activated." : "Announcement deactivated.",
            active: announcement.active,
        });
    } catch (error) {
        console.error("Announcement toggle error:", error.message);
        return res.status(500).json({
            success: false,
            message: "Unable to update announcement.",
        });
    }
}

// One unread announcement per call: the oldest active announcement
// targeting this user that they have not read yet.
async function getActiveAnnouncement(req, res) {
    try {
        const readIds = await AnnouncementRead.distinct("announcementId", {
            userId: req.user._id,
        });
        const announcement = await AdminAnnouncement.findOne({
            active: true,
            targetUserIds: req.user._id,
            _id: { $nin: readIds },
        })
            .sort({ createdAt: 1 })
            .select("_id title body createdAt")
            .lean();
        return res.json({
            success: true,
            announcement: announcement
                ? {
                    id: String(announcement._id),
                    title: announcement.title,
                    body: announcement.body,
                    createdAt: announcement.createdAt,
                }
                : null,
        });
    } catch (error) {
        console.error("Active announcement error:", error.message);
        return res.status(500).json({
            success: false,
            message: "Unable to load announcement.",
        });
    }
}

async function markAnnouncementRead(req, res) {
    try {
        const announcement = await AdminAnnouncement.findById(req.params.id)
            .select("_id")
            .lean();
        if (!announcement) {
            return res.status(404).json({
                success: false,
                message: "Announcement not found.",
            });
        }
        await AnnouncementRead.updateOne(
            { announcementId: announcement._id, userId: req.user._id },
            {
                $setOnInsert: {
                    announcementId: announcement._id,
                    userId: req.user._id,
                    readAt: new Date(),
                },
            },
            { upsert: true }
        );
        return res.json({ success: true, message: "Marked as read." });
    } catch (error) {
        console.error("Announcement read error:", error.message);
        return res.status(500).json({
            success: false,
            message: "Unable to mark announcement as read.",
        });
    }
}

module.exports = {
    previewAnnouncementTargets,
    createAnnouncement,
    listAnnouncements,
    setAnnouncementActive,
    getActiveAnnouncement,
    markAnnouncementRead,
};
