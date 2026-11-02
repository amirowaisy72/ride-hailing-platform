const mongoose = require("mongoose");

// Server-side "seen" record: one row per (announcement, user). This is
// what makes an announcement show exactly once — closing it marks it
// read here, so it never returns, even after reinstall, a new device,
// or a session clear. Local storage alone could not promise that.
const announcementReadSchema = new mongoose.Schema(
    {
        announcementId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "AdminAnnouncement",
            required: true,
            index: true,
        },
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
            index: true,
        },
        readAt: {
            type: Date,
            default: Date.now,
        },
    },
    { timestamps: true }
);

announcementReadSchema.index(
    { announcementId: 1, userId: 1 },
    { unique: true }
);

module.exports = mongoose.model("AnnouncementRead", announcementReadSchema);
