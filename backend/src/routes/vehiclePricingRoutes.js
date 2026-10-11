const express = require("express");
const { protect } = require("../middleware/authMiddleware");
const { authorize } = require("../middleware/roleMiddleware");
const {
    getPricing,
    updatePricing,
    getSuggestedFare,
} = require("../controllers/vehiclePricingController");

const router = express.Router();

router.use(protect);

router.get("/", getPricing);
router.post("/suggest", getSuggestedFare);

router.put("/:vehicleType", authorize("ADMIN"), updatePricing);

module.exports = router;