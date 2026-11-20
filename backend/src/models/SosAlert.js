const mongoose = require("mongoose");

// ---------------------------------------------------------------------
// Safety — SOS / panic alerts (Safar To-Do #5, Phase 1).
//
// One row per SOS press. The alert is raised by the driver or the
// passenger of an ACTIVE ride and is seen by admins on the dashboard
// SOS Alerts page (GET /api/v1/admin/safety/sos-alerts). Nothing here
// changes any existing endpoint or response shape: this is a new
// collection read only by the new admin safety routes.
// ---------------------------------------------------------------------

const sosAlertSchema = new mongoose.Schema(
    {
        ride: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Ride",
            required: true,
            index: true,
        },
        reporter: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
            index: true,
        },
        reporterRole: {
            type: String,
            enum: ["DRIVER", "PASSENGER"],
            required: true,
        },
        // Snapshot of the reporter's GPS at SOS time (GeoJSON, [lng, lat]).
        location: {
            type: {
                type: String,
                enum: ["Point"],
                default: "Point",
            },
            coordinates: {
                type: [Number],
                default: undefined,
            },
        },
        note: {
            type: String,
            trim: true,
            maxlength: 500,
            default: "",
        },
        status: {
            type: String,
            enum: ["OPEN", "ACKNOWLEDGED", "RESOLVED"],
            default: "OPEN",
            index: true,
        },
        acknowledgedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            default: null,
        },
        acknowledgedAt: {
            type: Date,
            default: null,
        },
        adminNote: {
            type: String,
            trim: true,
            maxlength: 1000,
            default: "",
        },
    },
    { timestamps: true }
);

sosAlertSchema.index({ createdAt: -1 });

module.exports = mongoose.model("SosAlert", sosAlertSchema);
