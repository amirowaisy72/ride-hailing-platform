const express = require("express");
const { protect } = require("../middleware/authMiddleware");
const authorize = (...roles) => (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
        return res.status(403).json({
            success: false,
            message: "Access denied",
        });
    }
    next();
};
const {
    getCommissionSettings,
    updateCommissionSettings,
} = require("../controllers/adminCommissionController");

const router = express.Router();

router.use(protect, authorize("ADMIN"));

router.get("/", getCommissionSettings);
router.put("/", updateCommissionSettings);

module.exports = router;