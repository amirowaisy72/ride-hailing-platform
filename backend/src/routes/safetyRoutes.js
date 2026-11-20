const express = require("express");
const { protect } = require("../middleware/authMiddleware");
const { authorize } = require("../middleware/roleMiddleware");
const {
    sendSos,
    getPassengerVerification,
    createShareLink,
    getSharedRide,
    listSosAlerts,
    updateSosAlert,
    getRideTrail,
} = require("../controllers/safetyController");

// Safety (Safar To-Do #5, Phase 1). New router, additive only.
// Mounted at /api/v1/safety (user routes) and /api/v1/admin/safety
// (admin routes) — see server.js.

const userRouter = express.Router();

// Public: live-trip share page. No auth by design — the token IS the
// access control (24-hour expiry, position/status only, no phones).
userRouter.get("/shared/:token", getSharedRide);

userRouter.use(protect);

// One-tap SOS from an active ride (driver or passenger).
userRouter.post("/sos", authorize("PASSENGER", "DRIVER"), sendSos);

// Live-trip share link for one of your active rides.
userRouter.post(
    "/rides/:rideId/share-link",
    authorize("PASSENGER", "DRIVER"),
    createShareLink
);

// Passenger verification a driver sees BEFORE offering on a ride.
userRouter.get(
    "/rides/:rideId/passenger-verification",
    authorize("DRIVER", { allowServiceEligibility: true }),
    getPassengerVerification
);

const adminRouter = express.Router();

adminRouter.use(protect, authorize("ADMIN"));

adminRouter.get("/sos-alerts", listSosAlerts);
adminRouter.patch("/sos-alerts/:id", updateSosAlert);
// FIR pack: full GPS trail + driver/passenger details for a ride.
adminRouter.get("/rides/:rideId/trail", getRideTrail);

module.exports = { safetyUserRouter: userRouter, safetyAdminRouter: adminRouter };
