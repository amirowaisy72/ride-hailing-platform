const mongoose = require("mongoose");

// Server-side record of rides a driver explicitly missed. This is what
// makes "missed" permanent: the old sessionStorage-only dismiss came
// back on every app refresh, because the ride was still in the feed.
// One row per (driver, ride); a second miss of the same ride is a no-op.
const driverMissedRideSchema = new mongoose.Schema(
    {
        driverId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Driver",
            required: true,
            index: true,
        },
        rideId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Ride",
            required: true,
            index: true,
        },
    },
    { timestamps: true }
);

driverMissedRideSchema.index({ driverId: 1, rideId: 1 }, { unique: true });

module.exports = mongoose.model("DriverMissedRide", driverMissedRideSchema);
