
const express = require("express");
const { protect } = require("../middleware/authMiddleware");
const { authorize } = require("../middleware/roleMiddleware");

const {
    getOverview,
    getPassengers,
    getRides,
    getImportant,
    getTodayRides,
} = require("../controllers/adminOperationsController");

const router = express.Router();

router.use(protect, authorize("ADMIN"));

router.get("/overview", getOverview);
router.get("/important", getImportant);
router.get("/today-rides", getTodayRides);
router.get("/passengers", getPassengers);
router.get("/rides", getRides);

module.exports = router;

