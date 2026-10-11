
const express = require("express");
const { protect } = require("../middleware/authMiddleware");
const { authorize } = require("../middleware/roleMiddleware");

const {
    getOverview,
    getPassengers,
    getRides,
} = require("../controllers/adminOperationsController");

const router = express.Router();

router.use(protect, authorize("ADMIN"));

router.get("/overview", getOverview);
router.get("/passengers", getPassengers);
router.get("/rides", getRides);

module.exports = router;
