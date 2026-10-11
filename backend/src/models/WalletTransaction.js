
const mongoose = require("mongoose");

const walletTransactionSchema = new mongoose.Schema(
    {
        walletId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "DriverWallet",
            required: true,
            index: true,
        },
        driverId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Driver",
            required: true,
            index: true,
        },
        rideId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Ride",
            default: null,
        },
        type: {
            type: String,
            enum: [
                "TOP_UP",
                "COMMISSION_DEBIT",
                "REFUND",
                "ADMIN_ADJUSTMENT",
            ],
            required: true,
        },
        amount: {
            type: Number,
            required: true,
            min: 1,
        },
        balanceBefore: {
            type: Number,
            required: true,
        },
        balanceAfter: {
            type: Number,
            required: true,
        },
        description: {
            type: String,
            trim: true,
            maxlength: 500,
            default: "",
        },
        idempotencyKey: {
            type: String,
            required: true,
            unique: true,
        },
        createdBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            default: null,
        },
    },
    { timestamps: true }
);

walletTransactionSchema.index({ driverId: 1, createdAt: -1 });

walletTransactionSchema.index(
    { rideId: 1, type: 1 },
    {
        unique: true,
        partialFilterExpression: {
            rideId: { $type: "objectId" },
            type: "COMMISSION_DEBIT",
        },
    }
);

module.exports = mongoose.model(
    "WalletTransaction",
    walletTransactionSchema
);
