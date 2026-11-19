const express = require("express");
const multer = require("multer");
const { protect } = require("../middleware/authMiddleware");
const { authorize } = require("../middleware/roleMiddleware");
const upload = require("../middleware/uploadMiddleware");
const {
    uploadDocument,
    getMyDocuments,
} = require("../controllers/driverDocumentController");

const router = express.Router();

// Driver-facing list of the driver's own documents (pending /
// rejected / approved). The setup screen only knew uploads from this
// device's storage, so this is the server source of truth for what a
// driver has already sent.
router.get(
    "/",
    protect,
    authorize("PASSENGER", "DRIVER"),
    getMyDocuments
);

// Multer rejects an oversize / wrong-type file BEFORE the controller
// runs, and the app has no error-handling middleware, so those
// failures used to come back as an unreadable HTML 500 ("Request
// failed: 500"). Answer them here as clean JSON instead.
const uploadSingle = upload.single("document");

const handleUploadErrors = (req, res, next) => {
    uploadSingle(req, res, (error) => {
        if (!error) return next();

        if (
            error instanceof multer.MulterError &&
            error.code === "LIMIT_FILE_SIZE"
        ) {
            return res.status(413).json({
                success: false,
                message:
                    "Photo is larger than 10 MB. Please take a smaller photo or choose a smaller file.",
            });
        }

        return res.status(400).json({
            success: false,
            message: error.message || "Document upload failed",
        });
    });
};

router.post(
    "/",
    protect,
    authorize("PASSENGER", "DRIVER"),
    handleUploadErrors,
    uploadDocument
);

module.exports = router;
