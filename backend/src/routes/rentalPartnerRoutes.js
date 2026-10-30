const express = require("express");
const { protect } = require("../middleware/authMiddleware");
const { authorize } = require("../middleware/roleMiddleware");
const upload = require("../middleware/uploadMiddleware");
const {
    applyForRentalPartner,
    getMyRentalPartner,
    updateMyChauffeurDetails,
    uploadRentalPartnerDocument,
} = require("../controllers/rentalPartnerController");

const router = express.Router();

// Phase 2 (Rentals foundation) — Rental Partner application + KYC.
// Independent of the driver routes: a rental partner never registers
// as a driver.
router.post(
    "/apply",
    protect,
    authorize("PASSENGER", "DRIVER"),
    applyForRentalPartner
);

router.get(
    "/me",
    protect,
    authorize("PASSENGER", "DRIVER"),
    getMyRentalPartner
);

router.patch(
    "/me/chauffeur",
    protect,
    authorize("PASSENGER", "DRIVER"),
    updateMyChauffeurDetails
);

router.post(
    "/me/documents",
    protect,
    authorize("PASSENGER", "DRIVER"),
    upload.single("document"),
    uploadRentalPartnerDocument
);

module.exports = router;
