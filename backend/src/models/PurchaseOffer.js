const mongoose = require("mongoose");

// Phase 4 — a partner's delivery-fee offer on a PurchaseOrder.
// Modelled directly on ParcelOffer (unique per driver per order,
// expiring, resubmission refreshes the fee), except the offered amount
// is a DELIVERY FEE — the shopping cost itself is never bid on; it is
// reimbursed at actuals against the passenger-approved cap.
const purchaseOfferSchema = new mongoose.Schema({
    orderId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "PurchaseOrder",
        required: true,
        index: true,
    },
    driverId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Driver",
        required: true,
    },
    deliveryFee: {
        type: Number,
        required: true,
        min: 1,
    },
    status: {
        type: String,
        enum: ["PENDING", "ACCEPTED", "REJECTED", "EXPIRED", "WITHDRAWN"],
        default: "PENDING",
    },
    expiresAt: {
        type: Date,
        required: true,
    },
}, { timestamps: true });

purchaseOfferSchema.index(
    { orderId: 1, driverId: 1 },
    { unique: true }
);

module.exports = mongoose.model("PurchaseOffer", purchaseOfferSchema);
