const mongoose = require("mongoose");

const commissionSettingsSchema = new mongoose.Schema(
    {
        key: {
            type: String,
            default: "GLOBAL",
            unique: true,
            immutable: true,
        },

        percentage: {
            type: Number,
            required: true,
            min: 0,
            max: 100,
        },

        minimumWalletBalance: {
            type: Number,
            default: 0,
            min: 0,
        },

        isActive: {
            type: Boolean,
            default: true,
        },

        updatedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            default: null,
        },
    },
    { timestamps: true }
);

module.exports = mongoose.model(
    "CommissionSettings",
    commissionSettingsSchema
);