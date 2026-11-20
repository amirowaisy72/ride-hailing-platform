
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
        // Passenger No-Show Fix (To-Do #1) — all additive, defaults
        // keep every existing ride working.
        // (d) Pre-departure confirmation: the passenger confirms they
        // are ready at pickup before the driver starts driving there.
        pickupConfirmedByPassenger: { type: Boolean, default: false },
        pickupConfirmedAt: { type: Date, default: null },
        // (a)+(c) Arrival wait timer: set when the driver marks
        // DRIVER_ARRIVED; the driver may cancel as a no-show with no
        // penalty only once now >= noShowWaitExpiresAt.
        noShowWaitExpiresAt: { type: Date, default: null },
        // Outcome of a no-show cancel, if one happened.
        noShowAt: { type: Date, default: null },
        noShowByDriverId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Driver",
            default: null,
        },
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
        // Safety — live trip sharing (To-Do #5, Phase 1, item c).
        // ADDITIVE optional: a 24-hour token for the public share link.
        // Old clients never read or write these fields.
        shareToken: { type: String, default: null, index: true },
        shareTokenExpiresAt: { type: Date, default: null },
    },
    { timestamps: true }
);

rideSchema.index({ pickup: "2dsphere" });

module.exports = mongoose.model("Ride", rideSchema);
