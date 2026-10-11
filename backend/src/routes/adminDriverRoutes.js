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

const router = express.Router();

router.use(protect, authorize("ADMIN"));

router.get("/", getAllDrivers);
router.get("/pending", getPendingDrivers);

router.get("/documents/:documentId/view", viewDriverDocument);
router.patch("/documents/:documentId/review", reviewDriverDocument);

router.get("/:id/documents", getDriverDocuments);
router.patch("/:id/status", updateDriverStatus);

module.exports = router;