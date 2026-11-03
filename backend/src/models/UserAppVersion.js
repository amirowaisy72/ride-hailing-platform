const mongoose = require("mongoose");

// One row per user: the app version they last opened. The app reports
// this on launch/login (independent of push permission), so the admin
// dashboard can show how many users are on each version. Users on
// builds older than the reporting feature simply have no row and
// count as "unknown" until they update.
const userAppVersionSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
        unique: true,
        index: true,
    },
    appVersion: {
        type: String,
        required: true,
        trim: true,
    },
    appVersionCode: {
        type: Number,
        required: true,
    },
    platform: {
        type: String,
        enum: ["android", "ios"],
        default: "android",
    },
    updatedAt: {
        type: Date,
        default: Date.now,
    },
});

module.exports = mongoose.model("UserAppVersion", userAppVersionSchema);
