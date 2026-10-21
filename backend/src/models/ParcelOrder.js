const mongoose = require("mongoose");

const pointSchema = new mongoose.Schema({
    type: { type: String, enum: ["Point"], default: "Point" },
    coordinates: { type: [Number], required: true },
    address: { type: String, trim: true, maxlength: 300 },
}, { _id: false });

const parcelOrderSchema = new mongoose.Schema({
    customerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
        index: true,
    },
    driverId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Driver",
        default: null,
    },
    serviceType: {
        type: String,
        enum: ["SEND_PARCEL", "SHOP_PICKUP"],
        required: true,
    },
    status: {
        type: String,
        enum: [
            "REQUESTED", "DRIVER_ASSIGNED", "DRIVER_EN_ROUTE",
            "ARRIVED_AT_PICKUP", "PICKED_UP", "OUT_FOR_DELIVERY",
            "DELIVERED", "CANCELLED", "FAILED",
        ],
        default: "REQUESTED",
        index: true,
    },
    pickup: { type: pointSchema, required: true },
    destination: { type: pointSchema, required: true },
    sender: {
        name: { type: String, required: true, trim: true },
        phone: { type: String, required: true, trim: true },
    },
    receiver: {
        name: { type: String, required: true, trim: true },
        phone: { type: String, required: true, trim: true },
    },
    parcel: {
        category: {
            type: String,
            enum: ["DOCUMENTS", "FOOD", "CLOTHES", "ELECTRONICS", "OTHER"],
            required: true,
        },
        description: { type: String, trim: true, maxlength: 500 },
        weightKg: { type: Number, required: true, min: 0.01 },
        quantity: { type: Number, default: 1, min: 1 },
        photoUrl: { type: String, default: "" },
    },
    vehicleType: {
        type: String,
        enum: ["BIKE", "RICKSHAW", "CAR_NON_AC", "CAR_AC"],
        required: true,
    },
    requestedPrice: { type: Number, required: true, min: 1 },
    finalPrice: { type: Number, default: null },

    acceptedOfferId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "ParcelOffer",
        default: null,
    },

    assignedAt: { type: Date, default: null },
    paymentBy: {
        type: String,
        enum: ["SENDER", "RECEIVER"],
        default: "SENDER",
    },
    instructions: { type: String, maxlength: 500, default: "" },
    pickedUpAt: { type: Date, default: null },
    deliveredAt: { type: Date, default: null },
    pickupOtpHash: { type: String, default: null, select: false },
    deliveryOtpHash: { type: String, default: null, select: false },
    pickupOtpVerifiedAt: { type: Date, default: null },
    deliveryOtpVerifiedAt: { type: Date, default: null },
    pickupOtpAttempts: { type: Number, default: 0 },
    deliveryOtpAttempts: { type: Number, default: 0 },
}, { timestamps: true });

parcelOrderSchema.index({ pickup: "2dsphere" });
parcelOrderSchema.index({ customerId: 1, createdAt: -1 });
parcelOrderSchema.index({ status: 1, createdAt: -1 });
parcelOrderSchema.index({ driverId: 1, status: 1 });

module.exports = mongoose.model("ParcelOrder", parcelOrderSchema);