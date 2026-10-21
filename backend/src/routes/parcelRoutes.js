const express = require("express");
const { protect } = require("../middleware/authMiddleware");
const { authorize } = require("../middleware/roleMiddleware");
const {
    createParcel,
    getMyParcels,
    getParcelDetails,
    cancelParcel,
    getAvailableParcels,
    submitParcelOffer,
    getParcelOffers,
    acceptParcelOffer,
    getDriverParcels,
    getDriverParcelDetails,
    updateParcelStatus,
    regenerateParcelOtp,
} = require("../controllers/parcelController");

const { parcelDriverEligibility } = require("../middleware/parcelDriverEligibility");

const Driver = require("../models/Driver");
const ParcelOrder = require("../models/ParcelOrder");

const router = express.Router();

router.get("/:id/tracking", protect, authorize("PASSENGER"), async (req, res) => {
    try {
        const order = await ParcelOrder.findOne({
            _id: req.params.id,
            customerId: req.user._id,
        }).select("driverId status").lean();

        if (!order) {
            return res.status(404).json({
                success: false,
                message: "Parcel not found",
            });
        }

        const activeStatuses = [
            "DRIVER_ASSIGNED",
            "DRIVER_EN_ROUTE",
            "ARRIVED_AT_PICKUP",
            "PICKED_UP",
            "OUT_FOR_DELIVERY",
        ];

        if (!order.driverId || !activeStatuses.includes(order.status)) {
            return res.json({ success: true, location: null });
        }

        const driver = await Driver.findById(order.driverId)
            .select("currentLocation lastLocationUpdate")
            .lean();

        const coords = driver?.currentLocation?.coordinates;
        const updatedAt = driver?.lastLocationUpdate;

        if (
            !Array.isArray(coords) ||
            coords.length !== 2 ||
            !coords.every(Number.isFinite) ||
            !updatedAt ||
            Date.now() - new Date(updatedAt).getTime() > 120000
        ) {
            return res.json({ success: true, location: null });
        }

        return res.json({
            success: true,
            location: {
                latitude: coords[1],
                longitude: coords[0],
            },
            updatedAt,
        });
    } catch (error) {
        return res.status(400).json({
            success: false,
            message: "Unable to load parcel tracking",
        });
    }
});

router.post("/", protect, authorize("PASSENGER"), createParcel);
router.get("/my", protect, authorize("PASSENGER"), getMyParcels);
router.get("/available", protect, authorize("DRIVER"), parcelDriverEligibility, async (req, res) => {
    try {
        const parcels = await require("../models/ParcelOrder").find({
            status: "REQUESTED",
            driverId: null,
            vehicleType: req.parcelVehicle.vehicleType,
            pickup: {
                $near: {
                    $geometry: req.parcelDriver.currentLocation,
                    $maxDistance: 15000,
                },
            },
        })
            .limit(50)
            .select("serviceType status pickup destination parcel vehicleType requestedPrice paymentBy createdAt")
            .lean();

        return res.json({ success: true, orders: parcels });
    } catch (error) {
        console.error("Available parcels error:", error.message);
        return res.status(500).json({
            success: false,
            message: "Unable to load available parcels",
        });
    }
});
router.get("/driver/my", protect, authorize("DRIVER"), getDriverParcels);
router.get(
    "/driver/:id",
    protect,
    authorize("DRIVER"),
    getDriverParcelDetails
);

router.post(
    "/:id/otp",
    protect,
    authorize("PASSENGER"),
    regenerateParcelOtp
);
router.patch(
    "/:id/status",
    protect,
    authorize("DRIVER"),
    updateParcelStatus
);
router.post("/:id/offers", protect, authorize("DRIVER"), parcelDriverEligibility, submitParcelOffer);
router.get("/:id/offers", protect, authorize("PASSENGER"), getParcelOffers);
router.post(
    "/:id/offers/:offerId/accept",
    protect,
    authorize("PASSENGER"),
    acceptParcelOffer
);
router.get("/:id", protect, authorize("PASSENGER"), getParcelDetails);
router.patch("/:id/cancel", protect, authorize("PASSENGER"), cancelParcel);

module.exports = router;