
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

        if (!Number.isSafeInteger(page) || page < 1 ||
            page > 100000 || search.length > 100) {
            return res.status(400).json({
                success: false,
                message: "Invalid pagination or search",
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

        const [passengers, total] = await Promise.all([
            User.find(filter)
                .select("firstName lastName name email phone createdAt")
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
    } catch (error) {
        console.error("Passenger listing:", error.message);
        return res.status(500).json({
            success: false,
            message: "Unable to load passengers",
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
    getRides,
    getImportant,
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

