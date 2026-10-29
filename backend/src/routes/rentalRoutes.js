const express = require("express");
const { protect } = require("../middleware/authMiddleware");
const { authorize } = require("../middleware/roleMiddleware");
const {
    acceptRentalAgreement,
    getRentalAgreementState,
    createRentalVehicle,
    getMyRentalVehicles,
    updateRentalVehicle,
    setRentalVehicleActive,
    deleteRentalVehicle,
    setRentalVehicleBlockedDates,
} = require("../controllers/rentalVehicleController");
const {
    searchRentalVehicles,
    getRentalVehicleDetails,
    createRentalBooking,
    getMyRentalBookings,
    getRentalBookingDetails,
    getRentalFeeInstructions,
    submitRentalFeePayment,
    getRentalPickupOtp,
    confirmRentalReturn,
    getPartnerRentalBookings,
    getPartnerRentalBookingDetails,
    acceptRentalBooking,
    rejectRentalBooking,
    verifyRentalPickup,
    startRental,
    submitRentalReturn,
    cancelRentalBooking,
    markRentalNoShow,
    raiseRentalDispute,
    rateRentalPartner,
} = require("../controllers/rentalBookingController");

const router = express.Router();

// ---------------------------------------------------------------------
// Phase 5 — Safar Rentals. Mounted at /api/v1/rentals. A rental
// partner's account role is PASSENGER or DRIVER (the RentalPartner
// record is the role), so partner routes authorize both and the
// controllers resolve the RentalPartner server-side — the same
// approach as the purchase partner routes. Admin Rentals live under
// /api/v1/admin/rentals (routes/adminRentalRoutes.js). The Phase 2
// foundation routes (/api/v1/rental-partners: apply/KYC) are separate
// and untouched.
// ---------------------------------------------------------------------

// --- Anti-bypass provider agreement ----------------------------------
router.get(
    "/agreement",
    protect,
    authorize("PASSENGER", "DRIVER"),
    getRentalAgreementState
);
router.post(
    "/agreement/accept",
    protect,
    authorize("PASSENGER", "DRIVER"),
    acceptRentalAgreement
);

// --- Partner: vehicle listings ---------------------------------------
router.post(
    "/vehicles",
    protect,
    authorize("PASSENGER", "DRIVER"),
    createRentalVehicle
);
router.get(
    "/vehicles/mine",
    protect,
    authorize("PASSENGER", "DRIVER"),
    getMyRentalVehicles
);
router.patch(
    "/vehicles/:vehicleId/active",
    protect,
    authorize("PASSENGER", "DRIVER"),
    setRentalVehicleActive
);
router.patch(
    "/vehicles/:vehicleId/blocked-dates",
    protect,
    authorize("PASSENGER", "DRIVER"),
    setRentalVehicleBlockedDates
);
router.patch(
    "/vehicles/:vehicleId",
    protect,
    authorize("PASSENGER", "DRIVER"),
    updateRentalVehicle
);
router.delete(
    "/vehicles/:vehicleId",
    protect,
    authorize("PASSENGER", "DRIVER"),
    deleteRentalVehicle
);

// --- Passenger: search + listing detail (always masked) ---------------
router.get("/search", protect, authorize("PASSENGER", "DRIVER"), searchRentalVehicles);
router.get(
    "/vehicles/:vehicleId",
    protect,
    authorize("PASSENGER", "DRIVER"),
    getRentalVehicleDetails
);

// --- Partner: booking inbox + execution -------------------------------
router.get(
    "/partner/bookings",
    protect,
    authorize("PASSENGER", "DRIVER"),
    getPartnerRentalBookings
);
router.get(
    "/partner/bookings/:id",
    protect,
    authorize("PASSENGER", "DRIVER"),
    getPartnerRentalBookingDetails
);
router.post(
    "/partner/bookings/:id/accept",
    protect,
    authorize("PASSENGER", "DRIVER"),
    acceptRentalBooking
);
router.post(
    "/partner/bookings/:id/reject",
    protect,
    authorize("PASSENGER", "DRIVER"),
    rejectRentalBooking
);
router.post(
    "/partner/bookings/:id/verify-pickup",
    protect,
    authorize("PASSENGER", "DRIVER"),
    verifyRentalPickup
);
router.post(
    "/partner/bookings/:id/start",
    protect,
    authorize("PASSENGER", "DRIVER"),
    startRental
);
router.post(
    "/partner/bookings/:id/return",
    protect,
    authorize("PASSENGER", "DRIVER"),
    submitRentalReturn
);

// --- Passenger: bookings ----------------------------------------------
router.post("/bookings", protect, authorize("PASSENGER", "DRIVER"), createRentalBooking);
router.get(
    "/bookings/mine",
    protect,
    authorize("PASSENGER", "DRIVER"),
    getMyRentalBookings
);
router.get(
    "/bookings/:id/fee-instructions",
    protect,
    authorize("PASSENGER", "DRIVER"),
    getRentalFeeInstructions
);
router.post(
    "/bookings/:id/fee-payment",
    protect,
    authorize("PASSENGER", "DRIVER"),
    submitRentalFeePayment
);
router.post(
    "/bookings/:id/pickup-otp",
    protect,
    authorize("PASSENGER", "DRIVER"),
    getRentalPickupOtp
);
router.post(
    "/bookings/:id/confirm-return",
    protect,
    authorize("PASSENGER", "DRIVER"),
    confirmRentalReturn
);
router.post(
    "/bookings/:id/rate",
    protect,
    authorize("PASSENGER", "DRIVER"),
    rateRentalPartner
);
router.get(
    "/bookings/:id",
    protect,
    authorize("PASSENGER", "DRIVER"),
    getRentalBookingDetails
);

// --- Either party (actor resolved server-side) -------------------------
router.patch(
    "/bookings/:id/cancel",
    protect,
    authorize("PASSENGER", "DRIVER"),
    cancelRentalBooking
);
router.post(
    "/bookings/:id/no-show",
    protect,
    authorize("PASSENGER", "DRIVER"),
    markRentalNoShow
);
router.post(
    "/bookings/:id/dispute",
    protect,
    authorize("PASSENGER", "DRIVER"),
    raiseRentalDispute
);

module.exports = router;
