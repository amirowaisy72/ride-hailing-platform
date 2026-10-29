const mongoose = require("mongoose");

// Phase 2 (Rentals foundation) — KYC documents for Rental Partners.
// This deliberately mirrors models/DriverDocument.js field-for-field
// (same statuses, expiry and Cloudinary pair) so the existing document
// review system — upload via uploadService, admin approve/reject,
// signed-URL viewing — applies unchanged. It is a separate collection
// because DriverDocument.driverId is a required Driver reference and a
// rental partner is not a driver.
const rentalPartnerDocumentSchema = new mongoose.Schema(
    {
        rentalPartnerId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "RentalPartner",
            required: true,
            index: true,
        },
        documentType: {
            type: String,
            enum: [
                "CNIC_FRONT",
                "CNIC_BACK",
                "PROFILE_PHOTO",
                "DRIVING_LICENSE",
                "BUSINESS_REGISTRATION",
                "AUTHORIZATION_LETTER",
                "VEHICLE_OWNERSHIP",
            ],
            required: true,
        },
        imageUrl: {
            type: String,
            required: true,
        },
        cloudinaryPublicId: {
            type: String,
            required: true,
        },
        verificationStatus: {
            type: String,
            enum: ["PENDING", "APPROVED", "REJECTED"],
            default: "PENDING",
        },
        rejectionReason: {
            type: String,
            default: null,
        },
        expiryDate: {
            type: Date,
            default: null,
        },
    },
    { timestamps: true }
);

module.exports = mongoose.model(
    "RentalPartnerDocument",
    rentalPartnerDocumentSchema
);
