const express = require("express");
const { protect } = require("../middleware/authMiddleware");
const { authorize } = require("../middleware/roleMiddleware");

const {
    getAllRentalPartners,
    getPendingRentalPartners,
    updateRentalPartnerStatus,
    reviewRentalPartnerDocument,
    getRentalPartnerDocuments,
    viewRentalPartnerDocument,
} = require("../controllers/adminRentalPartnerController");

const router = express.Router();

router.use(protect, authorize("ADMIN"));

// Phase 2 (Rentals foundation) — Rental Partner approval, parallel to
// (not inside) admin driver management.
router.get("/", getAllRentalPartners);
router.get("/pending", getPendingRentalPartners);

router.get("/documents/:documentId/view", viewRentalPartnerDocument);
router.patch(
    "/documents/:documentId/review",
    reviewRentalPartnerDocument
);

router.get("/:id/documents", getRentalPartnerDocuments);
router.patch("/:id/status", updateRentalPartnerStatus);

module.exports = router;
