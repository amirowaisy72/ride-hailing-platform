
const express = require("express");
const { protect } = require("../middleware/authMiddleware");
const { authorize } = require("../middleware/roleMiddleware");

const {
    getOverview,
    getPassengers,
    getPassengerProfile,
    getRides,
    getImportant,
    getTodayRides,
} = require("../controllers/adminOperationsController");
const {
    getDailyAverages,
} = require("../controllers/adminDailyAveragesController");

const router = express.Router();

router.use(protect, authorize("ADMIN"));

router.get("/overview", getOverview);
router.get("/important", getImportant);
router.get("/today-rides", getTodayRides);
router.get("/daily-averages", getDailyAverages);
router.get("/passengers", getPassengers);
router.get("/passengers/:id/profile", getPassengerProfile);
router.get("/rides", getRides);

module.exports = router;

