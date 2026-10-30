const RentalPartner = require("../models/RentalPartner");
const RentalPartnerDocument = require("../models/RentalPartnerDocument");
const cloudinary = require("../integrations/cloudinary/cloudinary");
const {
    missingKycDocuments,
    loadRentalPartnerDocuments,
    applyChauffeurVerification,
} = require("../services/rentalPartnerService");

// ---------------------------------------------------------------------------
// Phase 2 (Rentals foundation) — Admin Rental Partner management.
// Mounted under /api/v1/admin/rental-partners (see
// routes/adminRentalPartnerRoutes.js). Mirrors adminDriverController's
// review patterns, but is fully independent of driver approval: nothing
// here reads or writes Driver state.
// ---------------------------------------------------------------------------

const getAllRentalPartners = async (req, res) => {
    try {
        const partners = await RentalPartner.find({})
            .populate("userId", "firstName lastName email")
            .sort({ createdAt: -1 })
            .lean();

        return res.json({
            success: true,
            rentalPartners: partners,
        });
    } catch (error) {
        console.error("Rental partner listing error:", error.message);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch rental partners",
        });
    }
};

const getPendingRentalPartners = async (req, res) => {
    try {
        const partners = await RentalPartner.find({
            applicationStatus: {
                $in: ["PENDING", "UNDER_REVIEW"],
            },
        }).populate("userId", "firstName lastName email");

        return res.json({
            success: true,
            rentalPartners: partners,
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: "Failed to fetch rental partners",
        });
    }
};

const updateRentalPartnerStatus = async (req, res) => {
    try {
        const { status, rejectionReason, suspensionReason } = req.body;

        if (!["APPROVED", "REJECTED", "SUSPENDED", "UNDER_REVIEW"].includes(status)) {
            return res.status(400).json({
                success: false,
                message: "Invalid rental partner status",
            });
        }

        if (
            status === "REJECTED" &&
            (typeof rejectionReason !== "string" || !rejectionReason.trim())
        ) {
            return res.status(400).json({
                success: false,
                message: "Rejection reason required",
            });
        }

        const partner = await RentalPartner.findById(req.params.id);

        if (!partner) {
            return res.status(404).json({
                success: false,
                message: "Rental partner not found",
            });
        }

        if (status === "APPROVED") {
            const documents = await loadRentalPartnerDocuments(partner._id);
            const missing = missingKycDocuments(partner, documents);

            if (missing.length > 0) {
                return res.status(400).json({
                    success: false,
                    message: "Required approved documents missing",
                    missingDocuments: missing,
                });
            }
        }

        partner.applicationStatus = status;
        partner.statusUpdatedAt = new Date();
        partner.rejectionReason =
            status === "REJECTED" ? rejectionReason.trim() : null;

        if (status === "SUSPENDED") {
            partner.suspendedAt = new Date();
            partner.suspensionReason =
                typeof suspensionReason === "string" &&
                suspensionReason.trim()
                    ? suspensionReason.trim()
                    : null;
        } else {
            partner.suspendedAt = null;
            partner.suspensionReason = null;
        }

        await partner.save();

        return res.json({
            success: true,
            message: `Rental partner ${status.toLowerCase()} successfully`,
            rentalPartner: {
                id: partner._id,
                applicationStatus: partner.applicationStatus,
            },
        });
    } catch (error) {
        console.error("Rental partner status error:", error.message);

        return res.status(500).json({
            success: false,
            message: "Failed to update rental partner status",
        });
    }
};

// Mirrors adminDriverController.reviewDriverDocument.
const reviewRentalPartnerDocument = async (req, res) => {
    try {
        const { status, rejectionReason } = req.body;

        if (!["APPROVED", "REJECTED"].includes(status)) {
            return res.status(400).json({
                success: false,
                message: "Invalid document status",
            });
        }

        if (
            status === "REJECTED" &&
            (typeof rejectionReason !== "string" || !rejectionReason.trim())
        ) {
            return res.status(400).json({
                success: false,
                message: "Rejection reason required",
            });
        }

        const document = await RentalPartnerDocument.findById(
            req.params.documentId
        );

        if (!document) {
            return res.status(404).json({
                success: false,
                message: "Document not found",
            });
        }

        if (
            status === "APPROVED" &&
            document.expiryDate &&
            document.expiryDate <= new Date()
        ) {
            return res.status(400).json({
                success: false,
                message: "Expired document cannot be approved",
            });
        }

        document.verificationStatus = status;
        document.rejectionReason =
            status === "REJECTED" ? rejectionReason.trim() : null;

        await document.save();

        return res.json({
            success: true,
            message: "Document reviewed successfully",
            document: {
                id: document._id,
                verificationStatus: document.verificationStatus,
            },
        });
    } catch (error) {
        console.error("Rental document review error:", error.message);

        return res.status(500).json({
            success: false,
            message: "Document review failed",
        });
    }
};

const getRentalPartnerDocuments = async (req, res) => {
    try {
        const partner = await RentalPartner.findById(req.params.id);

        if (!partner) {
            return res.status(404).json({
                success: false,
                message: "Rental partner not found",
            });
        }

        const documents = await RentalPartnerDocument.find({
            rentalPartnerId: partner._id,
        }).select(
            "_id documentType verificationStatus rejectionReason expiryDate createdAt"
        );

        return res.json({
            success: true,
            documents,
        });
    } catch (error) {
        console.error("Rental document listing error:", error.message);

        return res.status(500).json({
            success: false,
            message: "Failed to fetch documents",
        });
    }
};

// Mirrors adminDriverController.viewDriverDocument.
const viewRentalPartnerDocument = async (req, res) => {
    try {
        const document = await RentalPartnerDocument.findById(
            req.params.documentId
        );

        if (!document) {
            return res.status(404).json({
                success: false,
                message: "Document not found",
            });
        }

        const imageUrl = cloudinary.url(document.cloudinaryPublicId, {
            secure: true,
            sign_url: true,
            type: "authenticated",
            resource_type: "image",
            expires_at: Math.floor(Date.now() / 1000) + 300,
        });

        return res.json({
            success: true,
            imageUrl,
            expiresIn: 300,
        });
    } catch (error) {
        console.error("Rental document viewing error:", error.message);

        return res.status(500).json({
            success: false,
            message: "Unable to access document",
        });
    }
};

// Chauffeur verification review (Amir review A16) — the admin half of
// the flow that can move chauffeurVerificationStatus to APPROVED, which
// the With-Driver booking gate requires. All validation and transition
// rules live in rentalPartnerService.applyChauffeurVerification; this
// handler only loads, delegates, saves and shapes the response. On a
// validation error nothing is saved.
const updateRentalPartnerChauffeur = async (req, res) => {
    try {
        const partner = await RentalPartner.findById(req.params.id);

        if (!partner) {
            return res.status(404).json({
                success: false,
                message: "Rental partner not found",
            });
        }

        const result = applyChauffeurVerification(
            partner,
            req.body || {},
            req.user._id
        );

        if (!result.ok) {
            return res.status(result.error.status).json({
                success: false,
                message: result.error.message,
            });
        }

        await partner.save();

        return res.json({
            success: true,
            message: "Chauffeur verification updated",
            rentalPartner: {
                id: partner._id,
                providesChauffeur: partner.providesChauffeur,
                chauffeurVerificationStatus: partner.chauffeurVerificationStatus,
                chauffeurName: partner.chauffeurName,
                chauffeurLicenceNumber: partner.chauffeurLicenceNumber,
                chauffeurLicenceExpiry: partner.chauffeurLicenceExpiry,
                chauffeurRejectionReason: partner.chauffeurRejectionReason,
                chauffeurVerifiedBy: partner.chauffeurVerifiedBy,
                chauffeurVerifiedAt: partner.chauffeurVerifiedAt,
            },
        });
    } catch (error) {
        console.error("Chauffeur verification error:", error.message);

        return res.status(500).json({
            success: false,
            message: "Failed to update chauffeur verification",
        });
    }
};

module.exports = {
    getAllRentalPartners,
    getPendingRentalPartners,
    updateRentalPartnerStatus,
    updateRentalPartnerChauffeur,
    reviewRentalPartnerDocument,
    getRentalPartnerDocuments,
    viewRentalPartnerDocument,
};
