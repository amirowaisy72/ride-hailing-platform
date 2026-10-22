const authorize = (...allowedRoles) => {
    return async (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({
                success: false,
                message: "Authentication required",
            });
        }

        const isDriverAction =
            allowedRoles.includes("DRIVER") &&
            !allowedRoles.includes("PASSENGER");

        if (isDriverAction && req.user.role !== "ADMIN") {
            const Driver = require("../models/Driver");

            const driver = await Driver.findOne({
                userId: req.user._id,
                verificationStatus: "APPROVED",
            });

            if (
                req.user.activeMode !== "DRIVER" ||
                !driver
            ) {
                return res.status(403).json({
                    success: false,
                    message: "Approved Driver mode required",
                });
            }
        } else if (
            !allowedRoles.includes(req.user.role) &&
            !(
                allowedRoles.includes("PASSENGER") &&
                req.user.role === "DRIVER" &&
                req.user.activeMode === "PASSENGER"
            )
        ) {
            return res.status(403).json({
                success: false,
                message: "Access denied",
            });
        }

        next();
    };
};

module.exports = { authorize };