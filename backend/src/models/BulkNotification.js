const mongoose = require("mongoose");

// ADDITIVE ONLY: a log of admin bulk push sends. No existing model or
// endpoint is changed. It exists so "only users not bulk-notified before"
// can be filtered reliably: notifiedUserIds holds the users for whom at
// least one device delivery succeeded in that bulk send.
const bulkNotificationSchema = new mongoose.Schema(
    {
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
        // Echo of the filters the admin chose, kept for history display.
        filter: {
            audience: {
                type: String,
                enum: ["ALL", "PASSENGER", "DRIVER"],
                default: "ALL",
            },
            lastHours: {
                type: Number,
                default: null,
            },
            driverDocuments: {
                type: String,
                enum: ["ALL", "NO_DOCUMENTS"],
                default: "ALL",
            },
            onlyNotBulkNotified: {
                type: Boolean,
                default: false,
            },
        },
        recipientUserIds: [
            {
                type: mongoose.Schema.Types.ObjectId,
                ref: "User",
                index: true,
            },
        ],
        notifiedUserIds: [
            {
                type: mongoose.Schema.Types.ObjectId,
                ref: "User",
                index: true,
            },
        ],
        successCount: {
            type: Number,
            default: 0,
        },
        failureCount: {
            type: Number,
            default: 0,
        },
        skippedNoDeviceCount: {
            type: Number,
            default: 0,
        },
        sentAt: {
            type: Date,
            default: Date.now,
        },
    },
    { timestamps: true }
);

module.exports = mongoose.model("BulkNotification", bulkNotificationSchema);
