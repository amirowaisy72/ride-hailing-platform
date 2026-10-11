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
    authorize("DRIVER"),
    registerDriver
);

router.get(
    "/me/status",
    protect,
    authorize("DRIVER"),
    getMyDriverStatus
);

router.patch(
    "/me/online-status",
    protect,
    authorize("DRIVER"),
    updateOnlineStatus
);

router.patch(
    "/me/location",
    protect,
    authorize("DRIVER"),
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
    authorize("DRIVER"),
    getAvailableRides
);

router.get(
    "/me/active-ride",
    protect,
    authorize("DRIVER"),
    getMyActiveRide
);

router.get(
    "/me/history",
    protect,
    authorize("DRIVER"),
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
    authorize("DRIVER"),
    getMyWallet
);

router.get(
    "/me/earnings",
    protect,
    authorize("DRIVER"),
    getMyEarnings
);

module.exports = router;
