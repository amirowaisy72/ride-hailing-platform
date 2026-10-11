const mongoose = require("mongoose");

const rideSettlementSchema = new mongoose.Schema(
    {
        rideId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Ride",
            required: true,
            unique: true,
        },
        driverId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Driver",
            required: true,
            index: true,
        },
        fare: {
            type: Number,
            required: true,
            min: 1,
        },
        commission: {
            type: Number,
            required: true,
            min: 0,
        },
        commissionPercentage: {
            type: Number,
            required: true,
            min: 0,
            max: 100,
        },
        driverEarnings: {
            type: Number,
            required: true,
            min: 0,
        },
        currency: {
            type: String,
            default: "PKR",
        },
        status: {
            type: String,
            enum: ["PENDING", "SETTLED", "FAILED"],
            default: "PENDING",
            index: true,
        },
        settledAt: {
            type: Date,
            default: null,
        },
        lastError: {
            type: String,
            default: "",
            maxlength: 500,
        },
    },
    { timestamps: true }
);

module.exports = mongoose.model("RideSettlement", rideSettlementSchema);