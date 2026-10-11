const mongoose = require("mongoose");
const Ride = require("../models/Ride");
const { publishEvent } = require("../services/socketService");
const RideOffer = require("../models/RideOffer");
const { findDriversWithExpandedRadius } = require("../services/driverMatchingService");

const cancelRide = async (req, res) => {
    const { rideId } = req.params;

    if (!mongoose.isValidObjectId(rideId)) {
        return res.status(400).json({
            success: false,
            message: "Invalid ride ID",
        });
    }

    try {
        const ride = await Ride.findOneAndUpdate(
            {
                _id: rideId,
                passengerId: req.user._id,
                status: { $in: ["REQUESTED", "SEARCHING", "BIDDING"] },
                driverId: null,
            },
            {
                $set: {
                    status: "CANCELLED",
                    cancelledAt: new Date(),
                    cancellationReason: "Cancelled by passenger",
                },
            },
            { new: true }
        );

        if (!ride) {
            return res.status(409).json({
                success: false,
                message: "Ride cannot be cancelled at this stage",
            });
        }

        publishEvent(
            "ride:cancelled",
            `passenger:${req.user._id}`,
            { rideId: ride._id.toString() }
        );

        try {
            await RideOffer.updateMany(
                { rideId: ride._id, status: "PENDING" },
                { $set: { status: "REJECTED" } }
            );

            const [longitude, latitude] = ride.pickup.coordinates;
            const { drivers } = await findDriversWithExpandedRadius(
                longitude, latitude
            );

            for (const driver of drivers) {
                publishEvent(
                    "ride:cancelled",
                    `driver:${driver.userId}`,
                    { rideId: ride._id.toString() }
                );
            }
        } catch (error) {
            console.error("Cancellation notification failed:", error.message);
        }

        return res.json({
            success: true,
            message: "Ride cancelled successfully",
            ride,
        });
    } catch (error) {
        console.error("Cancel ride error:", error.message);
        return res.status(500).json({
            success: false,
            message: "Failed to cancel ride",
        });
    }
};

module.exports = { cancelRide };