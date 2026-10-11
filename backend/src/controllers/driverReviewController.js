const mongoose = require("mongoose");
const Ride = require("../models/Ride");
const Driver = require("../models/Driver");
const DriverReview = require("../models/DriverReview");

const submitDriverReview = async (req, res) => {
    const { rideId } = req.params;
    const { rating, comment = "" } = req.body || {};

    if (
        !mongoose.isValidObjectId(rideId) ||
        !Number.isInteger(rating) ||
        rating < 1 ||
        rating > 5 ||
        typeof comment !== "string" ||
        comment.length > 1000
    ) {
        return res.status(400).json({
            success: false,
            message: "Invalid review details",
        });
    }

    try {
        const ride = await Ride.findOne({
            _id: rideId,
            passengerId: req.user._id,
            status: "TRIP_COMPLETED",
            driverId: { $ne: null },
        });

        if (!ride) {
            return res.status(403).json({
                success: false,
                message: "Completed ride required",
            });
        }

        await DriverReview.create({
            rideId: ride._id,
            passengerId: req.user._id,
            driverId: ride.driverId,
            rating,
            comment: comment.trim(),
        });

        const stats = await DriverReview.aggregate([
            {
                $match: {
                    driverId: ride.driverId,
                    isHidden: false,
                },
            },
            {
                $group: {
                    _id: "$driverId",
                    average: { $avg: "$rating" },
                    count: { $sum: 1 },
                },
            },
        ]);

        await Driver.updateOne(
            { _id: ride.driverId },
            {
                $set: {
                    rating: stats[0]?.average || 0,
                    ratingCount: stats[0]?.count || 0,
                },
            }
        );

        return res.status(201).json({
            success: true,
            message: "Review submitted successfully",
        });
    } catch (error) {
        if (error.code === 11000) {
            return res.status(409).json({
                success: false,
                message: "You already reviewed this ride",
            });
        }

        console.error("Review error:", error.message);

        return res.status(500).json({
            success: false,
            message: "Review submission failed",
        });
    }
};

module.exports = { submitDriverReview };