const mongoose = require("mongoose");

// One row per user, always overwritten with the latest admin notification.
// This keeps database use tiny: no per-notification history is stored here.
// A user notified again simply updates this same row (title, body, time).
const lastAdminNotificationSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
            unique: true,
            index: true,
        },
        title: {
            type: String,
            required: true,
            trim: true,
        },
        body: {
            type: String,
            required: true,
            trim: true,
        },
        // SINGLE = one-user custom notification, BULK = bulk send.
        source: {
            type: String,
            enum: ["SINGLE", "BULK"],
            default: "SINGLE",
        },
        sentAt: {
            type: Date,
            required: true,
            index: true,
        },
    },
    { timestamps: true }
);

module.exports = mongoose.model(
    "LastAdminNotification",
    lastAdminNotificationSchema
);
