const mongoose = require("mongoose");

const pushDeviceSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
        index: true,
    },
    token: {
        type: String,
        required: true,
        unique: true,
    },
    platform: {
        type: String,
        enum: ["android", "ios"],
        required: true,
    },
    updatedAt: {
        type: Date,
        default: Date.now,
    },
});

module.exports = mongoose.model("PushDevice", pushDeviceSchema);