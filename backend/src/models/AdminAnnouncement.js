const mongoose = require("mongoose");

// An admin-created in-app popup message. Targets are snapshotted at
// creation time (the users who matched the admin's filters then), so
// later signups do not suddenly see old announcements, and later
// profile changes do not move a user in or out of the audience.
const adminAnnouncementSchema = new mongoose.Schema(
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
        },
        targetUserIds: [
            {
                type: mongoose.Schema.Types.ObjectId,
                ref: "User",
                index: true,
            },
        ],
        active: {
            type: Boolean,
            default: true,
        },
    },
    { timestamps: true }
);

module.exports = mongoose.model("AdminAnnouncement", adminAnnouncementSchema);
