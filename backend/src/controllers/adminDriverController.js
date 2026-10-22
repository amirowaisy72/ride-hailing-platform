const Driver = require("../models/Driver");
const DriverDocument = require("../models/DriverDocument");

const getPendingDrivers = async (req, res) => {
    try {
        const drivers = await Driver.find({
            verificationStatus: {
                $in: ["PENDING", "UNDER_REVIEW"],
            },
        }).populate("userId", "firstName lastName email");

        return res.json({
            success: true,
            drivers,
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: "Failed to fetch drivers",
        });
    }
};

const getAllDrivers = async (req, res) => {
    try {
        const drivers = await Driver.find({})
            .populate("userId", "firstName lastName email")
            .sort({ createdAt: -1 })
            .lean();

        return res.json({
            success: true,
            drivers,
        });
    } catch (error) {
        console.error("Driver listing error:", error.message);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch drivers",
        });
    }
};

const updateDriverStatus = async (req, res) => {
    try {
        const { status, rejectionReason } = req.body;

        if (
            status === "REJECTED" &&
            (typeof rejectionReason !== "string" ||
                !rejectionReason.trim())
        ) {
            return res.status(400).json({
                success: false,
                message: "Rejection reason required",
            });
        }

        if (!["APPROVED", "REJECTED"].includes(status)) {
            return res.status(400).json({
                success: false,
                message: "Invalid driver status",
            });
        }

        const driver = await Driver.findById(req.params.id);

        if (!driver) {
            return res.status(404).json({
                success: false,
                message: "Driver not found",
            });
        }

        if (status === "APPROVED") {
            const requiredDocuments = [
                "CNIC_FRONT",
                "CNIC_BACK",
                "DRIVING_LICENSE",
                "VEHICLE_REGISTRATION",
            ];

            const documents = await DriverDocument.find({
                driverId: driver._id,
                verificationStatus: "APPROVED",
            });

            const uploadedTypes = new Set(
                documents
                    .filter((doc) =>
                        !doc.expiryDate ||
                        doc.expiryDate > new Date()
                    )
                    .map((doc) => doc.documentType)
            );

            const missing = requiredDocuments.filter(
                (type) => !uploadedTypes.has(type)
            );

            if (missing.length > 0) {
                return res.status(400).json({
                    success: false,
                    message: "Required approved documents missing",
                    missingDocuments: missing,
                });
            }
        }

        driver.verificationStatus = status;
        driver.rejectionReason =
            status === "REJECTED" ? rejectionReason.trim() : null;

        if (status === "REJECTED") {
            driver.isOnline = false;
            driver.isAvailable = false;
        }

        await driver.save();

        return res.json({
            success: true,
            message: `Driver ${status.toLowerCase()} successfully`,
            driver: {
                id: driver._id,
                verificationStatus: driver.verificationStatus,
            },
        });
    } catch (error) {
        console.error("Driver approval error:", error.message);

        return res.status(500).json({
            success: false,
            message: "Failed to update driver status",
        });
    }
};

const reviewDriverDocument = async (req, res) => {
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
            (typeof rejectionReason !== "string" ||
                !rejectionReason.trim())
        ) {
            return res.status(400).json({
                success: false,
                message: "Rejection reason required",
            });
        }

        const document = await DriverDocument.findById(req.params.documentId);

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
        console.error("Document review error:", error.message);

        return res.status(500).json({
            success: false,
            message: "Document review failed",
        });
    }
};

const getDriverDocuments = async (req, res) => {
    try {
        const driver = await Driver.findById(req.params.id);

        if (!driver) {
            return res.status(404).json({
                success: false,
                message: "Driver not found",
            });
        }

        const documents = await DriverDocument.find({
            driverId: driver._id,
        }).select(
            "_id documentType verificationStatus rejectionReason expiryDate createdAt"
        );

        return res.json({
            success: true,
            documents,
        });
    } catch (error) {
        console.error("Document listing error:", error.message);

        return res.status(500).json({
            success: false,
            message: "Failed to fetch documents",
        });
    }
};

const cloudinary = require("../integrations/cloudinary/cloudinary");

const viewDriverDocument = async (req, res) => {
    try {
        const document = await DriverDocument.findById(
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
        console.error("Document viewing error:", error.message);

        return res.status(500).json({
            success: false,
            message: "Unable to access document",
        });
    }
};

module.exports = {
    getAllDrivers,
    getPendingDrivers,
    updateDriverStatus,
    reviewDriverDocument,
    getDriverDocuments,
    viewDriverDocument,
};