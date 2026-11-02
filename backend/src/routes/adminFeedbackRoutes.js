const express = require("express");
const { protect } = require("../middleware/authMiddleware");
const {
    listFeedback,
    updateFeedback,
} = require("../controllers/adminFeedbackController");

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

router.get("/", listFeedback);
router.patch("/:id", updateFeedback);

module.exports = router;
