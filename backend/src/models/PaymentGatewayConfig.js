const mongoose = require("mongoose");

const paymentGatewayConfigSchema = new mongoose.Schema(
    {
        provider: {
            type: String,
            enum: ["JAZZCASH", "EASYPAISA", "UBL", "BANK_TRANSFER"],
            required: true,
            unique: true,
        },
        environment: {
            type: String,
            enum: ["TEST", "LIVE"],
            default: "TEST",
            required: true,
        },
        encryptedCredentials: {
            type: String,
            required: true,
            select: false,
        },
        enabled: {
            type: Boolean,
            default: false,
        },
        verified: {
            type: Boolean,
            default: false,
        },
        verifiedAt: {
            type: Date,
            default: null,
        },
        updatedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            default: null,
        },
    },
    { timestamps: true }
);

module.exports = mongoose.model(
    "PaymentGatewayConfig",
    paymentGatewayConfigSchema
);