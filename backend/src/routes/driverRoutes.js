const express = require("express");
const { protect } = require("../middleware/authMiddleware");
const { authorize } = require("../middleware/roleMiddleware");
const {
    registerDriver,
    getMyDriverStatus,
    updateOnlineStatus,
    updateDriverLocation,
} = require("../controllers/driverController");

const {
    getAvailableRides,
    getMyActiveRide,
} = require("../controllers/driverRideController");

const { getDriverHistory } = require("../controllers/driverHistoryController");

const { getDriverPublicProfile } = require("../controllers/driverPublicProfileController");

const { getMyWallet } = require("../controllers/driverWalletController");

const { getMyEarnings } = require("../controllers/driverEarningsController");

const router = express.Router();

router.post(
    "/register",
    protect,
    authorize("PASSENGER", "DRIVER"),
    registerDriver
);

router.get(
    "/me/status",
    protect,
    authorize("PASSENGER", "DRIVER"),
    getMyDriverStatus
);

router.patch(
    "/me/online-status",
    protect,
    authorize("PASSENGER", "DRIVER"),
    updateOnlineStatus
);

router.patch(
    "/me/location",
    protect,
    authorize("DRIVER"),
    updateDriverLocation
);

router.post(
    "/me/location",
    (req, res, next) => {
        res.on("finish", () => {
            console.log("[NATIVE GPS]", "POST", res.statusCode);
        });
        next();
    },
    protect,
    authorize("DRIVER"),
    (req, res, next) => {
        const accuracy = Number(req.body?.accuracy);
        if (!Number.isFinite(accuracy) || accuracy > 100 || accuracy < 0) {
            return res.status(400).json({
                success: false,
                message: "Accurate GPS fix required"
            });
        }
        if (req.body?.simulated === true) {
            return res.status(400).json({
                success: false,
                message: "Mock GPS location rejected"
            });
        }

        const time = Number(req.body?.time);
        if (!Number.isFinite(time) ||
            Math.abs(Date.now() - time) > 120000) {
            return res.status(400).json({
                success: false,
                message: "Stale GPS location rejected"
            });
        }

        next();
    },
    updateDriverLocation
);


const { getNearbyDrivers } = require("../controllers/driverMatchingController");

router.get(
    "/nearby",
    protect,
    authorize("PASSENGER"),
    getNearbyDrivers
);

router.get(
    "/me/available-rides",
    protect,
    authorize("PASSENGER", "DRIVER"),
    getAvailableRides
);

router.get(
    "/me/active-ride",
    protect,
    authorize("PASSENGER", "DRIVER"),
    getMyActiveRide
);

router.get(
    "/me/history",
    protect,
    authorize("PASSENGER", "DRIVER"),
    getDriverHistory
);

router.get(
    "/profile/:driverId",
    protect,
    authorize("PASSENGER"),
    getDriverPublicProfile
);

router.get(
    "/me/wallet",
    protect,
    authorize("PASSENGER", "DRIVER"),
    getMyWallet
);

router.get(
    "/me/earnings",
    protect,
    authorize("PASSENGER", "DRIVER"),
    getMyEarnings
);

module.exports = router;
