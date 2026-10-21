const Driver = require("../models/Driver");
const Ride = require("../models/Ride");
const RideSettlement = require("../models/RideSettlement");

async function getMyEarnings(req, res) {
    try {
        const driver = await Driver.findOne({
            userId: req.user._id,
        }).select("_id");

        if (!driver) {
            return res.status(404).json({
                success: false,
                message: "Driver profile not found",
            });
        }

        const [summary] = await RideSettlement.aggregate([
            {
                $match: {
                    driverId: driver._id,
                    status: "SETTLED",
                },
            },
            {
                $group: {
                    _id: null,
                    completedTrips: { $sum: 1 },
                    totalFares: { $sum: "$fare" },
                    totalCommission: { $sum: "$commission" },
                    netEarnings: { $sum: "$driverEarnings" },
                },
            },
        ]);

        const recentTrips = await RideSettlement.find({
            driverId: driver._id,
            status: "SETTLED",
        })
            .sort({ createdAt: -1 })
            .limit(20)
            .select(
                "rideId fare commission driverEarnings createdAt"
            )
            .lean();

        const completedTrips = await Ride.countDocuments({
            driverId: driver._id,
            status: "TRIP_COMPLETED",
        });

        const settledSummary = summary || {
            completedTrips: 0,
            totalFares: 0,
            totalCommission: 0,
            netEarnings: 0,
        };

        return res.json({
            success: true,
            currency: "PKR",
            summary: {
                ...settledSummary,
                completedTrips,
                settledTrips: settledSummary.completedTrips,
                unsettledTrips: Math.max(
                    0,
                    completedTrips - settledSummary.completedTrips
                ),
            },
            recentTrips,
        });
    } catch (error) {
        console.error("Earnings error:", error.message);

        return res.status(500).json({
            success: false,
            message: "Unable to load earnings",
        });
    }
}

module.exports = { getMyEarnings };