const mongoose = require("mongoose");

// Phase 2 (Rentals foundation) — Rental Partner is an INDEPENDENT role on
// the common User account, parallel to the Driver profile: one user may
// be a passenger, a driver partner and a rental partner at once, each
// with its own verification. A rental partner is NOT a driver and never
// passes through driver approval; vehicle listings and bookings arrive
// in a later phase and will hang off this record.
const rentalPartnerSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
            unique: true,
        },
        businessName: {
            type: String,
            default: null,
            trim: true,
        },
        applicationStatus: {
            type: String,
            enum: [
                "NOT_APPLIED",
                "INCOMPLETE",
                "PENDING",
                "UNDER_REVIEW",
                "APPROVED",
                "REJECTED",
                "SUSPENDED",
            ],
            default: "NOT_APPLIED",
        },
        rejectionReason: {
            type: String,
            default: null,
            trim: true,
        },
        suspendedAt: {
            type: Date,
            default: null,
        },
        suspensionReason: {
            type: String,
            default: null,
            trim: true,
        },
        statusUpdatedAt: {
            type: Date,
            default: null,
        },
        // A partner who also supplies a chauffeur for With-Driver rentals
        // is verified for that separately from the business KYC.
        providesChauffeur: {
            type: Boolean,
            default: false,
        },
        chauffeurVerificationStatus: {
            type: String,
            enum: [
                "NOT_APPLIED",
                "INCOMPLETE",
                "PENDING",
                "UNDER_REVIEW",
                "APPROVED",
                "REJECTED",
                "SUSPENDED",
            ],
            default: "NOT_APPLIED",
        },
        // Chauffeur identity the partner declares (name + licence) and
        // the admin reviews in the chauffeur verification flow. The
        // licence document itself stays a RentalPartnerDocument
        // (DRIVING_LICENSE); these fields are the reviewable identity
        // summary the With-Driver booking gate relies on.
        chauffeurName: {
            type: String,
            default: null,
            trim: true,
        },
        chauffeurLicenceNumber: {
            type: String,
            default: null,
            trim: true,
        },
        chauffeurLicenceExpiry: {
            type: Date,
            default: null,
        },
        chauffeurRejectionReason: {
            type: String,
            default: null,
            trim: true,
        },
        // Who approved the chauffeur and when (cleared whenever the
        // verification is revoked or the declared details change).
        chauffeurVerifiedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            default: null,
        },
        chauffeurVerifiedAt: {
            type: Date,
            default: null,
        },
        // Phase 5 — anti-bypass provider agreement: the partner must
        // accept the agreement (no off-platform conversion of Safar
        // bookings, no false cancellations to dodge the booking fee)
        // before an admin can approve their FIRST listing. Acceptance
        // is timestamped and versioned so a future agreement revision
        // can require re-acceptance.
        agreementAcceptedAt: {
            type: Date,
            default: null,
        },
        agreementVersion: {
            type: String,
            default: null,
            trim: true,
            maxlength: 20,
        },
        // Rating aggregate from RentalReview records.
        rating: { type: Number, default: 0 },
        ratingCount: { type: Number, default: 0 },
    },
    { timestamps: true }
);

module.exports = mongoose.model("RentalPartner", rentalPartnerSchema);
