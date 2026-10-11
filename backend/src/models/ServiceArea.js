const mongoose = require("mongoose");

const serviceAreaSchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: true,
            trim: true,
        },
        city: {
            type: String,
            required: true,
            trim: true,
        },
        polygon: {
            type: {
                type: String,
                enum: ["Polygon"],
                required: true,
                default: "Polygon",
            },
            coordinates: {
                type: [[[Number]]],
                required: true,
            },
        },
        active: {
            type: Boolean,
            default: false,
        },
    },
    { timestamps: true }
);

serviceAreaSchema.index({ polygon: "2dsphere" });

module.exports = mongoose.model("ServiceArea", serviceAreaSchema);