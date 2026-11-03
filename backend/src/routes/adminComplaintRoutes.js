const express = require("express");
const { protect } = require("../middleware/authMiddleware");
const {
    listComplaints,
    updateComplaint,
    replyToComplaint,
} = require("../controllers/adminComplaintController");

const router = express.Router();

router.use(protect);

router.use((req, res, next) => {
    if (req.user?.role !== "ADMIN") {
        return res.status(403).json({
            success: false,
            message: "Admin access required",
        });
    }

    next();
});

router.get("/", listComplaints);
router.patch("/:id", updateComplaint);
router.post("/:id/messages", replyToComplaint);

module.exports = router;
