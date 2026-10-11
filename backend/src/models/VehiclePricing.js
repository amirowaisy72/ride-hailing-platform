const mongoose = require("mongoose");

const vehiclePricingSchema = new mongoose.Schema({
    vehicleType: {
        type: String,
        enum: ["BIKE", "RICKSHAW", "CAR_AC", "CAR_NON_AC"],
        required: true,
        unique: true,
    },
    baseFare: { type: Number, required: true, min: 0 },
    perKmRate: { type: Number, required: true, min: 0 },
    minimumFare: { type: Number, required: true, min: 0 },
    isActive: { type: Boolean, default: true },
}, { timestamps: true });

module.exports = mongoose.model("VehiclePricing", vehiclePricingSchema);