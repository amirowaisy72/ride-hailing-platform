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

        // Phase 4 — Buy & Deliver (PurchaseOrder) platform controls.
        // Admins manage these from the same GLOBAL settings document;
        // the settings singleton is extended, never forked.
        buyDeliverEnabled: {
            type: Boolean,
            default: true,
        },

        // Platform-wide maximum shopping value for a single purchase
        // order (PKR). null = no platform cap (per-partner limits and
        // the passenger's own approved maximum still apply).
        buyDeliverMaxOrderValue: {
            type: Number,
            default: null,
            min: 1,
        },

        // Radius (km) around the delivery location used when fanning a
        // new purchase request out to eligible partners.
        buyDeliverRadiusKm: {
            type: Number,
            default: 15,
            min: 1,
            max: 100,
        },

        // Admin-replaceable prohibited-goods terms for purchase
        // requests. An empty list means "use the conservative defaults"
        // in services/purchaseOrderService — never "no restrictions".
        buyDeliverBlockedTerms: {
            type: [{ type: String, trim: true, maxlength: 60 }],
            default: [],
        },

        // Phase 5 — Safar Rentals platform controls (same GLOBAL
        // singleton, extended never forked). The booking fee is paid
        // by the customer to the platform's receiving bank account
        // above (bankName / bankAccountTitle / bankAccountNumber) by
        // MANUAL transfer in the pilot and verified by an admin —
        // there is no gateway involved.
        rentalsEnabled: {
            type: Boolean,
            default: true,
        },

        // Platform booking fee as a percentage of the rental charges
        // (never of the security deposit). Disclosed to the passenger
        // before they request, and snapshotted onto every booking.
        rentalBookingFeePercent: {
            type: Number,
            default: 5,
            min: 0,
            max: 100,
        },

        // Launch gate (Amir): With Driver rentals launch first.
        // Self-Drive bookings stay impossible until an admin turns
        // this ON after licence/insurance/inspection procedures are
        // in place (Phase 8 gate).
        rentalsSelfDriveEnabled: {
            type: Boolean,
            default: false,
        },

        // Hours the passenger has to submit the booking-fee payment
        // after the provider accepts, before the calendar hold is
        // released and the vehicle becomes bookable again.
        rentalPaymentDeadlineHours: {
            type: Number,
            default: 24,
            min: 1,
            max: 168,
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