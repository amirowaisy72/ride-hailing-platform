const express = require("express");
const { protect } = require("../middleware/authMiddleware");
const { authorize } = require("../middleware/roleMiddleware");
const {
    listRentalVehiclesAdmin,
    moderateRentalVehicle,
    getRentalSettings,
    updateRentalSettings,
    listRentalBookingsAdmin,
    getRentalBookingAdmin,
    listPendingFeePayments,
    verifyRentalFeePayment,
    confirmRentalBookingFree,
    rejectRentalFeePayment,
    listPendingRentPayments,
    verifyRentalRentPayment,
    rejectRentalRentPayment,
    markPartnerPayoutPaid,
    markRentalFeeRefunded,
    getSuspiciousCancellations,
    resolveRentalDispute,
    getFeeReconciliation,
} = require("../controllers/adminRentalController");

const router = express.Router();

router.use(protect, authorize("ADMIN"));

// Phase 5 — Safar Rentals admin (Rental Operations backend). Partner
// KYC/approval stays under /api/v1/admin/rental-partners (Phase 2).

// Listing moderation
router.get("/vehicles", listRentalVehiclesAdmin);
router.patch("/vehicles/:vehicleId/moderate", moderateRentalVehicle);

// Platform configuration (booking fee %, Self-Drive launch gate,
// payment deadline)
router.get("/settings", getRentalSettings);
router.patch("/settings", updateRentalSettings);

// Manual fee-payment verification queue — the ONLY route to CONFIRMED
// for PAID bookings. Free bookings use confirm-free below instead.
router.get("/payments/pending", listPendingFeePayments);
router.post("/bookings/:id/verify-payment", verifyRentalFeePayment);
router.post("/bookings/:id/confirm-free", confirmRentalBookingFree);
router.post("/bookings/:id/reject-payment", rejectRentalFeePayment);
router.post("/bookings/:id/mark-refunded", markRentalFeeRefunded);

// Rent paid TO the platform (To-Do #3): verification queue + payout.
// NOTE: confirm-free (POST /bookings/:id/confirm-free) already exists
// on origin/main (live 1.0.7) but NOT in this checkout (67 commits
// behind) — it is deliberately NOT re-implemented here; this checkout
// catches up to it by merging main. These rent/payout routes are new.
router.get("/rent-payments/pending", listPendingRentPayments);
router.post("/bookings/:id/verify-rent-payment", verifyRentalRentPayment);
router.post("/bookings/:id/reject-rent-payment", rejectRentalRentPayment);
router.post("/bookings/:id/mark-payout-paid", markPartnerPayoutPaid);

// Booking management
router.get("/bookings", listRentalBookingsAdmin);
router.get("/bookings/:id", getRentalBookingAdmin);

// Phase 7 — dispute resolution (admin-only outcome set from
// rentalBookingService; DISPUTED is terminal for everyone else)
router.post("/bookings/:id/resolve-dispute", resolveRentalDispute);

// Anti-bypass monitoring + Phase 7 fee reconciliation
router.get("/reports/suspicious-cancellations", getSuspiciousCancellations);
router.get("/reports/fee-reconciliation", getFeeReconciliation);

module.exports = router;
