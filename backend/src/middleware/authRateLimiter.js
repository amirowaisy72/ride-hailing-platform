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

// Session endpoints (token refresh / logout) must NOT share the strict
// credential limiter above: refresh runs routinely for every signed-in
// client, so a strict per-IP cap effectively logs users out — and with
// Pakistani carrier NAT, many unrelated users share a single public IP,
// so one user's burst can lock out everyone behind the same NAT. This
// limiter is generous enough for normal session traffic while still
// bounding abuse.
const sessionLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 300,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: {
        success: false,
        message: "Too many requests. Try again later.",
    },
});

module.exports = { authLimiter, sessionLimiter };
