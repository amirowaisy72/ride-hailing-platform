const mongoose = require("mongoose");

// ---------------------------------------------------------------------
// Safety — GPS trail (Safar To-Do #5, Phase 1, item d).
//
// Until now a ride kept only the driver's CURRENT location (overwritten
// on every fix), so after a trip there was no record of where the
// vehicle actually went. This collection keeps a sampled trail — one
// point per ride at most every ~15 seconds while the trip is active —
// so the full route plus driver/passenger details can be retrieved for
// a police complaint (FIR) from GET /api/v1/admin/safety/rides/:id/trail.
// Additive only: no existing write path changes behaviour, points are
// appended best-effort and a trail failure never fails a location update.
// ---------------------------------------------------------------------

const rideLocationTrailSchema = new mongoose.Schema(
    {
        ride: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Ride",
            required: true,
            index: true,
        },
        driver: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Driver",
            required: true,
            index: true,
        },
        location: {
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
        recordedAt: {
            type: Date,
            default: Date.now,
            index: true,
        },
    },
    { timestamps: false }
);

rideLocationTrailSchema.index({ ride: 1, recordedAt: 1 });
rideLocationTrailSchema.index({ location: "2dsphere" });

module.exports = mongoose.model("RideLocationTrail", rideLocationTrailSchema);
