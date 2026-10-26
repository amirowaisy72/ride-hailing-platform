const Driver = require("../models/Driver");
const Ride = require("../models/Ride");
const RideSettlement = require("../models/RideSettlement");
const ParcelOrder = require("../models/ParcelOrder");
const ParcelSettlement = require("../models/ParcelSettlement");

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

        const [parcelSummary] = await ParcelSettlement.aggregate([
            {
                $match: {
                    driverId: driver._id,
                    status: "SETTLED",
                },
            },
            {
                $group: {
                    _id: null,
                    completedParcels: { $sum: 1 },
                    totalFares: { $sum: "$fare" },
                    totalCommission: { $sum: "$commission" },
                    netEarnings: { $sum: "$driverEarnings" },
                },
            },
        ]);

        const rideRecent = await RideSettlement.find({
            driverId: driver._id,
            status: "SETTLED",
        })
            .sort({ createdAt: -1 })
            .limit(20)
            .select(
                "rideId fare commission driverEarnings createdAt"
            )
            .lean();

        const parcelRecent = await ParcelSettlement.find({
            driverId: driver._id,
            status: "SETTLED",
        })
            .sort({ createdAt: -1 })
            .limit(20)
            .select(
                "parcelOrderId fare commission driverEarnings createdAt"
            )
            .lean();

        const recentTrips = [
            ...rideRecent.map((trip) => ({ ...trip, type: "RIDE" })),
            ...parcelRecent.map((trip) => ({ ...trip, type: "PARCEL" })),
        ]
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
            .slice(0, 20);

        const completedTrips = await Ride.countDocuments({
            driverId: driver._id,
            status: "TRIP_COMPLETED",
        });

        const completedParcels = await ParcelOrder.countDocuments({
            driverId: driver._id,
            status: "DELIVERED",
        });

        const rideSummary = summary || {
            completedTrips: 0,
            totalFares: 0,
            totalCommission: 0,
            netEarnings: 0,
        };

        const settledParcels = parcelSummary || {
            completedParcels: 0,
            totalFares: 0,
            totalCommission: 0,
            netEarnings: 0,
        };

        const settledSummary = {
            completedTrips:
                rideSummary.completedTrips +
                settledParcels.completedParcels,
            totalFares:
                rideSummary.totalFares + settledParcels.totalFares,
            totalCommission:
                rideSummary.totalCommission +
                settledParcels.totalCommission,
            netEarnings:
                rideSummary.netEarnings + settledParcels.netEarnings,
        };

        return res.json({
            success: true,
            currency: "PKR",
            summary: {
                ...settledSummary,
                completedTrips: completedTrips + completedParcels,
                settledTrips: settledSummary.completedTrips,
                unsettledTrips: Math.max(
                    0,
                    completedTrips +
                        completedParcels -
                        settledSummary.completedTrips
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