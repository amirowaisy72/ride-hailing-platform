
const mongoose = require("mongoose");

const integrationSettingSchema = new mongoose.Schema(
    {
        key: {
            type: String,
            required: true,
            unique: true,
            enum: [
                "google-login",
                "push-notifications",
                "otp-email",
                "maps-routing",
                "cloudinary-uploads",
            ],
        },
        enabled: {
            type: Boolean,
            default: true,
        },
        updatedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
        },
    },
    { timestamps: true }
);

module.exports = mongoose.model(
    "IntegrationSetting",
    integrationSettingSchema
);
