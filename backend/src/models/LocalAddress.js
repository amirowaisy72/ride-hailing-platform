
const mongoose = require("mongoose");

const localAddressSchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: true,
            trim: true,
            maxlength: 120,
        },
        city: {
            type: String,
            required: true,
            trim: true,
            maxlength: 80,
        },
        street: {
            type: String,
            trim: true,
            maxlength: 120,
            default: "",
        },
        mohalla: {
            type: String,
            trim: true,
            maxlength: 120,
            default: "",
        },
        landmark: {
            type: String,
            trim: true,
            maxlength: 120,
            default: "",
        },
        latitude: {
            type: Number,
            required: true,
            min: -90,
            max: 90,
        },
        longitude: {
            type: Number,
            required: true,
            min: -180,
            max: 180,
        },
        active: {
            type: Boolean,
            default: true,
        },
    },
    { timestamps: true }
);

localAddressSchema.index({ city: 1, active: 1 });

module.exports = mongoose.model(
    "LocalAddress",
    localAddressSchema
);
