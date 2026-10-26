const mongoose = require("mongoose");

const paymentOrderSchema = new mongoose.Schema(
    {
        driverId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Driver",
            required: true,
            index: true,
        },
        gateway: {
            type: String,
            enum: [
                "JAZZCASH",
                "EASYPAISA",
                "UBL",
                "BANK_TRANSFER",
            ],
            required: true,
        },
        environment: {
            type: String,
            enum: ["TEST", "LIVE"],
            default: "TEST",
            required: true,
        },
        merchantTxnReference: {
            type: String,
            trim: true,
            maxlength: 30,
            default: null,
        },
        amount: {
            type: Number,
            required: true,
            min: 1,
            max: 1000000,
            validate: Number.isSafeInteger,
        },
        currency: {
            type: String,
            enum: ["PKR"],
            default: "PKR",
        },
        status: {
            type: String,
            enum: [
                "PENDING",
                "VERIFYING",
                "VERIFIED",
                "CREDITED",
                "FAILED",
                "EXPIRED",
            ],
            default: "PENDING",
            index: true,
        },
        gatewayReference: {
            type: String,
            trim: true,
            maxlength: 150,
            default: null,
        },
        verificationSource: {
            type: String,
            enum: ["GATEWAY_API", "SIGNED_WEBHOOK", "BANK_RECONCILIATION"],
            default: null,
        },
        verifiedAmount: {
            type: Number,
            min: 1,
            default: null,
        },
        verifiedAt: {
            type: Date,
            default: null,
        },
        verificationReference: {
            type: String,
            trim: true,
            maxlength: 150,
            default: null,
        },
        creditedAt: {
            type: Date,
            default: null,
        },
        walletTransactionId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "WalletTransaction",
            default: null,
        },
        expiresAt: {
            type: Date,
            required: true,
        },
        creditedAmount: {
            type: Number,
            min: 0,
            default: 0,
        },
        failureReason: {
            type: String,
            maxlength: 500,
            default: "",
        },
    },
    { timestamps: true }
);

paymentOrderSchema.index(
    { merchantTxnReference: 1 },
    {
        unique: true,
        partialFilterExpression: {
            merchantTxnReference: { $type: "string" },
        },
    }
);

paymentOrderSchema.index(
    { gateway: 1, gatewayReference: 1 },
    {
        unique: true,
        partialFilterExpression: {
            gatewayReference: { $type: "string" },
        },
    }
);

module.exports = mongoose.model(
    "PaymentOrder",
    paymentOrderSchema
);