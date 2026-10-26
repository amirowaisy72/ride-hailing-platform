
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

        pickupWaitingSince: { type: Date, default: null },
        pickupWaitingSeconds: { type: Number, default: 0, min: 0 },
        waitingCharge: { type: Number, default: 0, min: 0 },

        waitingSessions: {
            type: [{
                locationType: {
                    type: String,
                    enum: ["PICKUP", "STOP", "OUTBOUND_DESTINATION"],
                    required: true,
                },
                locationIndex: { type: Number, default: 0 },
                startedAt: { type: Date, required: true },
                endedAt: { type: Date, required: true },
                durationSeconds: { type: Number, min: 0 },
                freeMinutes: { type: Number, min: 0 },
                chargePerMinute: { type: Number, min: 0 },
                chargedAmount: { type: Number, min: 0 },
            }],
            default: [],
        },
        tripType: {
            type: String,
            enum: ["ONE_WAY", "ROUND_TRIP"],
            default: "ONE_WAY",
        },
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
        settlementError: {
            type: String,
            default: "",
            maxlength: 500,
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
