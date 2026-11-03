
const mongoose = require("mongoose");
const User = require("../models/User");
const Driver = require("../models/Driver");
const Vehicle = require("../models/Vehicle");
const Ride = require("../models/Ride");
const RideSettlement = require("../models/RideSettlement");
const Complaint = require("../models/Complaint");
const Feedback = require("../models/Feedback");
const DriverDocument = require("../models/DriverDocument");
const UserAppVersion = require("../models/UserAppVersion");
const AppVersionConfig = require("../models/AppVersionConfig");

const activeStatuses = [
    "REQUESTED",
    "SEARCHING",
    "BIDDING",
    "DRIVER_SELECTED",
    "DRIVER_EN_ROUTE",
    "DRIVER_ARRIVED",
    "TRIP_STARTED",
    "REASSIGNING",
];

async function getOverview(req, res) {
    try {
        const [
            passengers,
            drivers,
            approvedDrivers,
            pendingDrivers,
            vehicles,
            pendingVehicles,
            totalRides,
            activeRides,
            completedRides,
            settlementStats,
        ] = await Promise.all([
            User.countDocuments({ role: "PASSENGER" }),
            Driver.countDocuments(),
            Driver.countDocuments({ verificationStatus: "APPROVED" }),
            Driver.countDocuments({
                verificationStatus: { $in: ["PENDING", "UNDER_REVIEW"] },
            }),
            Vehicle.countDocuments(),
            Vehicle.countDocuments({ verificationStatus: "PENDING" }),
            Ride.countDocuments(),
            Ride.countDocuments({ status: { $in: activeStatuses } }),
            Ride.countDocuments({ status: "TRIP_COMPLETED" }),
            RideSettlement.aggregate([
                { $match: { status: "SETTLED" } },
                {
                    $group: {
                        _id: null,
                        totalFares: { $sum: "$fare" },
                        totalCommission: { $sum: "$commission" },
                    },
                },
            ]),
        ]);

        return res.json({
            success: true,
            overview: {
                passengers,
                drivers,
                approvedDrivers,
                pendingDrivers,
                vehicles,
                pendingVehicles,
                totalRides,
                activeRides,
                completedRides,
                totalSettledFares: settlementStats[0]?.totalFares || 0,
                totalCommission: settlementStats[0]?.totalCommission || 0,
            },
        });
    } catch (error) {
        console.error("Admin overview:", error.message);
        return res.status(500).json({
            success: false,
            message: "Unable to load platform overview",
        });
    }
}

async function getPassengers(req, res) {
    try {
        const page = Number(req.query.page || 1);
        const search = String(req.query.search || "").trim();
        const limit = 20;
        const sort = String(req.query.sort || "recent");

        if (!Number.isSafeInteger(page) || page < 1 ||
            page > 100000 || search.length > 100 ||
            !["recent", "active", "rides"].includes(sort)) {
            return res.status(400).json({
                success: false,
                message: "Invalid pagination, search or sort",
            });
        }

        const filter = { role: "PASSENGER" };

        if (search) {
            const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            filter.$or = [
                { firstName: { $regex: escaped, $options: "i" } },
                { lastName: { $regex: escaped, $options: "i" } },
                { name: { $regex: escaped, $options: "i" } },
                { email: { $regex: escaped, $options: "i" } },
                { phone: { $regex: escaped, $options: "i" } },
            ];
        }

        if (sort === "recent") {
            const [passengers, total] = await Promise.all([
                User.find(filter)
                    .select(
                        "firstName lastName name email phone profileImage createdAt"
                    )
                    .sort({ createdAt: -1 })
                    .skip((page - 1) * limit)
                    .limit(limit)
                    .lean(),
                User.countDocuments(filter),
            ]);

            return res.json({
                success: true,
                passengers,
                pagination: {
                    page,
                    total,
                    pages: Math.ceil(total / limit),
                },
            });
        }

        // Sorted listings (additive only): the default path above is
        // untouched. "active" = most recently opened the app first
        // (UserAppVersion.updatedAt, refreshed on every launch/login;
        // users on builds older than that feature have no row and sort
        // last). "rides" = most booked rides first. Both keep the same
        // response shape, plus one extra field per row.
        const pipeline = [{ $match: filter }];

        if (sort === "active") {
            pipeline.push(
                {
                    $lookup: {
                        from: "userappversions",
                        localField: "_id",
                        foreignField: "userId",
                        as: "appVersion",
                    },
                },
                {
                    $addFields: {
                        lastActiveAt: {
                            $arrayElemAt: ["$appVersion.updatedAt", 0],
                        },
                        appVersion: {
                            $arrayElemAt: ["$appVersion.appVersion", 0],
                        },
                    },
                },
                { $sort: { lastActiveAt: -1, createdAt: -1 } }
            );
        } else {
            pipeline.push(
                {
                    $lookup: {
                        from: "rides",
                        localField: "_id",
                        foreignField: "passengerId",
                        as: "rideDocs",
                    },
                },
                { $addFields: { rideCount: { $size: "$rideDocs" } } },
                { $sort: { rideCount: -1, createdAt: -1 } }
            );
        }

        pipeline.push(
            {
                $project: {
                    firstName: 1,
                    lastName: 1,
                    name: 1,
                    email: 1,
                    phone: 1,
                    profileImage: 1,
                    createdAt: 1,
                    lastActiveAt: 1,
                    appVersion: 1,
                    rideCount: 1,
                },
            },
            { $skip: (page - 1) * limit },
            { $limit: limit }
        );

        const [passengers, total] = await Promise.all([
            User.aggregate(pipeline),
            User.countDocuments(filter),
        ]);

        return res.json({
            success: true,
            passengers,
            pagination: {
                page,
                total,
                pages: Math.ceil(total / limit),
            },
        });
    } catch (error) {
        console.error("Passenger listing:", error.message);
        return res.status(500).json({
            success: false,
            message: "Unable to load passengers",
        });
    }
}

// GET /admin/operations/passengers/:id/profile — read-only, admin-only.
// Full passenger profile for the dashboard modal: account, last app
// open, ride stats and recent rides, complaints and feedback counts.
// No app change, no write, no existing endpoint touched.
async function getPassengerProfile(req, res) {
    try {
        const { id } = req.params;

        if (!mongoose.isValidObjectId(id)) {
            return res.status(404).json({
                success: false,
                message: "Passenger not found",
            });
        }

        const user = await User.findById(id)
            .select(
                "firstName lastName name email phone profileImage role createdAt"
            )
            .lean();

        if (!user || user.role !== "PASSENGER") {
            return res.status(404).json({
                success: false,
                message: "Passenger not found",
            });
        }

        const userId = user._id;

        const [
            version,
            rideGroups,
            recentRides,
            complaints,
            feedback,
        ] = await Promise.all([
            UserAppVersion.findOne({ userId })
                .select("appVersion appVersionCode platform updatedAt")
                .lean(),
            Ride.aggregate([
                { $match: { passengerId: userId } },
                { $group: { _id: "$status", count: { $sum: 1 } } },
            ]),
            Ride.find({ passengerId: userId })
                .select(
                    "status vehicleType requestedPrice finalPrice " +
                    "createdAt completedAt"
                )
                .sort({ createdAt: -1 })
                .limit(5)
                .lean(),
            Complaint.countDocuments({ complainant: userId }),
            Feedback.countDocuments({ user: userId }),
        ]);

        const byStatus = new Map(
            rideGroups.map((row) => [row._id, row.count])
        );
        const completed = byStatus.get("TRIP_COMPLETED") || 0;
        const cancelled = byStatus.get("CANCELLED") || 0;
        const active = activeStatuses.reduce(
            (sum, status) => sum + (byStatus.get(status) || 0),
            0
        );
        const total = [...byStatus.values()].reduce(
            (sum, count) => sum + count,
            0
        );

        return res.json({
            success: true,
            profile: {
                user,
                lastActiveAt: version ? version.updatedAt : null,
                appVersion: version ? version.appVersion : null,
                rideStats: { total, completed, cancelled, active },
                recentRides,
                complaints,
                feedback,
            },
        });
    } catch (error) {
        console.error("Passenger profile:", error.message);
        return res.status(500).json({
            success: false,
            message: "Unable to load passenger profile",
        });
    }
}

async function getRides(req, res) {
    try {
        const page = Number(req.query.page || 1);
        const status = String(req.query.status || "ALL");
        const limit = 20;

        if (!Number.isSafeInteger(page) || page < 1 ||
            page > 100000 ||
            !["ALL", "ACTIVE", "TRIP_COMPLETED", "CANCELLED"].includes(status)) {
            return res.status(400).json({
                success: false,
                message: "Invalid ride filter",
            });
        }

        const filter = {};

        if (status === "ACTIVE") {
            filter.status = { $in: activeStatuses };
        } else if (status !== "ALL") {
            filter.status = status;
        }

        const [rides, total] = await Promise.all([
            Ride.find(filter)
                .select(
                    "passengerId driverId status vehicleType requestedPrice " +
                    "finalPrice distance createdAt completedAt settlementStatus"
                )
                .sort({ createdAt: -1 })
                .skip((page - 1) * limit)
                .limit(limit)
                .lean(),
            Ride.countDocuments(filter),
        ]);

        return res.json({
            success: true,
            rides,
            pagination: {
                page,
                total,
                pages: Math.ceil(total / limit),
            },
        });
    } catch (error) {
        console.error("Ride listing:", error.message);
        return res.status(500).json({
            success: false,
            message: "Unable to load rides",
        });
    }
}

module.exports = {
    getOverview,
    getPassengers,
    getPassengerProfile,
    getRides,
    getImportant,
    getTodayRides,
};

// GET /admin/operations/important — one call for the Overview
// "Important" section, so the admin no longer has to open a tab
// per item. READ-ONLY and additive: no existing endpoint or
// response shape is changed, and no app-facing behaviour is
// touched. "New" driver documents means uploaded in the last
// 24 hours; the pending-documents total is included alongside
// so an older unreviewed upload is never hidden by the window.
async function getImportant(req, res) {
    try {
        const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

        // "Only new" registration windows: the dashboard sends the
        // last time each card was clicked (localStorage, per card).
        // A valid timestamp counts only registrations AFTER that
        // click, so a viewed card drops to 0 and the next unseen
        // registration shows as +1. Missing/invalid timestamps fall
        // back to the last 24h, preserving the previous behaviour
        // on first visit. Read-only filter only; nothing else
        // about this endpoint changes.
        const parseSince = (value) => {
            if (!value) return null;
            const date = new Date(String(value));
            return Number.isNaN(date.getTime()) ? null : date;
        };
        const passengerSince = parseSince(req.query.passengerSince);
        const driverSince = parseSince(req.query.driverSince);
        const passengerCreatedFilter = passengerSince
            ? { $gt: passengerSince }
            : { $gte: dayAgo };

        // Today's date in Pakistan time (the dashboard's timezone):
        // the server runs on UTC, so shift by +05:00, take the
        // calendar day, and shift back. Pakistan has no DST, so a
        // fixed +05:00 is correct. The count resets at midnight PKT.
        const PKT_OFFSET_MS = 5 * 60 * 60 * 1000;
        const pktNow = new Date(Date.now() + PKT_OFFSET_MS);
        pktNow.setUTCHours(0, 0, 0, 0);
        const todayStart = new Date(pktNow.getTime() - PKT_OFFSET_MS);
        const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);
        const driverCreatedFilter = driverSince
            ? { $gt: driverSince }
            : { $gte: dayAgo };

        // Latest-version config first: the "users on latest"
        // count below depends on its version code.
        const versionConfig = await AppVersionConfig.findOne({
            platform: "android",
        }).lean();

        const [
            openComplaints,
            openComplaintList,
            newFeedback,
            newFeedbackList,
            newDocuments,
            pendingDocuments,
            pendingDocumentList,
            activeRides,
            todayCompletedRides,
            onlineCount,
            onlineAvailableCount,
            onlineRecent,
            newPassengerCount,
            newPassengerList,
            newDriverCount,
            newDriverList,
            totalUsers,
            latestVersionUsers,
            reportedUsers,
        ] = await Promise.all([
            Complaint.countDocuments({
                status: { $in: ["OPEN", "IN_REVIEW"] },
            }),
            Complaint.find({ status: { $in: ["OPEN", "IN_REVIEW"] } })
                .populate("complainant", "firstName lastName")
                .select("complainant complainantRole category description status createdAt")
                .sort({ createdAt: -1 })
                .limit(5)
                .lean(),
            Feedback.countDocuments({ status: "NEW" }),
            Feedback.find({ status: "NEW" })
                .populate("user", "firstName lastName")
                .select("user userRole category message createdAt")
                .sort({ createdAt: -1 })
                .limit(5)
                .lean(),
            DriverDocument.find({ createdAt: { $gte: dayAgo } })
                .populate({
                    path: "driverId",
                    populate: { path: "userId", select: "firstName lastName" },
                })
                .select("driverId documentType verificationStatus createdAt")
                .sort({ createdAt: -1 })
                .lean(),
            DriverDocument.countDocuments({
                verificationStatus: "PENDING",
            }),
            // ADDITIVE ONLY: pending-review documents grouped by
            // driver, for the Important card. No existing query or
            // response field is changed by this addition.
            DriverDocument.find({ verificationStatus: "PENDING" })
                .populate({
                    path: "driverId",
                    populate: { path: "userId", select: "firstName lastName" },
                })
                .select("driverId documentType verificationStatus createdAt")
                .sort({ createdAt: -1 })
                .limit(100)
                .lean(),
            Ride.countDocuments({ status: { $in: activeStatuses } }),
            // ADDITIVE ONLY: rides completed on today's PKT date.
            // completedAt is the primary signal; rides completed
            // before that field was recorded fall back to updatedAt.
            Ride.countDocuments({
                status: "TRIP_COMPLETED",
                $or: [
                    { completedAt: { $gte: todayStart, $lt: todayEnd } },
                    {
                        completedAt: null,
                        updatedAt: { $gte: todayStart, $lt: todayEnd },
                    },
                ],
            }),
            // ADDITIVE ONLY: live drivers for the Important card —
            // same rule as getTodayRides / ride matching: online flag
            // plus location within the last 2 minutes; available adds
            // APPROVED + isAvailable. No existing query or response
            // field is changed by this addition.
            Driver.countDocuments({
                isOnline: true,
                lastLocationUpdate: {
                    $gte: new Date(Date.now() - 2 * 60 * 1000),
                },
            }),
            Driver.countDocuments({
                isOnline: true,
                verificationStatus: "APPROVED",
                isAvailable: true,
                lastLocationUpdate: {
                    $gte: new Date(Date.now() - 2 * 60 * 1000),
                },
            }),
            Driver.find({
                isOnline: true,
                lastLocationUpdate: {
                    $gte: new Date(Date.now() - 2 * 60 * 1000),
                },
            })
                .populate("userId", "firstName lastName")
                .select("userId isAvailable verificationStatus lastLocationUpdate")
                .sort({ lastLocationUpdate: -1 })
                .limit(5)
                .lean(),
            // ADDITIVE ONLY: registrations in the last 24 hours, for
            // the two new Important cards. No existing query or
            // response field is changed by this addition.
            User.countDocuments({
                role: "PASSENGER",
                createdAt: passengerCreatedFilter,
            }),
            User.find({ role: "PASSENGER", createdAt: passengerCreatedFilter })
                .select("firstName lastName name email createdAt")
                .sort({ createdAt: -1 })
                .limit(5)
                .lean(),
            Driver.countDocuments({ createdAt: driverCreatedFilter }),
            Driver.find({ createdAt: driverCreatedFilter })
                .populate("userId", "firstName lastName")
                .select("userId verificationStatus createdAt")
                .sort({ createdAt: -1 })
                .limit(5)
                .lean(),
            User.countDocuments({ role: { $ne: "ADMIN" } }),
            versionConfig
                ? UserAppVersion.countDocuments({
                    appVersionCode: versionConfig.latestVersionCode,
                })
                : Promise.resolve(0),
            UserAppVersion.countDocuments({}),
        ]);

        // Group pending-review documents by driver for a readable
        // list (newest document first, from the sort above).
        const pendingDriversById = new Map();
        for (const doc of pendingDocumentList) {
            const driver = doc.driverId;
            if (!driver) continue;
            const key = String(driver._id);
            const user = driver.userId || {};
            const name = [user.firstName, user.lastName]
                .filter(Boolean)
                .join(" ") || "Driver";
            if (!pendingDriversById.has(key)) {
                pendingDriversById.set(key, { name, count: 0 });
            }
            pendingDriversById.get(key).count += 1;
        }

        // Group the last-24h documents by driver for a readable list.
        const driversById = new Map();
        for (const doc of newDocuments) {
            const driver = doc.driverId;
            if (!driver) continue;
            const key = String(driver._id);
            const user = driver.userId || {};
            const name = [user.firstName, user.lastName]
                .filter(Boolean)
                .join(" ") || "Driver";
            if (!driversById.has(key)) {
                driversById.set(key, { name, count: 0 });
            }
            driversById.get(key).count += 1;
        }

        return res.json({
            success: true,
            important: {
                openComplaints: {
                    count: openComplaints,
                    recent: openComplaintList.map((item) => ({
                        id: item._id,
                        name: [item.complainant?.firstName, item.complainant?.lastName]
                            .filter(Boolean)
                            .join(" ") || "User",
                        role: item.complainantRole,
                        category: item.category,
                        description: item.description,
                        status: item.status,
                        createdAt: item.createdAt,
                    })),
                },
                newFeedback: {
                    count: newFeedback,
                    recent: newFeedbackList.map((item) => ({
                        id: item._id,
                        name: [item.user?.firstName, item.user?.lastName]
                            .filter(Boolean)
                            .join(" ") || "User",
                        role: item.userRole,
                        category: item.category,
                        message: item.message,
                        createdAt: item.createdAt,
                    })),
                },
                newDriverDocuments: {
                    count: newDocuments.length,
                    pendingCount: pendingDocuments,
                    drivers: [...driversById.values()],
                },
                // ADDITIVE ONLY: pending-review documents only.
                // Count is the full PENDING total, not the limited
                // list length, so it never undercounts.
                pendingDriverDocuments: {
                    count: pendingDocuments,
                    drivers: [...pendingDriversById.values()],
                },
                activeRides: { count: activeRides },
                // ADDITIVE ONLY: today's PKT-date completed rides.
                todayCompletedRides: { count: todayCompletedRides },
                // ADDITIVE ONLY: live drivers for the Important card.
                onlineDrivers: {
                    count: onlineCount,
                    availableCount: onlineAvailableCount,
                    recent: onlineRecent.map((item) => ({
                        id: item._id,
                        name: [item.userId?.firstName, item.userId?.lastName]
                            .filter(Boolean)
                            .join(" ") || "Driver",
                        isAvailable: item.isAvailable,
                        verificationStatus: item.verificationStatus,
                        lastLocationUpdate: item.lastLocationUpdate,
                    })),
                },
                // ADDITIVE ONLY: registrations since the card was
                // last clicked (last 24h when no click recorded yet).
                newPassengers: {
                    count: newPassengerCount,
                    recent: newPassengerList.map((item) => ({
                        id: item._id,
                        name: [item.firstName, item.lastName]
                            .filter(Boolean)
                            .join(" ") || item.name || "User",
                        email: item.email,
                        createdAt: item.createdAt,
                    })),
                },
                newDrivers: {
                    count: newDriverCount,
                    recent: newDriverList.map((item) => ({
                        id: item._id,
                        name: [item.userId?.firstName, item.userId?.lastName]
                            .filter(Boolean)
                            .join(" ") || "Driver",
                        verificationStatus: item.verificationStatus,
                        createdAt: item.createdAt,
                    })),
                },
                appVersion: versionConfig
                    ? {
                        latestVersionCode: versionConfig.latestVersionCode,
                        latestVersionName: versionConfig.latestVersionName,
                        latestUsers: latestVersionUsers,
                        totalUsers,
                        reportedUsers,
                        unknownUsers: Math.max(0, totalUsers - reportedUsers),
                    }
                    : null,
            },
        });
    } catch (error) {
        console.error("Important listing:", error.message);
        return res.status(500).json({
            success: false,
            message: "Unable to load important items",
        });
    }
}


// GET /admin/operations/today-rides — one call for the "Today
// Rides" dashboard tab. READ-ONLY and additive: no existing
// endpoint or response shape is changed. All windows are today's
// Pakistan date (fixed +05:00, no DST), so counts reset at
// midnight PKT. Cancelled vs expired are kept separate on purpose:
// EXPIRED with AUTO_EXPIRED_NO_DRIVER_SELECTED means certainly no
// driver was found in 15 minutes; CANCELLED only means the
// passenger cancelled (motive is not recorded), so the
// before-driver-assignment subset is reported as its own line,
// never merged into the expired count.
async function getTodayRides(req, res) {
    try {
        const PKT_OFFSET_MS = 5 * 60 * 60 * 1000;
        const pktNow = new Date(Date.now() + PKT_OFFSET_MS);
        pktNow.setUTCHours(0, 0, 0, 0);
        const todayStart = new Date(pktNow.getTime() - PKT_OFFSET_MS);
        const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);
        const date = pktNow.toISOString().slice(0, 10);

        // cancelledAt is set by both the passenger-cancel and the
        // auto-expiry paths; updatedAt is only a fallback for rides
        // cancelled before that field was recorded.
        const cancelledAtInDay = {
            $or: [
                { cancelledAt: { $gte: todayStart, $lt: todayEnd } },
                {
                    cancelledAt: null,
                    updatedAt: { $gte: todayStart, $lt: todayEnd },
                },
            ],
        };

        // Live drivers: same rule ride matching itself uses — the
        // online flag alone can go stale if the app is killed
        // without toggling off, so freshness (location within the
        // last 2 minutes) is required. Available adds APPROVED +
        // isAvailable, exactly like findNearbyDrivers.
        const freshSince = new Date(Date.now() - 2 * 60 * 1000);
        const onlineFilter = {
            isOnline: true,
            lastLocationUpdate: { $gte: freshSince },
        };

        const [
            totalCreated,
            completedCount,
            completedRecent,
            cancelledCount,
            cancelledRecent,
            cancelledBeforeDriver,
            expiredCount,
            expiredRecent,
            onlineCount,
            availableCount,
            onlineRecent,
        ] = await Promise.all([
            Ride.countDocuments({
                createdAt: { $gte: todayStart, $lt: todayEnd },
            }),
            Ride.countDocuments({
                status: "TRIP_COMPLETED",
                $or: [
                    { completedAt: { $gte: todayStart, $lt: todayEnd } },
                    {
                        completedAt: null,
                        updatedAt: { $gte: todayStart, $lt: todayEnd },
                    },
                ],
            }),
            Ride.find({
                status: "TRIP_COMPLETED",
                $or: [
                    { completedAt: { $gte: todayStart, $lt: todayEnd } },
                    {
                        completedAt: null,
                        updatedAt: { $gte: todayStart, $lt: todayEnd },
                    },
                ],
            })
                .select("vehicleType finalPrice requestedPrice completedAt updatedAt")
                .sort({ completedAt: -1 })
                .limit(5)
                .lean(),
            Ride.countDocuments({ status: "CANCELLED", ...cancelledAtInDay }),
            Ride.find({ status: "CANCELLED", ...cancelledAtInDay })
                .select("vehicleType requestedPrice cancelledAt cancellationReason driverId")
                .sort({ cancelledAt: -1 })
                .limit(5)
                .lean(),
            Ride.countDocuments({
                status: "CANCELLED",
                ...cancelledAtInDay,
                driverId: null,
            }),
            Ride.countDocuments({ status: "EXPIRED", ...cancelledAtInDay }),
            Ride.find({ status: "EXPIRED", ...cancelledAtInDay })
                .select("vehicleType requestedPrice cancelledAt cancellationReason")
                .sort({ cancelledAt: -1 })
                .limit(5)
                .lean(),
            Driver.countDocuments(onlineFilter),
            Driver.countDocuments({
                ...onlineFilter,
                verificationStatus: "APPROVED",
                isAvailable: true,
            }),
            Driver.find(onlineFilter)
                .populate("userId", "firstName lastName")
                .select("userId isAvailable verificationStatus lastLocationUpdate")
                .sort({ lastLocationUpdate: -1 })
                .limit(5)
                .lean(),
        ]);

        const mapRecent = (items, timeField, priceField) =>
            items.map((item) => ({
                id: item._id,
                vehicleType: item.vehicleType,
                price: item[priceField] ?? item.requestedPrice ?? null,
                time: item[timeField] || item.updatedAt,
                reason: item.cancellationReason || null,
            }));

        return res.json({
            success: true,
            today: {
                date,
                totalCreated,
                completed: {
                    count: completedCount,
                    recent: mapRecent(completedRecent, "completedAt", "finalPrice"),
                },
                cancelled: {
                    count: cancelledCount,
                    beforeDriverCount: cancelledBeforeDriver,
                    recent: mapRecent(cancelledRecent, "cancelledAt", "requestedPrice"),
                },
                expired: {
                    count: expiredCount,
                    recent: mapRecent(expiredRecent, "cancelledAt", "requestedPrice"),
                },
                onlineDrivers: {
                    count: onlineCount,
                    availableCount,
                    recent: onlineRecent.map((item) => ({
                        id: item._id,
                        name: [item.userId?.firstName, item.userId?.lastName]
                            .filter(Boolean)
                            .join(" ") || "Driver",
                        isAvailable: item.isAvailable,
                        verificationStatus: item.verificationStatus,
                        lastLocationUpdate: item.lastLocationUpdate,
                    })),
                },
            },
        });
    } catch (error) {
        console.error("Today rides listing:", error.message);
        return res.status(500).json({
            success: false,
            message: "Unable to load today's rides",
        });
    }
}
