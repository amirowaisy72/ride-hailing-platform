const express = require("express");
const { protect } = require("../middleware/authMiddleware");
const { authorize } = require("../middleware/roleMiddleware");

const {
    getAllDrivers,
    getDriverProfile,
    getPendingDrivers,
    updateDriverStatus,
    reviewDriverDocument,
    getDriverDocuments,
    viewDriverDocument,
    getMissingDocuments,
    notifyMissingDocuments,
    getBulkMissingDocumentsPreview,
    notifyAllMissingDocuments,
} = require("../controllers/adminDriverController");

const {
    updateDriverServiceStatus,
    getDriverServicesAdmin,
} = require("../controllers/adminDriverServiceController");

const router = express.Router();

router.use(protect, authorize("ADMIN"));

router.get("/", getAllDrivers);
router.get("/pending", getPendingDrivers);

// Bulk missing-documents push (preview + send). Registered before
// the /:id routes so the fixed segments can never be read as an id.
router.get(
    "/notify-all-missing-documents-preview",
    getBulkMissingDocumentsPreview
);
router.post(
    "/notify-all-missing-documents",
    notifyAllMissingDocuments
);

router.get("/documents/:documentId/view", viewDriverDocument);
router.patch("/documents/:documentId/review", reviewDriverDocument);

router.get("/:id/profile", getDriverProfile);
router.get("/:id/documents", getDriverDocuments);
router.get("/:id/missing-documents", getMissingDocuments);
router.post("/:id/notify-missing-documents", notifyMissingDocuments);
router.patch("/:id/status", updateDriverStatus);

// Phase 2 — per-service approval / rejection / suspension
router.patch(
    "/:id/services/:service/status",
    updateDriverServiceStatus
);

// Phase 7 — per-service detail for Driver Management (status, transport
// mode, documents, blocked reasons, approval record)
router.get("/:id/services", getDriverServicesAdmin);

module.exports = router;
