const mongoose = require("mongoose");

const vehicleSchema = new mongoose.Schema({
    driverId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Driver",
        required: true,
        index: true,
    },
    vehicleType: {
        type: String,
        enum: ["BIKE", "RICKSHAW", "CAR_AC", "CAR_NON_AC"],
        required: true,
    },
    registrationNumber: {
        type: String,
        required: true,
        trim: true,
        uppercase: true,
    },
    make: { type: String, trim: true },
    model: { type: String, trim: true },
    color: { type: String, trim: true },
    modelYear: { type: Number, min: 1950 },
    verificationStatus: {
        type: String,
        enum: ["PENDING", "APPROVED", "REJECTED"],
        default: "PENDING",
    },
    isActive: { type: Boolean, default: true },
    registrationExpiryDate: {
        type: Date,
        default: null,
    },
}, { timestamps: true });

vehicleSchema.index({ registrationNumber: 1 }, { unique: true });

module.exports = mongoose.model("Vehicle", vehicleSchema);