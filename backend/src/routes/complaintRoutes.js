const express = require("express");
const { protect } = require("../middleware/authMiddleware");
const {
    createComplaint,
    getMyComplaints,
    replyToComplaint,
} = require("../controllers/complaintController");

const router = express.Router();

router.post("/", protect, createComplaint);
router.get("/mine", protect, getMyComplaints);
router.post("/:id/messages", protect, replyToComplaint);

module.exports = router;
