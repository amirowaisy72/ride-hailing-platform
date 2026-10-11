
const mongoose = require("mongoose");

const rideSchema = new mongoose.Schema(
    {
        passengerId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
            index: true,
        },
        driverId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Driver",
            default: null,
        },
        status: {
            type: String,
            enum: [
                "REQUESTED", "SEARCHING", "BIDDING",
                "DRIVER_SELECTED", "DRIVER_EN_ROUTE",
                "DRIVER_ARRIVED", "TRIP_STARTED",
                "TRIP_COMPLETED", "CANCELLED",
                "EXPIRED", "REASSIGNING",
            ],
            default: "REQUESTED",
        },
        pickup: {
            type: {
                type: String,
                enum: ["Point"],
                default: "Point",
            },
            coordinates: {
                type: [Number],
                required: true,
            },
        },
        destination: {
            type: {
                type: String,
                enum: ["Point"],
                default: "Point",
            },
            coordinates: {
                type: [Number],
                required: true,
            },
        },
        stops: {
            type: [{
                type: {
                    type: String,
                    enum: ["Point"],
                    default: "Point",
                },
                coordinates: {
                    type: [Number],
                    required: true,
                },
                name: {
                    type: String,
                    trim: true,
                    maxlength: 200,
                    default: "",
                },
                _id: false,
            }],
            default: [],
        },
        stopsCompleted: { type: Number, default: 0, min: 0 },
        stopWaitingSince: { type: Date, default: null },
        totalStopWaitingSeconds: { type: Number, default: 0, min: 0 },
        requestedPrice: { type: Number, required: true, min: 1 },
        finalPrice: { type: Number, default: null },
        settlementStatus: {
            type: String,
            enum: ["NOT_REQUIRED", "PENDING", "SETTLED", "FAILED"],
            default: "NOT_REQUIRED",
            index: true,
        },
        settlementAttempts: {
            type: Number,
            default: 0,
            min: 0,
        },
        settledAt: {
            type: Date,
            default: null,
        },
        currency: { type: String, default: "PKR", enum: ["PKR"] },
        distance: { type: Number, required: true },
        estimatedDuration: { type: Number, required: true },
        vehicleType: {
            type: String,
            enum: ["BIKE", "RICKSHAW", "CAR_AC", "CAR_NON_AC"],
            required: true,
        },
        passengerCount: { type: Number, default: 1, min: 1 },
        notes: { type: String, default: "" },
        requestedAt: { type: Date, default: Date.now },
        acceptedAt: Date,
        driverArrivedAt: Date,
        startedAt: Date,
        completedAt: Date,
        cancelledAt: Date,
        cancellationReason: String,
    },
    { timestamps: true }
);

rideSchema.index({ pickup: "2dsphere" });

module.exports = mongoose.model("Ride", rideSchema);
