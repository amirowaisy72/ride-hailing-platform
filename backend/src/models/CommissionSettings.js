const mongoose = require("mongoose");

const commissionSettingsSchema = new mongoose.Schema(
    {
        key: {
            type: String,
            default: "GLOBAL",
            unique: true,
            immutable: true,
        },

        percentage: {
            type: Number,
            required: true,
            min: 0,
            max: 100,
        },

        minimumWalletBalance: {
            type: Number,
            default: 0,
            min: 0,
        },

        topUpRequired: {
            type: Boolean,
            default: false,
        },

        onlineTopUpEnabled: {
            type: Boolean,
            default: false,
        },

        paymentGateway: {
            type: String,
            enum: [
                "DISABLED",
                "SANDBOX",
                "JAZZCASH",
                "EASYPAISA",
                "UBL",
                "BANK_TRANSFER",
            ],
            default: "DISABLED",
        },

        paymentEnvironment: {
            type: String,
            enum: ["TEST", "LIVE"],
            default: "TEST",
        },

        // Dashboard-managed gateway callback URLs. Both fall back to
        // the PAYMENT_RETURN_URL / PAYMENT_RESULT_URL environment
        // variables when empty (see services/paymentsConfigService).
        paymentReturnUrl: {
            type: String,
            default: "",
            trim: true,
            maxlength: 500,
        },

        paymentResultUrl: {
            type: String,
            default: "",
            trim: true,
            maxlength: 500,
        },

        // Receiving bank account for manual BANK_TRANSFER top-ups.
        // Drivers transfer to this account; an admin verifies the
        // transfer and the wallet is credited. All three fields must
        // be set for bank transfer to count as "configured".
        bankName: {
            type: String,
            default: "",
            trim: true,
            maxlength: 120,
        },

        bankAccountTitle: {
            type: String,
            default: "",
            trim: true,
            maxlength: 120,
        },

        bankAccountNumber: {
            type: String,
            default: "",
            trim: true,
            maxlength: 64,
        },

        bankTransferNote: {
            type: String,
            default: "",
            trim: true,
            maxlength: 500,
        },

        merchantPaymentsConfigured: {
            type: Boolean,
            default: false,
            immutable: true,
        },

        // Merchant credentials aur server verification ready hone tak
        // online wallet top-ups disabled rahenge.
        paymentVerificationRequired: {
            type: Boolean,
            default: true,
            immutable: true,
        },

        freeWaitingMinutes: {
            type: Number,
            default: 5,
            min: 0,
            max: 120,
        },

        waitingChargePerMinute: {
            type: Number,
            default: 0,
            min: 0,
        },

        isActive: {
            type: Boolean,
            default: true,
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
    "CommissionSettings",
    commissionSettingsSchema
);