const express = require("express");
const { register, login } = require("../controllers/authController");

const { sendOTP, verifyOTP } = require("../controllers/otpController");
const { sendResetOTP, resetPassword } = require("../controllers/passwordResetController");

const { protect } = require("../middleware/authMiddleware");

const { authLimiter } = require("../middleware/authRateLimiter");

const { authorize } = require("../middleware/roleMiddleware");

const {
    loginValidator,
    refreshTokenValidator,
    registerValidator,
    sendOTPValidator,
    verifyOTPValidator,
} = require("../validators/authValidators");
const { validateRequest } = require("../middleware/validateRequest");

const router = express.Router();

router.post(
    "/register",
    authLimiter,
    registerValidator,
    validateRequest,
    register
);
router.post("/login", authLimiter, loginValidator, validateRequest, login);

router.post("/forgot-password", authLimiter, sendResetOTP);
router.post("/reset-password", authLimiter, resetPassword);
router.post("/send-otp", authLimiter, sendOTPValidator, validateRequest, sendOTP);
router.post("/verify-otp", authLimiter, verifyOTPValidator, validateRequest, verifyOTP);

router.get("/me", protect, (req, res) => {
    res.json({
        success: true,
        user: {
            id: req.user._id,
            firstName: req.user.firstName,
            lastName: req.user.lastName,
            email: req.user.email,
            role: req.user.role,
            activeMode: req.user.activeMode || "PASSENGER",
        },
    });
});

const { refresh, logout } = require("../controllers/tokenController");

router.post("/refresh", authLimiter, refreshTokenValidator, validateRequest, refresh);
router.post("/logout", authLimiter, refreshTokenValidator, validateRequest, logout);


module.exports = router;