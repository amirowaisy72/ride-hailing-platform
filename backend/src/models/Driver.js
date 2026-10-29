const mongoose = require("mongoose");

// Phase 2 — per-service eligibility (RIDE / PARCEL / BUY_DELIVER).
// This sub-schema is ADDITIVE: the legacy global `verificationStatus`
// below is unchanged and remains the fallback for RIDE/PARCEL whenever a
// service record has never been touched (status NOT_APPLIED). An explicit
// per-service status (set by a service application or an admin per-service
// action) always takes precedence over that derivation. BUY_DELIVER has
// no legacy equivalent, so it only ever reads its own record.
const SERVICE_STATUSES = [
    "NOT_APPLIED",
    "INCOMPLETE",
    "PENDING",
    "UNDER_REVIEW",
    "APPROVED",
    "REJECTED",
    "SUSPENDED",
];

const serviceEligibilitySchema = new mongoose.Schema(
    {
        status: {
            type: String,
            enum: SERVICE_STATUSES,
            default: "NOT_APPLIED",
        },
        // Partner-controlled availability preference. Server-side
        // eligibility (eligibilityService) always ALSO requires an
        // APPROVED status + documents, so this toggle alone can never
        // make an ineligible service receivable.
        enabled: {
            type: Boolean,
            default: true,
        },
        // BUY_DELIVER only: how the partner travels to shop/deliver.
        transportMode: {
            type: String,
            enum: ["WALKING", "BICYCLE", "MOTORBIKE", "CAR", null],
            default: null,
        },
        // BUY_DELIVER only: per-order purchase spending cap (PKR) set by
        // Admin at approval time; null = platform default applies.
        purchaseLimit: {
            type: Number,
            default: null,
            min: 0,
        },
        // BUY_DELIVER only: purchase-handling / reimbursement policy
        // acknowledgment timestamp.
        policyAcknowledgedAt: {
            type: Date,
            default: null,
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
    },
    { _id: false }
);

const driverSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
            unique: true,
        },
        verificationStatus: {
            type: String,
            enum: [
                "PENDING",
                "UNDER_REVIEW",
                "APPROVED",
                "REJECTED",
                "SUSPENDED",
            ],
            default: "PENDING",
        },
        rejectionReason: {
            type: String,
            default: null,
            trim: true,
        },
        isOnline: {
            type: Boolean,
            default: false,
        },
        isAvailable: {
            type: Boolean,
            default: false,
        },
        lastLocationUpdate: {
            type: Date,
            default: null,
            index: true,
        },

        currentLocation: {
            type: {
                type: String,
                enum: ["Point"],
                default: "Point",
            },
            coordinates: {
                type: [Number],
                default: [0, 0],
            },
        },
        rating: {
            type: Number,
            default: 0,
        },
        ratingCount: {
            type: Number,
            default: 0,
        },
        currentVehicleId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Vehicle",
            default: null,
        },
        // Phase 2 — per-service eligibility records. See
        // services/eligibilityService.js for the single source of truth
        // that interprets these records.
        services: {
            RIDE: {
                type: serviceEligibilitySchema,
                default: () => ({}),
            },
            PARCEL: {
                type: serviceEligibilitySchema,
                default: () => ({}),
            },
            BUY_DELIVER: {
                type: serviceEligibilitySchema,
                default: () => ({}),
            },
        },
    },
    { timestamps: true }
);

driverSchema.index({ currentLocation: "2dsphere" });

module.exports = mongoose.model("Driver", driverSchema);