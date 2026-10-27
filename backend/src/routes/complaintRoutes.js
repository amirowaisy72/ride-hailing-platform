const express = require("express");
const { protect } = require("../middleware/authMiddleware");
const {
    createComplaint,
    getMyComplaints,
} = require("../controllers/complaintController");

const router = express.Router();

router.post("/", protect, createComplaint);
router.get("/mine", protect, getMyComplaints);

module.exports = router;
