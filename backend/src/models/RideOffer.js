
const mongoose = require("mongoose");

const rideOfferSchema = new mongoose.Schema(
    {
        rideId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Ride",
            required: true,
            index: true,
        },
        driverId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Driver",
            required: true,
        },
        price: {
            type: Number,
            required: true,
            min: 1,
        },
        status: {
            type: String,
            enum: [
                "PENDING",
                "ACCEPTED",
                "REJECTED",
                "EXPIRED",
                "WITHDRAWN",
            ],
            default: "PENDING",
        },
        expiresAt: {
            type: Date,
            required: true,
        },
    },
    { timestamps: true }
);

// Prevent duplicate offers from the same driver on one ride
rideOfferSchema.index(
    { rideId: 1, driverId: 1 },
    { unique: true }
);

module.exports = mongoose.model("RideOffer", rideOfferSchema);
