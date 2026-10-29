const RentalPartner = require("../models/RentalPartner");
const RentalPartnerDocument = require("../models/RentalPartnerDocument");
const {
    uploadToCloudinary,
} = require("../integrations/cloudinary/uploadService");
const {
    requiredKycDocuments,
    missingKycDocuments,
    loadRentalPartnerDocuments,
} = require("../services/rentalPartnerService");

// ---------------------------------------------------------------------------
// Phase 2 (Rentals foundation) — partner-facing Rental Partner endpoints.
// Mounted under /api/v1/rental-partners (see routes/rentalPartnerRoutes
// .js). Foundation only: application + KYC documents. Listings and
// bookings arrive in a later phase.
// ---------------------------------------------------------------------------

function partnerState(partner, documents) {
    return {
        id: partner._id,
        businessName: partner.businessName,
        applicationStatus: partner.applicationStatus,
        rejectionReason: partner.rejectionReason,
        suspensionReason: partner.suspensionReason,
        providesChauffeur: partner.providesChauffeur,
        chauffeurVerificationStatus: partner.chauffeurVerificationStatus,
        requiredDocuments: requiredKycDocuments(partner),
        missingDocuments: missingKycDocuments(partner, documents),
        documents: documents.map((doc) => ({
            id: doc._id,
            documentType: doc.documentType,
            verificationStatus: doc.verificationStatus,
            rejectionReason: doc.rejectionReason,
            expiryDate: doc.expiryDate,
        })),
    };
}

const applyForRentalPartner = async (req, res) => {
    try {
        if (!["PASSENGER", "DRIVER"].includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                message: "Only user accounts can apply as a rental partner",
            });
        }

        let partner = await RentalPartner.findOne({
            userId: req.user._id,
        });

        if (!partner) {
            partner = await RentalPartner.create({
                userId: req.user._id,
            });
        }

        if (partner.applicationStatus === "APPROVED") {
            return res.status(409).json({
                success: false,
                message: "Rental partner already approved",
            });
        }

        if (partner.applicationStatus === "SUSPENDED") {
            return res.status(403).json({
                success: false,
                message: "Rental partner is suspended",
            });
        }

        if (typeof req.body?.businessName === "string") {
            partner.businessName = req.body.businessName.trim() || null;
        }

        if (typeof req.body?.providesChauffeur === "boolean") {
            partner.providesChauffeur = req.body.providesChauffeur;
            partner.chauffeurVerificationStatus = partner.providesChauffeur
                ? "PENDING"
                : "NOT_APPLIED";
        }

        partner.rejectionReason = null;

        const documents = await loadRentalPartnerDocuments(partner._id);
        const missing = missingKycDocuments(partner, documents);

        partner.applicationStatus =
            missing.length === 0 ? "PENDING" : "INCOMPLETE";
        partner.statusUpdatedAt = new Date();

        await partner.save();

        return res.status(200).json({
            success: true,
            message:
                partner.applicationStatus === "PENDING"
                    ? "Application submitted for review"
                    : "Application saved — KYC documents incomplete",
            rentalPartner: partnerState(partner, documents),
        });
    } catch (error) {
        if (error.code === 11000) {
            return res.status(409).json({
                success: false,
                message: "Rental partner profile already exists",
            });
        }

        console.error("Rental partner application error:", error.message);

        return res.status(500).json({
            success: false,
            message: "Rental partner application failed",
        });
    }
};

const getMyRentalPartner = async (req, res) => {
    try {
        const partner = await RentalPartner.findOne({
            userId: req.user._id,
        });

        if (!partner) {
            return res.status(404).json({
                success: false,
                message: "Rental partner profile not found",
            });
        }

        const documents = await loadRentalPartnerDocuments(partner._id);

        return res.json({
            success: true,
            rentalPartner: partnerState(partner, documents),
        });
    } catch (error) {
        console.error("Rental partner load error:", error.message);

        return res.status(500).json({
            success: false,
            message: "Failed to load rental partner profile",
        });
    }
};

// Mirrors driverDocumentController.uploadDocument exactly (same upload
// service, same expiry rule for licences).
const uploadRentalPartnerDocument = async (req, res) => {
    try {
        const partner = await RentalPartner.findOne({
            userId: req.user._id,
        });

        if (!partner) {
            return res.status(404).json({
                success: false,
                message: "Rental partner profile not found",
            });
        }

        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: "Document image required",
            });
        }

        const allowedTypes = RentalPartnerDocument.schema.path(
            "documentType"
        ).enumValues;
        const { documentType, expiryDate } = req.body;

        const requiresExpiry = ["DRIVING_LICENSE"].includes(documentType);

        if (
            requiresExpiry &&
            (typeof expiryDate !== "string" ||
                !/^\d{4}-\d{2}-\d{2}$/.test(expiryDate) ||
                !Number.isFinite(Date.parse(expiryDate)) ||
                new Date(expiryDate) <= new Date())
        ) {
            return res.status(400).json({
                success: false,
                message: "Valid future document expiry date required",
            });
        }

        if (!allowedTypes.includes(documentType)) {
            return res.status(400).json({
                success: false,
                message: "Invalid document type",
            });
        }

        const uploaded = await uploadToCloudinary(
            req.file.buffer,
            partner._id.toString()
        );

        const document = await RentalPartnerDocument.create({
            rentalPartnerId: partner._id,
            documentType,
            imageUrl: uploaded.imageUrl,
            cloudinaryPublicId: uploaded.publicId,
            expiryDate: requiresExpiry ? new Date(expiryDate) : null,
        });

        return res.status(201).json({
            success: true,
            message: "Document uploaded successfully",
            document: {
                id: document._id,
                documentType: document.documentType,
                verificationStatus: document.verificationStatus,
            },
        });
    } catch (error) {
        console.error("Rental document upload error:", error.message);

        return res.status(error.statusCode || 500).json({
            success: false,
            message:
                error.statusCode === 503
                    ? error.message
                    : "Document upload failed",
        });
    }
};

module.exports = {
    applyForRentalPartner,
    getMyRentalPartner,
    uploadRentalPartnerDocument,
};
