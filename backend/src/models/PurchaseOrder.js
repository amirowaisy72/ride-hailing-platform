const mongoose = require("mongoose");
const { PURCHASE_STATUSES } = require("../services/purchaseOrderService");

// Phase 4 — Buy & Deliver (Kharid Kar Lao) order. A DEDICATED domain:
// it deliberately does NOT extend ParcelOrder, whose lifecycle assumes a
// fixed pickup point, a parcel weight and a vehicle type. A purchase
// order has none of those — the passenger states what they want, an
// eligible partner shops at a store of their choosing, and the money is
// settled as COD reimbursement + a negotiated delivery fee.
//
// Financial layout (see services/purchaseOrderService for the rules):
// the `financial` block lives ON THE ORDER. Shopping money advanced by
// the partner is a reimbursement owed by the passenger — it is never
// wallet money and never earnings. Only the delivery fee can ever be
// commissioned, via PurchaseSettlement, mirroring ParcelSettlement.

const pointSchema = new mongoose.Schema({
    type: { type: String, enum: ["Point"], default: "Point" },
    coordinates: { type: [Number], required: true },
    address: { type: String, trim: true, maxlength: 300 },
}, { _id: false });

// Append-only audit trail: every status change and every monetary event
// (offer accepted, estimate submitted, amount approved, purchase made,
// payment recorded...) is a server-validated entry here. Ordinary chat
// messages NEVER write to this log — amounts can only move through the
// validated API actions that append these events.
const purchaseOrderEventSchema = new mongoose.Schema({
    type: { type: String, required: true, maxlength: 60 },
    actorRole: {
        type: String,
        enum: ["PASSENGER", "DRIVER", "ADMIN", "SYSTEM"],
        default: "SYSTEM",
    },
    actorId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        default: null,
    },
    fromStatus: { type: String, default: null },
    toStatus: { type: String, default: null },
    amount: { type: Number, default: null },
    note: { type: String, default: "", maxlength: 500 },
    createdAt: { type: Date, default: Date.now },
}, { _id: false });

const substitutionSchema = new mongoose.Schema({
    description: { type: String, required: true, trim: true, maxlength: 300 },
    status: {
        type: String,
        enum: ["PENDING", "APPROVED", "REJECTED"],
        default: "PENDING",
    },
    createdAt: { type: Date, default: Date.now },
    decidedAt: { type: Date, default: null },
}, { timestamps: false });

const purchaseOrderSchema = new mongoose.Schema({
    passengerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
        index: true,
    },
    // The assigned Buy & Deliver partner (a Driver record). Null until
    // the passenger accepts exactly one offer.
    driverId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Driver",
        default: null,
    },
    status: {
        type: String,
        enum: PURCHASE_STATUSES,
        default: "REQUESTED",
        index: true,
    },

    // --- The request itself: NO store selection, NO pickup pin. -------
    itemsText: {
        type: String,
        required: true,
        trim: true,
        maxlength: 2000,
    },
    // Product reference photos (Cloudinary URLs uploaded via the
    // existing upload path).
    imageUrls: {
        type: [{ type: String, maxlength: 1000 }],
        default: [],
    },
    preferences: {
        preferredShop: { type: String, default: "", trim: true, maxlength: 120 },
        preferredBrand: { type: String, default: "", trim: true, maxlength: 120 },
        alternativesAllowed: { type: Boolean, default: false },
        alternativesNote: { type: String, default: "", trim: true, maxlength: 300 },
    },
    deliveryNotes: { type: String, default: "", trim: true, maxlength: 500 },

    // Delivery destination (mandatory; defaults to the passenger's HOME
    // saved place at creation when not supplied).
    deliveryAddress: { type: pointSchema, required: true },
    deliveryLabel: { type: String, default: "", trim: true, maxlength: 60 },

    // Set by the assigned partner once they choose where to shop
    // (spec: matching never assumes a store coordinate exists).
    shoppingLocation: {
        point: { type: pointSchema, default: null },
        name: { type: String, default: "", trim: true, maxlength: 120 },
    },

    acceptedOfferId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "PurchaseOffer",
        default: null,
    },

    // --- Financial block (PKR, whole numbers) --------------------------
    // Passenger's own estimate / spending cap stated at creation.
    estimatedBudget: { type: Number, required: true, min: 1 },
    // Partner's latest submitted shopping-cost estimate.
    estimatedCost: { type: Number, default: null },
    // The maximum the passenger has EXPLICITLY approved the partner to
    // spend. Purchases above this are impossible without renewed
    // approval (enforced in the controller via purchaseOrderService).
    approvedMaxAmount: { type: Number, default: null },
    // What the partner actually spent (receipt-backed).
    actualCost: { type: Number, default: null },
    // Negotiated delivery fee — from the accepted PurchaseOffer. This
    // is the partner's service charge and the ONLY commissionable part.
    deliveryFee: { type: Number, default: null },
    // actualCost + deliveryFee, computed when the purchase is recorded.
    customerTotalPayable: { type: Number, default: null },
    // COD actually received by the partner from the passenger.
    reimbursementReceived: { type: Number, default: 0, min: 0 },
    // customerTotalPayable - reimbursementReceived (never negative).
    unpaidAmount: { type: Number, default: 0, min: 0 },
    // Timestamp of the passenger's amount approval — the moment they
    // acknowledged the COD obligation.
    codAcknowledgedAt: { type: Date, default: null },

    receiptImageUrls: {
        type: [{ type: String, maxlength: 1000 }],
        default: [],
    },

    substitutions: { type: [substitutionSchema], default: [] },
    events: { type: [purchaseOrderEventSchema], default: [] },

    // Commission settlement on the DELIVERY FEE only (mirrors
    // ParcelOrder's settlement fields; settled by
    // services/purchaseSettlementService after delivery).
    settlementStatus: {
        type: String,
        enum: ["NOT_REQUIRED", "PENDING", "SETTLED", "FAILED"],
        default: "NOT_REQUIRED",
        index: true,
    },
    settlementAttempts: { type: Number, default: 0 },
    settledAt: { type: Date, default: null },
    settlementError: { type: String, default: "", maxlength: 500 },

    // Delivery OTP — parcel pattern verbatim: SHA-256 hash on the
    // order, 6 digits, max 5 attempts enforced atomically.
    deliveryOtpHash: { type: String, default: null, select: false },
    deliveryOtpVerifiedAt: { type: Date, default: null },
    deliveryOtpAttempts: { type: Number, default: 0 },

    // Lifecycle timestamps.
    assignedAt: { type: Date, default: null },
    shoppingStartedAt: { type: Date, default: null },
    purchasedAt: { type: Date, default: null },
    outForDeliveryAt: { type: Date, default: null },
    arrivedAt: { type: Date, default: null },
    deliveredAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    ratedAt: { type: Date, default: null },

    cancelledBy: {
        type: String,
        enum: ["PASSENGER", "DRIVER", "ADMIN", null],
        default: null,
    },
    cancelReason: { type: String, default: "", maxlength: 500 },
    cancelledAt: { type: Date, default: null },

    disputedBy: {
        type: String,
        enum: ["PASSENGER", "DRIVER", null],
        default: null,
    },
    disputeReason: { type: String, default: "", maxlength: 500 },
    disputedAt: { type: Date, default: null },
    // Phase 7 — admin dispute resolution record. The outcome set and
    // its financial rules live in
    // services/purchaseOrderService.evaluatePurchaseDisputeResolution;
    // DISPUTED stays terminal for every non-admin action.
    disputeResolution: {
        outcome: {
            type: String,
            enum: ["COMPLETED", "CANCELLED", null],
            default: null,
        },
        note: { type: String, default: "", maxlength: 500 },
        resolvedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            default: null,
        },
        resolvedAt: { type: Date, default: null },
    },
}, { timestamps: true });

purchaseOrderSchema.index({ deliveryAddress: "2dsphere" });
purchaseOrderSchema.index({ passengerId: 1, createdAt: -1 });
purchaseOrderSchema.index({ status: 1, createdAt: -1 });
purchaseOrderSchema.index({ driverId: 1, status: 1 });

module.exports = mongoose.model("PurchaseOrder", purchaseOrderSchema);
