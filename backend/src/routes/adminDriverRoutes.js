const express = require("express");
const { protect } = require("../middleware/authMiddleware");
const { authorize } = require("../middleware/roleMiddleware");

const {
    getAllDrivers,
    getPendingDrivers,
    updateDriverStatus,
    reviewDriverDocument,
    getDriverDocuments,
    viewDriverDocument,
} = require("../controllers/adminDriverController");

const {
    updateDriverServiceStatus,
    getDriverServicesAdmin,
} = require("../controllers/adminDriverServiceController");

const router = express.Router();

router.use(protect, authorize("ADMIN"));

router.get("/", getAllDrivers);
router.get("/pending", getPendingDrivers);

router.get("/documents/:documentId/view", viewDriverDocument);
router.patch("/documents/:documentId/review", reviewDriverDocument);

router.get("/:id/documents", getDriverDocuments);
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