const mongoose = require("mongoose");

// Driver online-transition log — ADDITIVE ONLY.
//
// The Driver document only keeps the CURRENT online flag
// (isOnline) and the latest location ping (lastLocationUpdate),
// so the time a driver CAME online on a past day cannot be
// computed retroactively from stored data. This collection
// records every false -> true transition (and closes the open
// event on true -> false) so the admin Daily Averages can
// answer "at what time did drivers come online today" going
// forward. It is written fire-and-forget from
// driverController.updateOnlineStatus and can never fail the
// driver's online toggle; no existing endpoint, response shape
// or required field is changed.
const driverOnlineEventSchema = new mongoose.Schema(
    {
        driverId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Driver",
            required: true,
            index: true,
        },
        // PKT calendar date (YYYY-MM-DD, Asia/Karachi) of onlineAt,
        // stored as a plain string so the daily query is a simple
        // equality match on an indexed field.
        date: {
            type: String,
            required: true,
            index: true,
            trim: true,
        },
        onlineAt: {
            type: Date,
            required: true,
            index: true,
        },
        // Set when the driver toggles offline (or null while the
        // session is still open — e.g. app killed without toggling).
        offlineAt: {
            type: Date,
            default: null,
        },
    },
    { timestamps: true }
);

driverOnlineEventSchema.index({ date: 1, driverId: 1, onlineAt: 1 });

module.exports = mongoose.model(
    "DriverOnlineEvent",
    driverOnlineEventSchema
);
