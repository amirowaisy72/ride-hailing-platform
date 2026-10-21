const mongoose = require("mongoose");

const parcelOfferSchema = new mongoose.Schema({
    parcelId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "ParcelOrder",
        required: true,
        index: true,
    },
    driverId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Driver",
        required: true,
    },
    price: {
        type: Number,
        required: true,
        min: 1,
    },
    status: {
        type: String,
        enum: ["PENDING", "ACCEPTED", "REJECTED", "EXPIRED"],
        default: "PENDING",
    },
    expiresAt: {
        type: Date,
        required: true,
    },
}, { timestamps: true });

parcelOfferSchema.index(
    { parcelId: 1, driverId: 1 },
    { unique: true }
);

module.exports = mongoose.model("ParcelOffer", parcelOfferSchema);