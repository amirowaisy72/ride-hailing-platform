
const express = require("express");
const { protect } = require("../middleware/authMiddleware");
const { authorize } = require("../middleware/roleMiddleware");
const { createRide, getActiveRide } = require("../controllers/rideController");

const { cancelRide } = require("../controllers/rideCancellationController");

const { updateTripStatus } = require("../controllers/driverTripController");

const { getMyRideHistory } = require("../controllers/rideHistoryController");

const { submitDriverReview } = require("../controllers/driverReviewController");

const { getLatestCompletedRide } = require("../controllers/latestCompletedRideController");

const { getRideReceipt } = require("../controllers/rideReceiptController");

const router = express.Router();

router.get("/waiting-settings", protect, async (req, res) => {
    try {
        const CommissionSettings = require("../models/CommissionSettings");
        const settings = await CommissionSettings.findOne({
            key: "GLOBAL",
        }).lean();

        res.json({
            success: true,
            freeWaitingMinutes: settings?.freeWaitingMinutes ?? 5,
            waitingChargePerMinute: settings?.waitingChargePerMinute ?? 0,
        });
    } catch {
        res.status(500).json({
            success: false,
            message: "Unable to load waiting settings",
        });
    }
});

router.post("/", protect, authorize("PASSENGER"), createRide);
router.get("/active", protect, authorize("PASSENGER"), getActiveRide);
router.get("/history", protect, authorize("PASSENGER"), getMyRideHistory);
router.get("/latest-completed", protect, authorize("PASSENGER"), getLatestCompletedRide);
// Either party may cancel: the passenger (before OR after driver
// selection, up to TRIP_STARTED) or the assigned driver (which
// releases the ride back to REQUESTED). The controller resolves the
// caller from the ride; see rideCancellationController.js.
router.post("/:rideId/cancel", protect, authorize("PASSENGER", "DRIVER"), cancelRide);

const {
    submitOffer,
    getRideOffers,
    rejectOffer,
} = require("../controllers/rideOfferController");

router.post(
    "/:rideId/offers",
    protect,
    // Per-service eligibility: a driver approved ONLY through the
    // Services screen (RIDE=APPROVED, global status still PENDING)
    // must be able to offer; the controller additionally enforces
    // canReceiveRideRequests for the RIDE service specifically.
    authorize("DRIVER", { allowServiceEligibility: true }),
    submitOffer
);

router.get(
    "/:rideId/offers",
    protect,
    authorize("PASSENGER"),
    getRideOffers
);

router.patch(
    "/:rideId/offers/:offerId/reject",
    protect,
    authorize("PASSENGER"),
    rejectOffer
);

const { selectDriver } = require("../controllers/driverSelectionController");

router.post(
    "/:rideId/select-driver",
    protect,
    authorize("PASSENGER"),
    selectDriver
);

router.patch(
    "/:rideId/status",
    protect,
    authorize("DRIVER", { allowServiceEligibility: true }),
    updateTripStatus
);

router.post(
    "/:rideId/review",
    protect,
    authorize("PASSENGER"),
    submitDriverReview
);

router.get(
    "/:rideId/receipt",
    protect,
    authorize("PASSENGER"),
    getRideReceipt
);

const {
    updateRideStop,
} = require("../controllers/rideStopController");

router.patch(
    "/:rideId/stops",
    protect,
    authorize("DRIVER", { allowServiceEligibility: true }),
    updateRideStop
);

const { getRideDriverLocation } = require("../controllers/rideTrackingController");
router.get("/:rideId/driver-location", protect, authorize("PASSENGER"), getRideDriverLocation);

const { getMessages, sendMessage } = require("../controllers/rideChatController");
router.get("/:rideId/messages", protect, getMessages);
router.post("/:rideId/messages", protect, sendMessage);

const { nearbyDriversForRide } = require("../controllers/nearbyDriverController");
router.get("/:rideId/nearby-drivers", protect, authorize("PASSENGER"), nearbyDriversForRide);

module.exports = router;



