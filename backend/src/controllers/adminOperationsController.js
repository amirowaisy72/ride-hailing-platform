
const User = require("../models/User");
const Driver = require("../models/Driver");
const Vehicle = require("../models/Vehicle");
const Ride = require("../models/Ride");
const RideSettlement = require("../models/RideSettlement");

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
            ];
        }

        const [passengers, total] = await Promise.all([
            User.find(filter)
                .select("firstName lastName name email createdAt")
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
};
