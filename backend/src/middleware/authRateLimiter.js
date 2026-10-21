const rateLimit = require("express-rate-limit");

const authLimiter = rateLimit({
    windowMs: 2 * 60 * 1000,
    limit: 10,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: {
        success: false,
        message: "Too many requests. Try again after 2 minutes.",
    },
});

module.exports = { authLimiter };