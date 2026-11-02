const mongoose = require("mongoose");

// Single admin-controlled record for the Android app update prompt.
// The app compares its own versionCode (App.getInfo().build) against
// latestVersionCode on every launch. No app code change is needed to
// announce a new release: the admin just updates these two numbers
// in the dashboard after the Play release goes live.
const appVersionConfigSchema = new mongoose.Schema(
    {
        platform: {
            type: String,
            enum: ["android"],
            default: "android",
            unique: true,
            index: true,
        },
        latestVersionCode: {
            type: Number,
            required: true,
            min: 1,
        },
        latestVersionName: {
            type: String,
            required: true,
            trim: true,
        },
        // Deliberately no force/blocking flag: the user asked that the
        // popup must always be cancellable, so they can keep using
        // the app. Cancel only dismisses for this session; the popup
        // returns on the next app launch until the app is updated.
        message: {
            type: String,
            default: "",
            maxlength: 240,
        },
    },
    { timestamps: true }
);

module.exports = mongoose.model("AppVersionConfig", appVersionConfigSchema);
