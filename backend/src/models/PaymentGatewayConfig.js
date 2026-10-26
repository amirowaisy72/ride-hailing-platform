const mongoose = require("mongoose");

const paymentGatewayConfigSchema = new mongoose.Schema(
    {
        provider: {
            type: String,
            enum: ["JAZZCASH", "EASYPAISA", "UBL", "BANK_TRANSFER"],
            required: true,
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

// One configuration per provider PER environment: TEST and LIVE
// credentials coexist and never overwrite each other.
paymentGatewayConfigSchema.index(
    { provider: 1, environment: 1 },
    { unique: true }
);

module.exports = mongoose.model(
    "PaymentGatewayConfig",
    paymentGatewayConfigSchema
);