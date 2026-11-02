const express = require("express");
const { protect } = require("../middleware/authMiddleware");
const {
    createFeedback,
    getMyFeedback,
} = require("../controllers/feedbackController");

const router = express.Router();

router.post("/", protect, createFeedback);
router.get("/mine", protect, getMyFeedback);

module.exports = router;
