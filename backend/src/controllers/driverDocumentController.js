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

        const requiresExpiry = [
            "DRIVING_LICENSE",
            "VEHICLE_REGISTRATION",
        ].includes(documentType);

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

        const uploaded = await uploadToCloudinary(
            req.file.buffer,
            driver._id.toString()
        );

        const document = await DriverDocument.create({
            driverId: driver._id,
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
        console.error("Document upload error:", error.message);

        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.statusCode === 503
                ? error.message
                : "Document upload failed",
        });
    }
};

module.exports = { uploadDocument };