const mongoose = require("mongoose");

// Per-driver dismissal of an available Buy & Deliver request.
// A decline hides the request ONLY for the declining partner: the order
// itself is untouched (it stays BIDDING for every other partner), so
// recording a decline can never disturb the live passenger flow.
const declinedPurchaseRequestSchema = new mongoose.Schema({
    driverId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Driver",
        required: true,
        index: true,
    },
    orderId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "PurchaseOrder",
        required: true,
        index: true,
    },
    createdAt: { type: Date, default: Date.now },
});

declinedPurchaseRequestSchema.index({ driverId: 1, orderId: 1 }, { unique: true });

module.exports = mongoose.model(
    "DeclinedPurchaseRequest",
    declinedPurchaseRequestSchema
);
