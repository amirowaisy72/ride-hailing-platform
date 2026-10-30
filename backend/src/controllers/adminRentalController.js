const crypto = require("node:crypto");

const RentalPartner = require("../models/RentalPartner");
const RentalVehicle = require("../models/RentalVehicle");
const RentalBooking = require("../models/RentalBooking");
const CommissionSettings = require("../models/CommissionSettings");
const {
    makeEvent,
    transitionBooking,
    expireHoldIfNeeded,
    serializeBooking,
    loadBookingWithVehicle,
    notifyPassenger,
    notifyPartner,
} = require("./rentalBookingController");
const {
    serializeRentalVehicle,
    evaluateRentalDisputeResolution,
} = require("../services/rentalBookingService");

// ---------------------------------------------------------------------------
// Phase 5 — Safar Rentals ADMIN endpoints (Rental Operations backend).
// Mounted under /api/v1/admin/rentals (see routes/adminRentalRoutes
// .js), behind protect + authorize("ADMIN") like every admin module.
//
// The single most safety-critical handler here is
// verifyRentalFeePayment: it is the ONLY path that can move a booking
// to CONFIRMED, and it requires a SUBMITTED manual-payment proof that
// the admin has actually reviewed. Nothing auto-confirms.
// ---------------------------------------------------------------------------

const getGlobalSettingsDoc = () => CommissionSettings.findOne({ key: "GLOBAL" });

// ---------------------------------------------------------------------------
// Listing moderation
// ---------------------------------------------------------------------------

const listRentalVehiclesAdmin = async (req, res) => {
    try {
        const { status, rentalPartnerId } = req.query || {};
        const filter = {};

        if (status) {
            if (!["PENDING", "APPROVED", "REJECTED", "SUSPENDED"].includes(status)) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid listing status filter",
                });
            }
            filter.listingStatus = status;
        }

        if (rentalPartnerId) filter.rentalPartnerId = rentalPartnerId;

        const vehicles = await RentalVehicle.find(filter)
            .sort({ createdAt: -1 })
            .limit(200)
            .lean();

        return res.json({
            success: true,
            // Admins moderate listings, they do not browse them as a
            // customer — but the contact fields still stay out of this
            // serializer: an admin investigating a dispute reads the
            // BOOKING, whose admin view carries the handover record.
            vehicles: vehicles.map((v) => serializeRentalVehicle(v)),
        });
    } catch {
        return res.status(500).json({
            success: false,
            message: "Unable to load vehicle listings",
        });
    }
};

const moderateRentalVehicle = async (req, res) => {
    try {
        const { status, note } = req.body || {};

        if (!["APPROVED", "REJECTED", "SUSPENDED"].includes(status)) {
            return res.status(400).json({
                success: false,
                message: "Invalid moderation status",
            });
        }

        const vehicle = await RentalVehicle.findById(req.params.vehicleId);

        if (!vehicle) {
            return res.status(404).json({
                success: false,
                message: "Vehicle listing not found",
            });
        }

        if (status === "APPROVED") {
            // Anti-bypass gate (Amir's plan §2): the provider agreement
            // must be accepted BEFORE a first listing can go live. An
            // un-accepted partner's listing simply cannot be approved.
            const partner = await RentalPartner.findById(vehicle.rentalPartnerId)
                .select("agreementAcceptedAt applicationStatus")
                .lean();

            if (!partner || partner.applicationStatus !== "APPROVED") {
                return res.status(409).json({
                    success: false,
                    message: "The rental partner is not approved",
                });
            }

            if (!partner.agreementAcceptedAt) {
                return res.status(409).json({
                    success: false,
                    code: "AGREEMENT_NOT_ACCEPTED",
                    message: "The partner has not accepted the rental provider agreement yet",
                });
            }
        }

        vehicle.listingStatus = status;
        vehicle.moderationNote = String(note || "").slice(0, 500);
        vehicle.moderatedAt = new Date();
        vehicle.moderatedBy = req.user._id;

        await vehicle.save();

        return res.json({
            success: true,
            vehicle: serializeRentalVehicle(vehicle),
        });
    } catch (error) {
        console.error("Moderate rental vehicle error:", error.message);
        return res.status(500).json({
            success: false,
            message: "Unable to moderate listing",
        });
    }
};

// ---------------------------------------------------------------------------
// Platform settings — rental fields of the GLOBAL singleton only.
// (Deliberately separate from the commission settings update, whose
// full-payload contract must not be disturbed; both write the same
// CommissionSettings document.)
// ---------------------------------------------------------------------------

const getRentalSettings = async (req, res) => {
    try {
        const settings = await getGlobalSettingsDoc();

        if (!settings) {
            return res.json({
                success: true,
                settings: {
                    rentalsEnabled: true,
                    rentalBookingFeePercent: 5,
                    rentalsSelfDriveEnabled: true,
                    rentalPaymentDeadlineHours: 24,
                },
            });
        }

        return res.json({
            success: true,
            settings: {
                rentalsEnabled: settings.rentalsEnabled !== false,
                rentalBookingFeePercent: settings.rentalBookingFeePercent ?? 5,
                rentalsSelfDriveEnabled: settings.rentalsSelfDriveEnabled !== false,
                rentalPaymentDeadlineHours: settings.rentalPaymentDeadlineHours ?? 24,
                bankName: settings.bankName || "",
                bankAccountTitle: settings.bankAccountTitle || "",
                bankAccountNumber: settings.bankAccountNumber || "",
            },
        });
    } catch {
        return res.status(500).json({
            success: false,
            message: "Unable to load rental settings",
        });
    }
};

const updateRentalSettings = async (req, res) => {
    try {
        const {
            rentalsEnabled,
            rentalBookingFeePercent,
            rentalsSelfDriveEnabled,
            rentalPaymentDeadlineHours,
        } = req.body || {};

        if (rentalsEnabled !== undefined && typeof rentalsEnabled !== "boolean") {
            return res.status(400).json({ success: false, message: "Invalid rentalsEnabled" });
        }

        if (
            rentalBookingFeePercent !== undefined &&
            (typeof rentalBookingFeePercent !== "number" ||
                !Number.isFinite(rentalBookingFeePercent) ||
                rentalBookingFeePercent < 0 ||
                rentalBookingFeePercent > 100 ||
                Math.abs(rentalBookingFeePercent * 100 - Math.round(rentalBookingFeePercent * 100)) > 1e-9)
        ) {
            return res.status(400).json({ success: false, message: "Invalid rentalBookingFeePercent" });
        }

        if (rentalsSelfDriveEnabled !== undefined && typeof rentalsSelfDriveEnabled !== "boolean") {
            return res.status(400).json({ success: false, message: "Invalid rentalsSelfDriveEnabled" });
        }

        if (
            rentalPaymentDeadlineHours !== undefined &&
            (!Number.isInteger(rentalPaymentDeadlineHours) ||
                rentalPaymentDeadlineHours < 1 ||
                rentalPaymentDeadlineHours > 168)
        ) {
            return res.status(400).json({ success: false, message: "Invalid rentalPaymentDeadlineHours" });
        }

        let settings = await getGlobalSettingsDoc();

        if (!settings) {
            settings = new CommissionSettings({
                key: "GLOBAL",
                percentage: 0,
            });
        }

        if (rentalsEnabled !== undefined) settings.rentalsEnabled = rentalsEnabled;
        if (rentalBookingFeePercent !== undefined) settings.rentalBookingFeePercent = rentalBookingFeePercent;
        if (rentalsSelfDriveEnabled !== undefined) settings.rentalsSelfDriveEnabled = rentalsSelfDriveEnabled;
        if (rentalPaymentDeadlineHours !== undefined) settings.rentalPaymentDeadlineHours = rentalPaymentDeadlineHours;
        settings.updatedBy = req.user._id;

        await settings.save();

        return res.json({
            success: true,
            settings: {
                rentalsEnabled: settings.rentalsEnabled,
                rentalBookingFeePercent: settings.rentalBookingFeePercent,
                rentalsSelfDriveEnabled: settings.rentalsSelfDriveEnabled,
                rentalPaymentDeadlineHours: settings.rentalPaymentDeadlineHours,
            },
        });
    } catch (error) {
        console.error("Update rental settings error:", error.message);
        return res.status(500).json({
            success: false,
            message: "Unable to update rental settings",
        });
    }
};

// ---------------------------------------------------------------------------
// Booking management (read + dispute/ops visibility)
// ---------------------------------------------------------------------------

const listRentalBookingsAdmin = async (req, res) => {
    try {
        const { status, rentalPartnerId, passengerId, vehicleId } = req.query || {};
        const filter = {};

        if (status) filter.status = status;
        if (rentalPartnerId) filter.rentalPartnerId = rentalPartnerId;
        if (passengerId) filter.passengerId = passengerId;
        if (vehicleId) filter.vehicleId = vehicleId;

        const bookings = await RentalBooking.find(filter)
            .sort({ createdAt: -1 })
            .limit(200)
            .lean();

        return res.json({
            success: true,
            bookings: bookings.map((b) => serializeBooking(b, null)),
        });
    } catch {
        return res.status(500).json({
            success: false,
            message: "Unable to load bookings",
        });
    }
};

const getRentalBookingAdmin = async (req, res) => {
    try {
        const { booking, vehicle } = await loadBookingWithVehicle({
            _id: req.params.id,
        });

        if (!booking) {
            return res.status(404).json({
                success: false,
                message: "Booking not found",
            });
        }

        const fresh = await expireHoldIfNeeded(booking);

        // Admin investigations DO see the exact pickup details — that
        // is what dispute handling requires — so this view deliberately
        // bypasses the customer serializer and returns the record with
        // its handover/return evidence and full audit events.
        const vehicleDoc = vehicle
            ? {
                ...vehicle,
                pickupOtpHash: undefined,
            }
            : null;

        const bookingDoc =
            typeof fresh.toObject === "function" ? fresh.toObject() : fresh;

        return res.json({
            success: true,
            booking: { ...bookingDoc, pickupOtpHash: undefined },
            vehicle: vehicleDoc,
        });
    } catch {
        return res.status(400).json({
            success: false,
            message: "Invalid booking ID",
        });
    }
};

// ---------------------------------------------------------------------------
// Manual fee-payment verification queue
// ---------------------------------------------------------------------------

const listPendingFeePayments = async (req, res) => {
    try {
        const bookings = await RentalBooking.find({
            status: "PAYMENT_PENDING",
            "feePayment.status": "SUBMITTED",
        })
            .sort({ "feePayment.submittedAt": 1 })
            .limit(200)
            .lean();

        return res.json({
            success: true,
            payments: bookings.map((b) => ({
                bookingId: b._id,
                bookingRef: b.bookingRef,
                passengerId: b.passengerId,
                rentalPartnerId: b.rentalPartnerId,
                vehicleId: b.vehicleId,
                bookingFee: b.bookingFee,
                rentalCharges: b.rentalCharges,
                paymentDeadlineAt: b.paymentDeadlineAt,
                feePayment: b.feePayment,
                createdAt: b.createdAt,
            })),
        });
    } catch {
        return res.status(500).json({
            success: false,
            message: "Unable to load the payment verification queue",
        });
    }
};

// THE confirmation gate. An admin verifies the submitted manual
// payment (reference + proof against the platform bank account); only
// this handler may take a booking to CONFIRMED, via the pure rules
// module's feeVerified flag.
const verifyRentalFeePayment = async (req, res) => {
    try {
        const raw = await RentalBooking.findById(req.params.id);

        if (!raw) {
            return res.status(404).json({
                success: false,
                message: "Booking not found",
            });
        }

        const booking = await expireHoldIfNeeded(raw);

        if (booking.status !== "PAYMENT_PENDING" || booking.feePayment?.status !== "SUBMITTED") {
            return res.status(409).json({
                success: false,
                message: "No submitted fee payment is awaiting verification on this booking",
            });
        }

        // Final calendar re-check: if another booking confirmed the
        // same vehicle for an overlapping window while this payment
        // was in flight, confirming would double-book the car.
        const conflicts = await RentalBooking.find({
            vehicleId: booking.vehicleId,
            _id: { $ne: booking._id },
            status: {
                $in: ["CONFIRMED", "PICKUP_VERIFIED", "RENTAL_ACTIVE", "RETURN_PENDING"],
            },
            startAt: { $lt: booking.endAt },
            endAt: { $gt: booking.startAt },
        })
            .select("_id bookingRef")
            .lean();

        if (conflicts.length) {
            return res.status(409).json({
                success: false,
                code: "VEHICLE_DOUBLE_BOOKED",
                message: "The vehicle has since been confirmed for an overlapping booking",
                conflictingBookingRef: conflicts[0].bookingRef,
            });
        }

        const pickupOtp = cryptoRandomOtp();

        const updated = await transitionBooking({
            filter: { _id: booking._id, status: "PAYMENT_PENDING" },
            fromStatus: "PAYMENT_PENDING",
            toStatus: "CONFIRMED",
            set: {
                confirmedAt: new Date(),
                "feePayment.status": "VERIFIED",
                "feePayment.verifiedAt": new Date(),
                "feePayment.verifiedBy": req.user._id,
                "feePayment.rejectionReason": "",
                pickupOtpHash: hashOtp(pickupOtp),
                pickupOtpAttempts: 0,
            },
            event: {
                entry: makeEvent("FEE_PAYMENT_VERIFIED", "ADMIN", req.user._id, {
                    fromStatus: "PAYMENT_PENDING",
                    toStatus: "CONFIRMED",
                    amount: booking.bookingFee,
                }),
            },
            flags: { feeVerified: true },
        });

        if (!updated) {
            return res.status(409).json({
                success: false,
                message: "Booking status changed. Please refresh.",
            });
        }

        notifyPassenger(
            updated,
            { status: "CONFIRMED", message: "Your booking is confirmed" },
            "Booking Confirmed",
            `Your rental booking ${updated.bookingRef} is confirmed. Pickup details are now unlocked.`,
            "RENTAL_BOOKING_CONFIRMED"
        );

        notifyPartner(
            updated,
            "rental:booking:updated",
            { status: "CONFIRMED", message: "A booking was confirmed" },
            "Booking Confirmed",
            `Booking ${updated.bookingRef} is confirmed and the fee is secured.`,
            "RENTAL_BOOKING_CONFIRMED"
        );

        return res.json({ success: true, booking: serializeBooking(updated, null) });
    } catch (error) {
        console.error("Verify rental fee payment error:", error.message);
        return res.status(500).json({
            success: false,
            message: "Unable to verify payment",
        });
    }
};

// Rejection does NOT cancel anything: the booking stays PAYMENT_PENDING
// with the reason recorded, and the passenger may resubmit a corrected
// proof before the deadline.
const rejectRentalFeePayment = async (req, res) => {
    try {
        const reason = String(req.body?.reason || "").trim();

        if (!reason || reason.length > 500) {
            return res.status(400).json({
                success: false,
                message: "A rejection reason is required",
            });
        }

        const updated = await RentalBooking.findOneAndUpdate(
            {
                _id: req.params.id,
                status: "PAYMENT_PENDING",
                "feePayment.status": "SUBMITTED",
            },
            {
                $set: {
                    "feePayment.status": "REJECTED",
                    "feePayment.rejectionReason": reason,
                    "feePayment.verifiedBy": req.user._id,
                    "feePayment.verifiedAt": new Date(),
                },
                $push: {
                    events: makeEvent("FEE_PAYMENT_REJECTED", "ADMIN", req.user._id, {
                        note: reason,
                    }),
                },
            },
            { new: true, runValidators: true }
        );

        if (!updated) {
            return res.status(409).json({
                success: false,
                message: "No submitted fee payment is awaiting verification on this booking",
            });
        }

        notifyPassenger(
            updated,
            {
                status: "PAYMENT_PENDING",
                message: "Your fee payment proof was not accepted",
            },
            "Payment Proof Rejected",
            `Your booking-fee proof was not accepted: ${reason}. Please resubmit before the deadline.`,
            "RENTAL_FEE_REJECTED"
        );

        return res.json({ success: true, booking: serializeBooking(updated, null) });
    } catch {
        return res.status(400).json({
            success: false,
            message: "Unable to reject payment",
        });
    }
};

// OTP helpers local to this module (same parcel pattern as the
// booking controller — hashing a fresh pickup OTP at confirmation so
// the CONFIRMED booking always carries a live code even if the
// accept-time one is stale).
const hashOtp = (otp) =>
    crypto.createHash("sha256").update(String(otp)).digest("hex");
const cryptoRandomOtp = () => String(crypto.randomInt(100000, 1000000));

// Marks a DUE fee refund as actually refunded (the manual bank
// transfer back to the customer happens off-platform in the pilot;
// this records that it was done, by whom, and when).
const markRentalFeeRefunded = async (req, res) => {
    try {
        const updated = await RentalBooking.findOneAndUpdate(
            {
                _id: req.params.id,
                status: "CANCELLED",
                "feeRefund.status": "DUE",
            },
            {
                $set: {
                    "feeRefund.status": "REFUNDED",
                    "feeRefund.refundedAt": new Date(),
                    "feeRefund.refundedBy": req.user._id,
                },
                $push: {
                    events: makeEvent("FEE_REFUNDED", "ADMIN", req.user._id, {}),
                },
            },
            { new: true, runValidators: true }
        );

        if (!updated) {
            return res.status(409).json({
                success: false,
                message: "No due fee refund on this booking",
            });
        }

        notifyPassenger(
            updated,
            { status: "CANCELLED", message: "Your booking fee was refunded" },
            "Fee Refunded",
            `Your booking fee of PKR ${updated.feeRefund.amount} has been refunded.`,
            "RENTAL_FEE_REFUNDED"
        );

        return res.json({ success: true, booking: serializeBooking(updated, null) });
    } catch {
        return res.status(400).json({
            success: false,
            message: "Unable to mark refund",
        });
    }
};

// ---------------------------------------------------------------------------
// Suspicious-cancellation report (read-only aggregation).
// Anti-bypass monitoring (Amir's plan §6): passengers who repeatedly
// book-and-cancel (a classic route to meeting providers off-platform)
// and providers with abnormal cancellation volumes/patterns.
// ---------------------------------------------------------------------------

const getSuspiciousCancellations = async (req, res) => {
    try {
        const days = Math.min(Math.max(Number(req.query?.days) || 30, 1), 365);
        const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
        const minCount = Math.max(Number(req.query?.minCount) || 3, 2);

        const [passengers, partners] = await Promise.all([
            RentalBooking.aggregate([
                {
                    $match: {
                        status: "CANCELLED",
                        cancelledBy: "PASSENGER",
                        cancelledAt: { $gte: since },
                    },
                },
                {
                    $group: {
                        _id: "$passengerId",
                        cancellations: { $sum: 1 },
                        // Cancelling AFTER the fee was verified is the
                        // strongest off-platform signal: the parties
                        // had each other's details by then.
                        afterConfirmation: {
                            $sum: {
                                $cond: [
                                    { $eq: ["$feePayment.status", "VERIFIED"] },
                                    1,
                                    0,
                                ],
                            },
                        },
                        lastCancelledAt: { $max: "$cancelledAt" },
                    },
                },
                { $match: { cancellations: { $gte: minCount } } },
                { $sort: { cancellations: -1 } },
                { $limit: 100 },
            ]),
            RentalBooking.aggregate([
                {
                    $match: {
                        status: "CANCELLED",
                        cancelledAt: { $gte: since },
                    },
                },
                {
                    $group: {
                        _id: "$rentalPartnerId",
                        totalCancellations: { $sum: 1 },
                        partnerCancellations: {
                            $sum: {
                                $cond: [
                                    { $eq: ["$cancelledBy", "PARTNER"] },
                                    1,
                                    0,
                                ],
                            },
                        },
                        // Partner cancelling AFTER the customer's fee
                        // was verified = the false-cancellation pattern
                        // the agreement prohibits.
                        afterFeeVerified: {
                            $sum: {
                                $cond: [
                                    {
                                        $and: [
                                            { $eq: ["$cancelledBy", "PARTNER"] },
                                            { $eq: ["$feePayment.status", "VERIFIED"] },
                                        ],
                                    },
                                    1,
                                    0,
                                ],
                            },
                        },
                        lastCancelledAt: { $max: "$cancelledAt" },
                    },
                },
                {
                    $match: {
                        $or: [
                            { totalCancellations: { $gte: minCount } },
                            { afterFeeVerified: { $gte: 1 } },
                        ],
                    },
                },
                { $sort: { afterFeeVerified: -1, totalCancellations: -1 } },
                { $limit: 100 },
            ]),
        ]);

        return res.json({
            success: true,
            windowDays: days,
            minCount,
            suspiciousPassengers: passengers.map((p) => ({
                passengerId: p._id,
                cancellations: p.cancellations,
                cancellationsAfterConfirmation: p.afterConfirmation,
                lastCancelledAt: p.lastCancelledAt,
            })),
            suspiciousPartners: partners.map((p) => ({
                rentalPartnerId: p._id,
                totalCancellations: p.totalCancellations,
                partnerCancellations: p.partnerCancellations,
                cancellationsAfterFeeVerified: p.afterFeeVerified,
                lastCancelledAt: p.lastCancelledAt,
            })),
        });
    } catch (error) {
        console.error("Suspicious cancellations error:", error.message);
        return res.status(500).json({
            success: false,
            message: "Unable to build the cancellation report",
        });
    }
};

// ---------------------------------------------------------------------------
// Dispute resolution (Phase 7) — the admin-only outcome set from
// rentalBookingService, applied atomically against status DISPUTED.
// A CANCELLED outcome decides the fee refund through the ordinary
// cancellation rules (fault mapped onto cancelledBy); a DUE refund is
// then paid out via markRentalFeeRefunded above, unchanged.
// ---------------------------------------------------------------------------

const resolveRentalDispute = async (req, res) => {
    try {
        const { outcome } = req.body || {};
        const fault = req.body?.fault || "NONE";
        const note = String(req.body?.note || "").trim();

        if (!note || note.length > 500) {
            return res.status(400).json({
                success: false,
                message: "A resolution note is required",
            });
        }

        const booking = await RentalBooking.findById(req.params.id);

        if (!booking) {
            return res.status(404).json({
                success: false,
                message: "Booking not found",
            });
        }

        const vehicle = await RentalVehicle.findById(booking.vehicleId)
            .select("cancellationPolicy")
            .lean();

        const decision = evaluateRentalDisputeResolution({
            booking,
            outcome,
            fault,
            policy: vehicle?.cancellationPolicy || "MODERATE",
        });

        if (!decision.ok) {
            return res.status(
                decision.code === "BOOKING_NOT_DISPUTED" ? 409 : 400
            ).json({
                success: false,
                code: decision.code,
                message: decision.message,
            });
        }

        const now = new Date();
        const set = {
            status: decision.toStatus,
            disputeResolution: {
                outcome: decision.toStatus,
                fault,
                note,
                resolvedBy: req.user._id,
                resolvedAt: now,
            },
        };

        if (decision.toStatus === "COMPLETED") {
            set.completedAt = now;
        }

        if (decision.toStatus === "CANCELLED") {
            set.cancelledBy = "ADMIN";
            set.cancelledAt = now;
            set.cancelReason = note;

            if (decision.feeRefund) {
                set["feeRefund.status"] = decision.feeRefund.status;
                set["feeRefund.percent"] = decision.feeRefund.percent;
                set["feeRefund.amount"] = decision.feeRefund.amount;
            }
        }

        if (decision.toStatus === "NO_SHOW") {
            set.noShowAt = now;
            set.noShowBy = decision.noShowBy;
        }

        const updated = await RentalBooking.findOneAndUpdate(
            { _id: booking._id, status: "DISPUTED" },
            {
                $set: set,
                $push: {
                    events: makeEvent("DISPUTE_RESOLVED", "ADMIN", req.user._id, {
                        fromStatus: "DISPUTED",
                        toStatus: decision.toStatus,
                        amount: decision.feeRefund?.amount || null,
                        note,
                    }),
                },
            },
            { new: true, runValidators: true }
        );

        if (!updated) {
            return res.status(409).json({
                success: false,
                message: "Booking status changed. Please refresh.",
            });
        }

        const message = `Your rental dispute on booking ${updated.bookingRef} was resolved as ${decision.toStatus.toLowerCase()} by the Safar team.`;

        notifyPassenger(
            updated,
            { status: decision.toStatus, message: "Dispute resolved" },
            "Dispute Resolved",
            message,
            "RENTAL_DISPUTE_RESOLVED"
        );

        notifyPartner(
            updated,
            "rental:booking:updated",
            { status: decision.toStatus, message: "Dispute resolved" },
            "Dispute Resolved",
            message,
            "RENTAL_DISPUTE_RESOLVED"
        );

        return res.json({ success: true, booking: serializeBooking(updated, null) });
    } catch (error) {
        console.error("Resolve rental dispute error:", error.message);
        return res.status(500).json({
            success: false,
            message: "Unable to resolve dispute",
        });
    }
};

// ---------------------------------------------------------------------------
// Booking-fee reconciliation (Phase 7, read-only).
// Verified fees are totalled over the requested window (by the moment
// an admin verified them) and broken down by the bookings' CURRENT
// status; refunds paid are windowed by refund time; refunds DUE are a
// live snapshot (a due refund carries no "became due" timestamp).
// ---------------------------------------------------------------------------

const getFeeReconciliation = async (req, res) => {
    try {
        const now = new Date();
        let from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        let to = now;

        if (req.query?.from) {
            from = new Date(req.query.from);
            if (!Number.isFinite(from.getTime())) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid from date",
                });
            }
        }

        if (req.query?.to) {
            to = new Date(req.query.to);
            if (!Number.isFinite(to.getTime())) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid to date",
                });
            }
        }

        if (to < from) {
            return res.status(400).json({
                success: false,
                message: "The to date must be after the from date",
            });
        }

        const [verifiedByStatus, pendingRows, dueRows, refundedRows] =
            await Promise.all([
                RentalBooking.aggregate([
                    {
                        $match: {
                            "feePayment.status": "VERIFIED",
                            "feePayment.verifiedAt": { $gte: from, $lte: to },
                        },
                    },
                    {
                        $group: {
                            _id: "$status",
                            count: { $sum: 1 },
                            totalFee: { $sum: "$bookingFee" },
                        },
                    },
                    { $sort: { totalFee: -1 } },
                ]),
                RentalBooking.aggregate([
                    {
                        $match: {
                            status: "PAYMENT_PENDING",
                            "feePayment.status": "SUBMITTED",
                        },
                    },
                    {
                        $group: {
                            _id: null,
                            count: { $sum: 1 },
                            totalFee: { $sum: "$bookingFee" },
                        },
                    },
                ]),
                RentalBooking.aggregate([
                    { $match: { "feeRefund.status": "DUE" } },
                    {
                        $group: {
                            _id: null,
                            count: { $sum: 1 },
                            totalAmount: { $sum: "$feeRefund.amount" },
                        },
                    },
                ]),
                RentalBooking.aggregate([
                    {
                        $match: {
                            "feeRefund.status": "REFUNDED",
                            "feeRefund.refundedAt": { $gte: from, $lte: to },
                        },
                    },
                    {
                        $group: {
                            _id: null,
                            count: { $sum: 1 },
                            totalAmount: { $sum: "$feeRefund.amount" },
                        },
                    },
                ]),
            ]);

        const verifiedTotal = verifiedByStatus.reduce(
            (acc, row) => ({
                count: acc.count + row.count,
                totalFee: acc.totalFee + row.totalFee,
            }),
            { count: 0, totalFee: 0 }
        );

        return res.json({
            success: true,
            window: { from, to },
            verifiedFees: {
                ...verifiedTotal,
                byCurrentStatus: verifiedByStatus.map((row) => ({
                    status: row._id,
                    count: row.count,
                    totalFee: row.totalFee,
                })),
            },
            pendingVerification: {
                count: pendingRows[0]?.count || 0,
                totalFee: pendingRows[0]?.totalFee || 0,
            },
            refundsDue: {
                count: dueRows[0]?.count || 0,
                totalAmount: dueRows[0]?.totalAmount || 0,
                asOf: now,
            },
            refundsPaid: {
                count: refundedRows[0]?.count || 0,
                totalAmount: refundedRows[0]?.totalAmount || 0,
            },
        });
    } catch (error) {
        console.error("Fee reconciliation error:", error.message);
        return res.status(500).json({
            success: false,
            message: "Unable to build the fee reconciliation",
        });
    }
};

module.exports = {
    listRentalVehiclesAdmin,
    moderateRentalVehicle,
    getRentalSettings,
    updateRentalSettings,
    listRentalBookingsAdmin,
    getRentalBookingAdmin,
    listPendingFeePayments,
    verifyRentalFeePayment,
    rejectRentalFeePayment,
    markRentalFeeRefunded,
    getSuspiciousCancellations,
    resolveRentalDispute,
    getFeeReconciliation,
};
