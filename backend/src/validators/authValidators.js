const { body } = require("express-validator");

const loginValidator = [
    body("email").isEmail().withMessage("Valid email required"),
    body("password")
        .isString()
        .notEmpty()
        .withMessage("Password required"),
];

const registerValidator = [
    body("firstName")
        .isString()
        .trim()
        .isLength({ min: 2, max: 50 }),

    body("lastName")
        .isString()
        .trim()
        .isLength({ min: 2, max: 50 }),

    body("email")
        .isEmail()
        .normalizeEmail({
            gmail_remove_subaddress: false,
            gmail_remove_dots: false,
        }),

    body("password")
        .isString()
        .isLength({ min: 8, max: 128 }),

    body("role")
        .isIn(["PASSENGER", "DRIVER"]),
];

const sendOTPValidator = [
    body("email")
        .isEmail()
        .withMessage("Valid email required"),
];

const verifyOTPValidator = [
    body("email")
        .isEmail()
        .withMessage("Valid email required"),

    body("otp")
        .isString()
        .matches(/^\d{6}$/)
        .withMessage("Valid 6-digit OTP required"),
];

const refreshTokenValidator = [
    body("refreshToken")
        .isString()
        .matches(/^[a-f0-9]{64}$/)
        .withMessage("Valid refresh token required"),
];

module.exports = {
    refreshTokenValidator,
    loginValidator,
    registerValidator,
    sendOTPValidator,
    verifyOTPValidator,
};