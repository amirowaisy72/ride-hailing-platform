const express = require("express");
const { protect } = require("../middleware/authMiddleware");
const { authorize } = require("../middleware/roleMiddleware");

const {
    searchNotificationUsers,
    sendCustomNotification,
} = require("../controllers/adminNotificationController");

const router = express.Router();

router.use(protect, authorize("ADMIN"));

router.get("/users", searchNotificationUsers);
router.post("/send", sendCustomNotification);

module.exports = router;