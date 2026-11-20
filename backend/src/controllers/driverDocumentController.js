const Driver = require("../models/Driver");
const DriverDocument = require("../models/DriverDocument");
const { uploadToCloudinary } = require("../integrations/cloudinary/uploadService");

const uploadDocument = async (req, res) => {
    try {
        const driver = await Driver.findOne({ userId: req.user._id });

        if (!driver) {
            return res.status(404).json({
                success: false,
                message: "Driver profile not found",
            });
        }

        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: "Document image required",
            });
        }

        const allowedTypes = DriverDocument.schema.path("documentType").enumValues;
        const { documentType, expiryDate } = req.body;

        // Expiry exists ONLY for the Driving License. Vehicle
        // Registration has no expiry date, so the backend must not
        // require one for it either (the app no longer sends one).
        const requiresExpiry = ["DRIVING_LICENSE"].includes(documentType);

        if (requiresExpiry && (
            typeof expiryDate !== "string" ||
            !/^\d{4}-\d{2}-\d{2}$/.test(expiryDate) ||
            !Number.isFinite(Date.parse(expiryDate)) ||
            new Date(expiryDate) <= new Date()
        )) {
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

        // One live row per (driver, document type). Re-uploading the
        // same document must NOT add another row: the app only knew an
        // upload from this device, so a lost response (or a second
        // device) made drivers upload the same document again and
        // again, and every retry piled another row into the admin
        // review queue — sometimes approved two or three times over.
        // Checked BEFORE the Cloudinary upload so a blocked re-upload
        // does not leave an orphan image behind.
        const latest = await DriverDocument.findOne({
            driverId: driver._id,
            documentType,
        }).sort({ createdAt: -1 });

        if (
            latest &&
            latest.verificationStatus === "APPROVED" &&
            (!latest.expiryDate || latest.expiryDate > new Date())
        ) {
            // Already accepted and still valid: there is nothing to
            // upload again. (If the approved image itself is wrong,
            // the admin rejects it first, then the driver uploads.)
            return res.status(400).json({
                success: false,
                message: "This document is already approved.",
            });
        }

        const uploaded = await uploadToCloudinary(
            req.file.buffer,
            driver._id.toString()
        );

        let document;
        if (latest) {
            // Still waiting, rejected, or approved-but-expired: refresh
            // the same row instead of adding a new one.
            latest.imageUrl = uploaded.imageUrl;
            latest.cloudinaryPublicId = uploaded.publicId;
            latest.expiryDate = requiresExpiry ? new Date(expiryDate) : null;
            latest.verificationStatus = "PENDING";
            latest.rejectionReason = null;
            document = await latest.save();
        } else {
            document = await DriverDocument.create({
                driverId: driver._id,
                documentType,
                imageUrl: uploaded.imageUrl,
                cloudinaryPublicId: uploaded.publicId,
                expiryDate: requiresExpiry ? new Date(expiryDate) : null,
            });
        }

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
        console.error("Document upload error:", error.message);

        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.statusCode === 503
                ? error.message
                : "Document upload failed",
        });
    }
};

// Driver-facing list of the driver's own uploaded documents — the
// server source of truth the setup screen was missing. Until now the
// app only knew a pending upload from this device's storage, so on a
// new device (or after a lost upload response) an already-uploaded
// document looked like it was never sent.
const getMyDocuments = async (req, res) => {
    try {
        const driver = await Driver.findOne({ userId: req.user._id });

        if (!driver) {
            return res.status(404).json({
                success: false,
                message: "Driver profile not found",
            });
        }

        const documents = await DriverDocument.find({
            driverId: driver._id,
        })
            .select(
                "_id documentType verificationStatus rejectionReason expiryDate imageUrl createdAt updatedAt"
            )
            .sort({ createdAt: -1 });

        return res.json({
            success: true,
            documents,
        });
    } catch (error) {
        console.error("Driver documents error:", error.message);

        return res.status(500).json({
            success: false,
            message: "Failed to load documents",
        });
    }
};

module.exports = { uploadDocument, getMyDocuments };