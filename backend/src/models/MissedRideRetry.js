const mongoose = require("mongoose");

// Missed Ride Auto-Retry Notification (Safar To-Do #7). When a ride is
// cancelled or expires with NO driver available, the passenger is
// recorded here as awaiting a retry. As soon as any driver comes online
// in their range, they get one push so they can book again.
//
// One record per ride (rideId unique); a passenger is notified at most
// once per record (status PENDING -> NOTIFIED). Records older than
// MISSED_RIDE_RETRY_WINDOW_MS are ignored — a stale "book again" a day
// later is noise, not help.
const missedRideRetrySchema = new mongoose.Schema(
    {
        passengerId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
            index: true,
        },
        rideId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Ride",
            required: true,
            unique: true,
            index: true,
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
        vehicleType: {
            type: String,
            enum: ["BIKE", "RICKSHAW", "CAR_AC", "CAR_NON_AC"],
            required: true,
        },
        status: {
            type: String,
            enum: ["PENDING", "NOTIFIED"],
            default: "PENDING",
            index: true,
        },
        notifiedAt: { type: Date, default: null },
    },
    { timestamps: true }
);

missedRideRetrySchema.index({ pickup: "2dsphere" });
missedRideRetrySchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model("MissedRideRetry", missedRideRetrySchema);
