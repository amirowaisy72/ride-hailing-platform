const mongoose = require("mongoose");

// Phase 5 — Safar Rentals vehicle LISTING. A dedicated domain: it
// deliberately does NOT reuse the ride `Vehicle` model, whose records
// are a driver's approved fleet entry with no pricing, no calendar and
// no marketplace moderation. A listing carries all three, plus the
// anti-bypass contact fields.
//
// Anti-bypass storage note: `exactPickupAddress`, `pickupContactName`
// and `pickupContactPhone` are select:false and are ONLY ever exposed
// through services/rentalBookingService.serializeRentalVehicle with
// unlocked=true — i.e. to the parties of a CONFIRMED-or-later booking.
// The public face of a listing is the approximate pickup AREA only.

const pointSchema = new mongoose.Schema({
    type: { type: String, enum: ["Point"], default: "Point" },
    coordinates: { type: [Number], required: true },
    address: { type: String, trim: true, maxlength: 300 },
}, { _id: false });

const rentalVehicleSchema = new mongoose.Schema({
    rentalPartnerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "RentalPartner",
        required: true,
        index: true,
    },
    // Denormalized owner user id — notifications and ownership checks
    // never need a second lookup.
    partnerUserId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
        index: true,
    },

    brand: { type: String, required: true, trim: true, maxlength: 60 },
    model: { type: String, required: true, trim: true, maxlength: 60 },
    year: { type: Number, required: true, min: 1990, max: 2100 },
    registrationNumber: {
        type: String,
        required: true,
        trim: true,
        maxlength: 20,
    },
    transmission: {
        type: String,
        enum: ["MANUAL", "AUTOMATIC"],
        required: true,
    },
    hasAC: { type: Boolean, default: false },
    seats: { type: Number, required: true, min: 1, max: 60 },

    // Cloudinary URLs, uploaded via the existing upload path and
    // grouped the way renters actually inspect a car.
    photos: {
        exterior: { type: [{ type: String, maxlength: 1000 }], default: [] },
        interior: { type: [{ type: String, maxlength: 1000 }], default: [] },
        condition: { type: [{ type: String, maxlength: 1000 }], default: [] },
    },

    // Which rental modes this listing offers. WITH_DRIVER additionally
    // requires the partner's chauffeur verification when the partner
    // supplies the driver (see rentalBookingService).
    rentalModes: {
        type: [{ type: String, enum: ["SELF_DRIVE", "WITH_DRIVER"] }],
        default: ["WITH_DRIVER"],
    },

    // PKR per unit; null = that unit is not offered.
    pricing: {
        hourly: { type: Number, default: null, min: 1 },
        daily: { type: Number, default: null, min: 1 },
        weekly: { type: Number, default: null, min: 1 },
        monthly: { type: Number, default: null, min: 1 },
    },

    // Conditions — disclosed on the listing BEFORE booking, per Amir's
    // plan §4, so nothing is invented at the doorstep.
    mileageLimitKmPerDay: { type: Number, default: null, min: 1 },
    extraKmFee: { type: Number, default: 0, min: 0 },
    fuelPolicy: { type: String, default: "", trim: true, maxlength: 300 },
    tollsNote: { type: String, default: "", trim: true, maxlength: 300 },
    overtimeFeePerHour: { type: Number, default: 0, min: 0 },
    // Refundable at return; nobody's revenue. Snapshotted onto each
    // booking at creation.
    securityDeposit: { type: Number, default: 0, min: 0 },
    insuranceNote: { type: String, default: "", trim: true, maxlength: 500 },
    cancellationPolicy: {
        type: String,
        enum: ["FLEXIBLE", "MODERATE", "STRICT"],
        default: "MODERATE",
    },

    // Public, approximate pickup area (neighbourhood level).
    pickupArea: { type: pointSchema, required: true },
    pickupAreaLabel: { type: String, default: "", trim: true, maxlength: 120 },

    // Private handover details — masked until a booking is CONFIRMED.
    exactPickupAddress: {
        type: String,
        default: null,
        trim: true,
        maxlength: 500,
        select: false,
    },
    pickupContactName: {
        type: String,
        default: null,
        trim: true,
        maxlength: 120,
        select: false,
    },
    pickupContactPhone: {
        type: String,
        default: null,
        trim: true,
        maxlength: 32,
        select: false,
    },

    // Admin moderation of the listing itself (parallel to partner KYC
    // approval — a listing is only bookable while APPROVED + active).
    listingStatus: {
        type: String,
        enum: ["PENDING", "APPROVED", "REJECTED", "SUSPENDED"],
        default: "PENDING",
        index: true,
    },
    moderationNote: { type: String, default: "", maxlength: 500 },
    moderatedAt: { type: Date, default: null },
    moderatedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        default: null,
    },

    isActive: { type: Boolean, default: true },

    // Partner-blocked calendar days, "YYYY-MM-DD" (UTC) — see
    // rentalBookingService.windowTouchesBlockedDate.
    blockedDates: {
        type: [{ type: String, match: /^\d{4}-\d{2}-\d{2}$/ }],
        default: [],
    },

    // Listing-level rating aggregate from RentalReview records.
    rating: { type: Number, default: 0 },
    ratingCount: { type: Number, default: 0 },
}, { timestamps: true });

rentalVehicleSchema.index({ pickupArea: "2dsphere" });
rentalVehicleSchema.index({ listingStatus: 1, isActive: 1, createdAt: -1 });
rentalVehicleSchema.index({ rentalPartnerId: 1, createdAt: -1 });

module.exports = mongoose.model("RentalVehicle", rentalVehicleSchema);
