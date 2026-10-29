const mongoose = require("mongoose");

// Phase 4 — Buy & Deliver commission settlement, mirroring
// ParcelSettlement field-for-field. `fare` here is the DELIVERY FEE
// only: the shopping reimbursement is not a fare, is never commissioned
// and never passes through this record or the driver wallet.
const purchaseSettlementSchema = new mongoose.Schema(
    {
        purchaseOrderId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "PurchaseOrder",
            required: true,
            unique: true,
        },
        driverId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Driver",
            required: true,
            index: true,
        },
        fare: {
            type: Number,
            required: true,
            min: 1,
        },
        commission: {
            type: Number,
            required: true,
            min: 0,
        },
        commissionPercentage: {
            type: Number,
            required: true,
            min: 0,
            max: 100,
        },
        driverEarnings: {
            type: Number,
            required: true,
            min: 0,
        },
        currency: {
            type: String,
            default: "PKR",
        },
        status: {
            type: String,
            enum: ["PENDING", "SETTLED", "FAILED"],
            default: "PENDING",
            index: true,
        },
        settledAt: {
            type: Date,
            default: null,
        },
        lastError: {
            type: String,
            default: "",
            maxlength: 500,
        },
    },
    { timestamps: true }
);

module.exports = mongoose.model("PurchaseSettlement", purchaseSettlementSchema);
