const express = require("express");
const { protect } = require("../middleware/authMiddleware");
const { authorize } = require("../middleware/roleMiddleware");
const {
    purchaseDriverEligibility,
} = require("../middleware/purchaseDriverEligibility");
const {
    // Passenger
    createPurchaseOrder,
    getMyPurchaseOrders,
    getPurchaseOrderDetails,
    getPurchaseOffers,
    acceptPurchaseOffer,
    approvePurchaseAmount,
    rejectPurchaseEstimate,
    regeneratePurchaseOtp,
    cancelPurchaseOrder,
    raisePurchaseDispute,
    confirmPurchasePayment,
    ratePurchasePartner,
    decideSubstitution,
    // Partner
    getAvailablePurchaseRequests,
    submitPurchaseOffer,
    withdrawPurchaseOffer,
    getDriverPurchaseTasks,
    getDriverPurchaseDetails,
    startShopping,
    updateShoppingLocation,
    submitCostEstimate,
    requestSubstitution,
    markPurchased,
    markOutForDelivery,
    markArrived,
    deliverPurchaseOrder,
} = require("../controllers/purchaseController");

const router = express.Router();

// ---------------------------------------------------------------------
// Passenger routes
// ---------------------------------------------------------------------
router.post("/", protect, authorize("PASSENGER"), createPurchaseOrder);
router.get("/my", protect, authorize("PASSENGER"), getMyPurchaseOrders);
router.get(
    "/:id/offers",
    protect,
    authorize("PASSENGER"),
    getPurchaseOffers
);
router.post(
    "/:id/offers/:offerId/accept",
    protect,
    authorize("PASSENGER"),
    acceptPurchaseOffer
);
router.post(
    "/:id/approve-amount",
    protect,
    authorize("PASSENGER"),
    approvePurchaseAmount
);
router.post(
    "/:id/reject-estimate",
    protect,
    authorize("PASSENGER"),
    rejectPurchaseEstimate
);
router.post(
    "/:id/otp",
    protect,
    authorize("PASSENGER"),
    regeneratePurchaseOtp
);
router.patch(
    "/:id/cancel",
    protect,
    authorize("PASSENGER"),
    cancelPurchaseOrder
);
router.post(
    "/:id/confirm-payment",
    protect,
    authorize("PASSENGER"),
    confirmPurchasePayment
);
router.post(
    "/:id/rate",
    protect,
    authorize("PASSENGER"),
    ratePurchasePartner
);
router.post(
    "/:id/substitution-decision",
    protect,
    authorize("PASSENGER"),
    decideSubstitution
);
// NOTE: GET /:id is registered near the bottom — Express matches in
// registration order and /available + /driver/* must win over /:id.

// ---------------------------------------------------------------------
// Partner (driver) routes. authorize() admits both roles at the route
// layer (a Buy & Deliver partner's account role is DRIVER, possibly
// without the legacy global approval the DRIVER-only gate demands);
// the real gate is purchaseDriverEligibility + the eligibility
// service, exactly as the Phase 2 design prescribes.
// ---------------------------------------------------------------------
router.get(
    "/available",
    protect,
    authorize("PASSENGER", "DRIVER"),
    purchaseDriverEligibility,
    getAvailablePurchaseRequests
);
router.get(
    "/driver/my",
    protect,
    authorize("PASSENGER", "DRIVER"),
    getDriverPurchaseTasks
);
router.get(
    "/driver/:id",
    protect,
    authorize("PASSENGER", "DRIVER"),
    getDriverPurchaseDetails
);
router.post(
    "/:id/offers",
    protect,
    authorize("PASSENGER", "DRIVER"),
    purchaseDriverEligibility,
    submitPurchaseOffer
);
router.delete(
    "/:id/offers/mine",
    protect,
    authorize("PASSENGER", "DRIVER"),
    purchaseDriverEligibility,
    withdrawPurchaseOffer
);
router.patch(
    "/:id/start-shopping",
    protect,
    authorize("PASSENGER", "DRIVER"),
    startShopping
);
router.patch(
    "/:id/shopping-location",
    protect,
    authorize("PASSENGER", "DRIVER"),
    updateShoppingLocation
);
router.post(
    "/:id/cost-estimate",
    protect,
    authorize("PASSENGER", "DRIVER"),
    submitCostEstimate
);
router.post(
    "/:id/substitution-request",
    protect,
    authorize("PASSENGER", "DRIVER"),
    requestSubstitution
);
router.post(
    "/:id/purchased",
    protect,
    authorize("PASSENGER", "DRIVER"),
    markPurchased
);
router.patch(
    "/:id/out-for-delivery",
    protect,
    authorize("PASSENGER", "DRIVER"),
    markOutForDelivery
);
router.patch(
    "/:id/arrived",
    protect,
    authorize("PASSENGER", "DRIVER"),
    markArrived
);
router.post(
    "/:id/deliver",
    protect,
    authorize("PASSENGER", "DRIVER"),
    deliverPurchaseOrder
);

// Either party to the order may raise a dispute; the controller
// resolves the actor server-side.
router.post(
    "/:id/dispute",
    protect,
    authorize("PASSENGER", "DRIVER"),
    raisePurchaseDispute
);

// Passenger order detail — registered LAST among the GET routes so the
// literal /available, /my and /driver/* paths above always match first.
router.get("/:id", protect, authorize("PASSENGER"), getPurchaseOrderDetails);

module.exports = router;
