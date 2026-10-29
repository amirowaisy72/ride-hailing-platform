const mongoose = require("mongoose");
const { RENTAL_STATUSES } = require("../services/rentalBookingService");

// Phase 5 — Safar Rentals booking. A dedicated domain on the common
// User account: the passenger is any Safar user; the provider is a
// RentalPartner (Phase 2), never a ride Driver record.
//
// Financial layout (rules in services/rentalBookingService.js): THREE
// amounts live on the booking, always separate —
//   rentalCharges   the partner's money,
//   bookingFee      Safar's platform fee (customer-paid, % snapshot of
//                   rentalCharges), collected BEFORE confirmation,
//   securityDeposit refundable, collected by the partner at handover.
// In the pilot the booking fee is paid by VERIFIED MANUAL PAYMENT ONLY
// (bank transfer to the platform account in CommissionSettings; the
// passenger submits a reference + proof, an admin verifies, and only
// then may the booking become CONFIRMED). No gateway is involved.

const rentalBookingEventSchema = new mongoose.Schema({
    type: { type: String, required: true, maxlength: 60 },
    actorRole: {
        type: String,
        enum: ["PASSENGER", "PARTNER", "ADMIN", "SYSTEM"],
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

const inspectionSchema = new mongoose.Schema({
    recordedAt: { type: Date, default: null },
    recordedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        default: null,
    },
    fuelLevelPercent: { type: Number, default: null, min: 0, max: 100 },
    odometerKm: { type: Number, default: null, min: 0 },
    photoUrls: { type: [{ type: String, maxlength: 1000 }], default: [] },
    notes: { type: String, default: "", maxlength: 500 },
}, { _id: false });

const rentalBookingSchema = new mongoose.Schema({
    // Human-facing booking reference (Amir's plan: every confirmed
    // booking carries a unique ID). Generated at creation, unique.
    bookingRef: {
        type: String,
        required: true,
        unique: true,
        maxlength: 24,
    },
    passengerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
        index: true,
    },
    rentalPartnerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "RentalPartner",
        required: true,
        index: true,
    },
    partnerUserId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
        index: true,
    },
    vehicleId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "RentalVehicle",
        required: true,
        index: true,
    },
    status: {
        type: String,
        enum: RENTAL_STATUSES,
        default: "REQUESTED",
        index: true,
    },
    mode: {
        type: String,
        enum: ["SELF_DRIVE", "WITH_DRIVER"],
        required: true,
    },

    // The booked window. Overlap-guarded against the vehicle's other
    // holding bookings (see rentalBookingService.findBlockingBooking).
    startAt: { type: Date, required: true },
    endAt: { type: Date, required: true },
    billingUnit: {
        type: String,
        enum: ["HOURLY", "DAILY", "WEEKLY", "MONTHLY"],
        required: true,
    },
    units: { type: Number, required: true, min: 1 },
    ratePerUnit: { type: Number, required: true, min: 1 },

    // --- The three amounts (PKR, whole numbers) -----------------------
    rentalCharges: { type: Number, required: true, min: 1 },
    bookingFee: { type: Number, required: true, min: 0 },
    bookingFeePercent: { type: Number, required: true, min: 0, max: 100 },
    securityDeposit: { type: Number, required: true, min: 0 },

    // Self-Drive renter licence declaration (pilot — see
    // rentalBookingService.evaluateModeEligibility). Null for
    // WITH_DRIVER bookings, where no renter licence is required.
    renterLicence: {
        number: { type: String, default: null, trim: true, maxlength: 40 },
        expiryDate: { type: Date, default: null },
    },

    // --- Booking-fee manual payment -----------------------------------
    // status: NOT_SUBMITTED -> SUBMITTED -> VERIFIED | REJECTED
    // (REJECTED returns the proof to the passenger for resubmission;
    // the booking itself stays PAYMENT_PENDING).
    feePayment: {
        status: {
            type: String,
            enum: ["NOT_SUBMITTED", "SUBMITTED", "VERIFIED", "REJECTED"],
            default: "NOT_SUBMITTED",
        },
        method: { type: String, enum: ["BANK_TRANSFER"], default: "BANK_TRANSFER" },
        reference: { type: String, default: "", trim: true, maxlength: 120 },
        proofImageUrl: { type: String, default: "", maxlength: 1000 },
        senderAccountTitle: { type: String, default: "", trim: true, maxlength: 120 },
        submittedAt: { type: Date, default: null },
        verifiedAt: { type: Date, default: null },
        verifiedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            default: null,
        },
        rejectionReason: { type: String, default: "", maxlength: 500 },
    },
    // Set when the provider accepts: the temporary calendar hold and
    // the fee-payment clock. Expiry releases the vehicle (lazily, via
    // rentalBookingService.isHoldExpired on every read/overlap check).
    paymentDeadlineAt: { type: Date, default: null },

    // Pickup OTP — parcel/purchase pattern verbatim: SHA-256 hash on
    // the booking, 6 digits, max 5 attempts enforced atomically.
    pickupOtpHash: { type: String, default: null, select: false },
    pickupOtpAttempts: { type: Number, default: 0 },
    pickupOtpVerifiedAt: { type: Date, default: null },

    // Handover (pickup) + return inspection evidence.
    handover: { type: inspectionSchema, default: () => ({}) },
    returnInspection: { type: inspectionSchema, default: () => ({}) },
    // Computed from the two inspections by
    // rentalBookingService.computeRemainingDues at return time.
    returnDues: {
        drivenKm: { type: Number, default: null },
        extraKm: { type: Number, default: null },
        extraKmCharges: { type: Number, default: null },
        overtimeHours: { type: Number, default: null },
        overtimeCharges: { type: Number, default: null },
        otherDues: { type: Number, default: null },
        remainingDues: { type: Number, default: null },
        settledAt: { type: Date, default: null },
    },

    events: { type: [rentalBookingEventSchema], default: [] },

    // Lifecycle timestamps.
    acceptedAt: { type: Date, default: null },
    confirmedAt: { type: Date, default: null },
    pickedUpAt: { type: Date, default: null },
    rentalStartedAt: { type: Date, default: null },
    returnStartedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    ratedAt: { type: Date, default: null },

    cancelledBy: {
        type: String,
        enum: ["PASSENGER", "PARTNER", "ADMIN", null],
        default: null,
    },
    cancelReason: { type: String, default: "", maxlength: 500 },
    cancelledAt: { type: Date, default: null },
    // Booking-fee refund outcome decided at cancellation time by
    // rentalBookingService.resolveFeeRefund. REFUNDED is set by an
    // admin once the manual refund transfer is actually made.
    feeRefund: {
        status: {
            type: String,
            enum: ["NONE", "DUE", "REFUNDED"],
            default: "NONE",
        },
        percent: { type: Number, default: 0 },
        amount: { type: Number, default: 0 },
        refundedAt: { type: Date, default: null },
        refundedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            default: null,
        },
    },

    noShowAt: { type: Date, default: null },
    noShowBy: {
        type: String,
        enum: ["PASSENGER", "PARTNER", null],
        default: null,
    },

    disputedBy: {
        type: String,
        enum: ["PASSENGER", "PARTNER", null],
        default: null,
    },
    disputeReason: { type: String, default: "", maxlength: 500 },
    disputedAt: { type: Date, default: null },
    // Phase 7 — admin dispute resolution record. The outcome set and
    // its fee-refund rules live in
    // services/rentalBookingService.evaluateRentalDisputeResolution;
    // DISPUTED stays terminal for every non-admin action.
    disputeResolution: {
        outcome: {
            type: String,
            enum: ["COMPLETED", "CANCELLED", "NO_SHOW", null],
            default: null,
        },
        fault: {
            type: String,
            enum: ["PASSENGER", "PARTNER", "NONE", null],
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

rentalBookingSchema.index({ passengerId: 1, createdAt: -1 });
rentalBookingSchema.index({ rentalPartnerId: 1, status: 1 });
rentalBookingSchema.index({ vehicleId: 1, status: 1, startAt: 1, endAt: 1 });
rentalBookingSchema.index({ status: 1, createdAt: -1 });
rentalBookingSchema.index({ "feePayment.status": 1, status: 1 });

module.exports = mongoose.model("RentalBooking", rentalBookingSchema);
