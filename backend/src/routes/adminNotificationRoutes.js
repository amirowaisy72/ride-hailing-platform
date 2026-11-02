const express = require("express");
const { protect } = require("../middleware/authMiddleware");
const { authorize } = require("../middleware/roleMiddleware");

const {
    searchNotificationUsers,
    sendCustomNotification,
} = require("../controllers/adminNotificationController");

// ADDITIVE ONLY: bulk routes live alongside the existing single-user
// routes. The two routes above are unchanged.
const {
    previewBulkNotification,
    sendBulkNotification,
    listBulkNotificationHistory,
} = require("../controllers/adminBulkNotificationController");

const router = express.Router();

router.use(protect, authorize("ADMIN"));

router.get("/users", searchNotificationUsers);
router.post("/send", sendCustomNotification);
router.post("/bulk/preview", previewBulkNotification);
router.post("/bulk/send", sendBulkNotification);
router.get("/bulk/history", listBulkNotificationHistory);

module.exports = router;
