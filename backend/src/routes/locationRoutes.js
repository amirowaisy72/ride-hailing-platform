const express = require("express");
const { protect } = require("../middleware/authMiddleware");
const {
    calculateRoute,
    searchLocations,
    getAddressFromCoordinates,
} = require("../controllers/locationController");

const { checkLocation } = require("../controllers/serviceAreaCheckController");

const router = express.Router();

router.post("/route", protect, calculateRoute);
router.get("/search", protect, searchLocations);
router.get("/reverse", protect, getAddressFromCoordinates);

router.get("/check-area", protect, checkLocation);

module.exports = router;