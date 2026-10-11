const Ride = require("../models/Ride");
const DriverReview = require("../models/DriverReview");

async function getLatestCompletedRide(req, res) {
    try {
        const ride = await Ride.findOne({
            passengerId: req.user._id,
            status: "TRIP_COMPLETED",
        })
            .sort({ completedAt: -1, createdAt: -1 })
            .select("_id driverId finalPrice completedAt createdAt")
            .lean();

        if (!ride) {
            return res.json({
                success: true,
                ride: null,
                reviewed: false,
            });
        }

        const reviewed = await DriverReview.exists({
            rideId: ride._id,
            passengerId: req.user._id,
        });

        return res.json({
            success: true,
            ride,
            reviewed: Boolean(reviewed),
        });
    } catch (error) {
        console.error("Completed ride recovery:", error.message);

        return res.status(500).json({
            success: false,
            message: "Unable to recover completed ride",
        });
    }
}

module.exports = { getLatestCompletedRide };