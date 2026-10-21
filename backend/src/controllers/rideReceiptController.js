
const mongoose = require("mongoose");
const Ride = require("../models/Ride");
const Driver = require("../models/Driver");

async function getRideReceipt(req, res) {
    try {
        const { rideId } = req.params;

        if (!mongoose.isValidObjectId(rideId)) {
            return res.status(400).json({
                success: false,
                message: "Invalid ride ID",
            });
        }

        const ride = await Ride.findOne({
            _id: rideId,
            passengerId: req.user._id,
            status: "TRIP_COMPLETED",
        })
            .select(
                "passengerId driverId vehicleType tripType pickup destination stops " +
                "requestedPrice finalPrice waitingCharge waitingSessions " +
                "pickupWaitingSeconds totalStopWaitingSeconds currency distance duration " +
                "createdAt startedAt completedAt status"
            )
            .lean();

        if (!ride) {
            return res.status(404).json({
                success: false,
                message: "Completed ride receipt not found",
            });
        }

        const driver = ride.driverId
            ? await Driver.findById(ride.driverId)
                .select("rating ratingCount")
                .lean()
            : null;

        return res.json({
            success: true,
            receipt: {
                rideId: ride._id,
                status: ride.status,
                vehicleType: ride.vehicleType,
                tripType: ride.tripType || "ONE_WAY",
                pickup: ride.pickup,
                destination: ride.destination,
                stops: ride.stops || [],
                requestedPrice: ride.requestedPrice,
                finalPrice: ride.finalPrice,
                waitingCharge: ride.waitingCharge || 0,
                waitingSessions: ride.waitingSessions || [],
                pickupWaitingSeconds: ride.pickupWaitingSeconds || 0,
                totalStopWaitingSeconds: ride.totalStopWaitingSeconds || 0,
                currency: ride.currency || "PKR",
                distance: ride.distance,
                duration: ride.duration,
                bookedAt: ride.createdAt,
                startedAt: ride.startedAt,
                completedAt: ride.completedAt,
                paymentMethod: "CASH",
                driver: driver ? {
                    rating: driver.ratingCount ? driver.rating : null,
                    ratingCount: driver.ratingCount || 0,
                } : null,
            },
        });
    } catch (error) {
        console.error("Receipt error:", error.message);
        return res.status(500).json({
            success: false,
            message: "Unable to load ride receipt",
        });
    }
}

module.exports = { getRideReceipt };
