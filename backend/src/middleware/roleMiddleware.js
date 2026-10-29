const authorize = (...allowedRoles) => {
    // Optional trailing options object (existing call sites pass only
    // role strings and are completely unaffected):
    //   authorize("DRIVER", { allowServiceEligibility: true })
    // GPS fix (Phase 8 finding): on the driver LOCATION routes only, a
    // partner whose legacy global status is not APPROVED may still act
    // when eligible for at least one service via eligibilityService —
    // a Buy & Deliver-only partner keeps global status PENDING by
    // design and was locked out of GPS refresh (and therefore out of
    // purchase offers) by the global-APPROVED-only check below.
    const options =
        allowedRoles.length > 0 &&
        typeof allowedRoles[allowedRoles.length - 1] === "object"
            ? allowedRoles.pop()
            : {};

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
            });

            let allowed =
                Boolean(driver) &&
                req.user.activeMode === "DRIVER" &&
                driver.verificationStatus === "APPROVED";

            if (
                !allowed &&
                options.allowServiceEligibility &&
                driver &&
                req.user.activeMode === "DRIVER"
            ) {
                const {
                    hasAnyEligibleService,
                } = require("../services/eligibilityService");

                allowed = (await hasAnyEligibleService(driver)).eligible;
            }

            if (!allowed) {
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