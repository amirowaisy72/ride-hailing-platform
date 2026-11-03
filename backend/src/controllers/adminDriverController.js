const Driver = require("../models/Driver");
const DriverDocument = require("../models/DriverDocument");
const PushDevice = require("../models/PushDevice");
const IntegrationSetting = require("../models/IntegrationSetting");
const LastAdminNotification = require("../models/LastAdminNotification");
const { sendPushToUser } = require("../services/pushService");

const getPendingDrivers = async (req, res) => {
    try {
        const drivers = await Driver.find({
            verificationStatus: {
                $in: ["PENDING", "UNDER_REVIEW"],
            },
        }).populate("userId", "firstName lastName email phone");

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
            .populate("userId", "firstName lastName email phone")
            .sort({ createdAt: -1 })
            .lean();

        // ADDITIVE ONLY: one new field per driver, so the dashboard can
        // filter "pending drivers who have submitted documents" without
        // extra per-driver requests. No existing field is changed.
        const docCounts = await DriverDocument.aggregate([
            { $group: { _id: "$driverId", count: { $sum: 1 } } },
        ]);
        const counts = new Map(
            docCounts.map((item) => [String(item._id), item.count])
        );

        return res.json({
            success: true,
            drivers: drivers.map((driver) => ({
                ...driver,
                documentCount: counts.get(String(driver._id)) || 0,
            })),
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

        const wasApproved = driver.verificationStatus === "APPROVED";

        driver.verificationStatus = status;
        driver.rejectionReason =
            status === "REJECTED" ? rejectionReason.trim() : null;

        if (status === "REJECTED") {
            driver.isOnline = false;
            driver.isAvailable = false;
        }

        await driver.save();

        // Auto push on FINAL driver-profile approval only: the admin
        // has already approved the individual documents (separate
        // reviewDriverDocument endpoint), and this is the transition
        // into APPROVED. Best-effort only: any push failure is logged
        // and must never fail or roll back the approval above.
        // Not sent on document approvals, re-approval of an already
        // approved driver, or rejection.
        if (status === "APPROVED" && !wasApproved) {
            try {
                const title = "Safar \u2014 Documents Approved";
                const body =
                    "Mubarak ho! Aap ke documents approve ho gaye hain. Ab aap Safar par rides le sakte hain.";
                const delivery = await sendPushToUser(
                    driver.userId,
                    title,
                    body,
                    { type: "DRIVER_APPROVED", source: "ADMIN" }
                );
                if (delivery?.successCount) {
                    await LastAdminNotification.findOneAndUpdate(
                        { userId: driver.userId },
                        {
                            userId: driver.userId,
                            title,
                            body,
                            source: "SINGLE",
                            sentAt: new Date(),
                        },
                        { upsert: true, new: true }
                    );
                }
            } catch (pushError) {
                console.error(
                    "Driver approval push failed (approval kept):",
                    pushError.message
                );
            }
        }

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

// Missing-documents push notification. The required set mirrors
// driver approval exactly (adminDriverController approval check +
// DriverDocumentReview): an APPROVED, unexpired document of each
// of the four types. PROFILE_PHOTO is not required, so a driver
// with four approved documents can still be missing one here.
// The message text is fixed (approved by admin) — only the
// missing document names are inserted — and the dashboard
// always shows it in a confirm dialog before sending.
const REQUIRED_DOCUMENT_TYPES = [
    "CNIC_FRONT",
    "CNIC_BACK",
    "DRIVING_LICENSE",
    "VEHICLE_REGISTRATION",
];

const DOCUMENT_LABELS = {
    CNIC_FRONT: "CNIC Front",
    CNIC_BACK: "CNIC Back",
    DRIVING_LICENSE: "Driving License",
    VEHICLE_REGISTRATION: "Vehicle Registration",
};

async function findMissingDocumentTypes(driverId) {
    const docs = await DriverDocument.find({ driverId })
        .select("documentType verificationStatus expiryDate")
        .lean();
    const now = new Date();
    const approved = new Set(
        docs
            .filter(
                (doc) =>
                    doc.verificationStatus === "APPROVED" &&
                    (!doc.expiryDate || new Date(doc.expiryDate) > now)
            )
            .map((doc) => doc.documentType)
    );
    return REQUIRED_DOCUMENT_TYPES.filter((type) => !approved.has(type));
}

function missingDocumentsMessage(missing) {
    const labels = missing.map((type) => DOCUMENT_LABELS[type]);
    const title = "Aap ki documents incomplete hain";
    const body =
        missing.length === 1
            ? `Assalam-o-Alaikum! Aap ki ${labels[0]} document missing hai. Barah-e-karam Safar app me ja kar ye document upload karein taake hum aap ki verification mukammal kar sakein. Shukriya!`
            : `Assalam-o-Alaikum! Aap ki ye documents missing hain: ${labels.join(", ")}. Barah-e-karam Safar app me ja kar ye documents upload karein taake hum aap ki verification mukammal kar sakein.`;
    return { title, body };
}

const getMissingDocuments = async (req, res) => {
    try {
        const driver = await Driver.findById(req.params.id).populate(
            "userId",
            "firstName lastName"
        );

        if (!driver) {
            return res.status(404).json({
                success: false,
                message: "Driver not found.",
            });
        }

        const missing = await findMissingDocumentTypes(driver._id);

        if (!missing.length) {
            return res.json({
                success: true,
                missing: [],
                title: null,
                body: null,
                message: "No documents are missing for this driver.",
            });
        }

        const { title, body } = missingDocumentsMessage(missing);
        const userId = driver.userId?._id || driver.userId;
        const hasPushDevice =
            (await PushDevice.countDocuments({ userId })) > 0;

        return res.json({
            success: true,
            driverName: [driver.userId?.firstName, driver.userId?.lastName]
                .filter(Boolean)
                .join(" ") || "Driver",
            missing: missing.map((type) => ({
                type,
                label: DOCUMENT_LABELS[type],
            })),
            title,
            body,
            hasPushDevice,
        });
    } catch (error) {
        console.error("Missing documents preview error:", error.message);
        return res.status(500).json({
            success: false,
            message: "Unable to load missing documents.",
        });
    }
};

const notifyMissingDocuments = async (req, res) => {
    try {
        const driver = await Driver.findById(req.params.id);

        if (!driver) {
            return res.status(404).json({
                success: false,
                message: "Driver not found.",
            });
        }

        // Recomputed here, never trusted from the preview call.
        const missing = await findMissingDocumentTypes(driver._id);

        if (!missing.length) {
            return res.status(409).json({
                success: false,
                message: "No documents are missing for this driver.",
            });
        }

        const setting = await IntegrationSetting.findOne({
            key: "push-notifications",
        }).lean();

        if (setting?.enabled === false) {
            return res.status(503).json({
                success: false,
                message: "Push notifications are disabled by Admin.",
            });
        }

        const deviceCount = await PushDevice.countDocuments({
            userId: driver.userId,
        });

        if (!deviceCount) {
            return res.status(409).json({
                success: false,
                message: "This driver has no registered push-enabled device.",
            });
        }

        const { title, body } = missingDocumentsMessage(missing);

        const delivery = await sendPushToUser(driver.userId, title, body, {
            type: "ADMIN_CUSTOM",
            source: "ADMIN",
        });

        if (delivery?.error || !delivery?.successCount) {
            return res.status(502).json({
                success: false,
                message: "Push delivery failed. Check Firebase configuration and backend logs.",
                delivery: {
                    successCount: delivery?.successCount || 0,
                    failureCount: delivery?.failureCount || 0,
                },
            });
        }

        // Same record as the driver-approval auto push: keeps the
        // bulk "only users NOT notified in last ___ hours" filter
        // accurate for this send too.
        await LastAdminNotification.findOneAndUpdate(
            { userId: driver.userId },
            {
                userId: driver.userId,
                title,
                body,
                source: "SINGLE",
                sentAt: new Date(),
            },
            { upsert: true, new: true }
        );

        return res.json({
            success: true,
            message: "Notification sent to registered device(s).",
            delivery: {
                successCount: delivery.successCount,
                failureCount: delivery.failureCount,
            },
        });
    } catch (error) {
        console.error("Missing documents notify error:", error.message);
        return res.status(500).json({
            success: false,
            message: "Unable to send notification.",
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
    getMissingDocuments,
    notifyMissingDocuments,
};

