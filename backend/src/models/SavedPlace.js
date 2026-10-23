const mongoose = require("mongoose");

const savedPlaceSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
            index: true,
        },
        type: {
            type: String,
            enum: ["HOME", "WORK", "FAVORITE"],
            required: true,
        },
        name: {
            type: String,
            required: true,
            trim: true,
            maxlength: 100,
        },
        address: {
            type: String,
            default: "",
            trim: true,
            maxlength: 300,
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
    },
    { timestamps: true }
);

// Only one HOME and one WORK per passenger.
savedPlaceSchema.index(
    { userId: 1, type: 1 },
    {
        unique: true,
        partialFilterExpression: {
            type: { $in: ["HOME", "WORK"] },
        },
    }
);

module.exports = mongoose.model("SavedPlace", savedPlaceSchema);