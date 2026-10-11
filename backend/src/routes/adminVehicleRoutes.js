const express = require("express");
const { protect } = require("../middleware/authMiddleware");
const { authorize } = require("../middleware/roleMiddleware");
const {
    getVehicles,
    reviewVehicle,
} = require("../controllers/adminVehicleController");

const router = express.Router();

router.use(protect, authorize("ADMIN"));

router.get("/", getVehicles);
router.patch("/:vehicleId/review", reviewVehicle);

module.exports = router;