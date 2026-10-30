// ---------------------------------------------------------------------------
// Phase 5 — Safar Rentals domain rules: SINGLE SOURCE OF TRUTH for the
// RentalBooking state machine, the money math, the calendar rules and
// the anti-bypass contact masking.
//
// This module is deliberately PURE — no database access, no model
// imports — so the rules can be unit-tested without MongoDB (see
// backend/tests/rentalBookingService.test.js) and reused identically by
// the REST controllers, exactly like services/purchaseOrderService.js.
//
// Money invariants enforced here:
//  - THREE amounts are always kept separate on a booking: the rental
//    charges (the partner's money), the platform BOOKING FEE (Safar's
//    money, customer-paid, collected at confirmation) and the security
//    DEPOSIT (refundable, nobody's revenue). They are never merged into
//    one opaque total in storage.
//  - A booking can NEVER reach CONFIRMED without a VERIFIED booking-fee
//    payment (in the pilot: a manual bank transfer an admin verified).
//    Unverified payments confirm nothing.
//  - The booking fee is a percentage of the rental charges ONLY — never
//    of the deposit.
//
// Anti-bypass invariants:
//  - The exact pickup address and the pickup contact are unreachable
//    before CONFIRMED. Masking is enforced HERE, in the serializers the
//    controllers use — not merely hidden in a UI.
// ---------------------------------------------------------------------------

const RENTAL_STATUSES = [
    "SEARCHING",
    "REQUESTED",
    "PROVIDER_ACCEPTED",
    "PAYMENT_PENDING",
    "CONFIRMED",
    "PICKUP_VERIFIED",
    "RENTAL_ACTIVE",
    "RETURN_PENDING",
    "COMPLETED",
    "CANCELLED",
    "NO_SHOW",
    "DISPUTED",
];

// Allowed forward transitions. Every controller action must move the
// booking along one of these edges, via an atomic status-guarded
// update. SEARCHING is the passenger's pre-request browsing state: it
// is part of Amir's lifecycle, but a persisted booking is CREATED in
// REQUESTED (there is nothing to store while someone is only
// searching). DISPUTED is reachable from every state where money or a
// vehicle has actually changed hands; terminal states are closed.
const RENTAL_TRANSITIONS = {
    SEARCHING: ["REQUESTED", "CANCELLED"],
    REQUESTED: ["PROVIDER_ACCEPTED", "CANCELLED", "DISPUTED"],
    // Accepting places a temporary calendar HOLD and starts the
    // payment clock; the booking then advances to PAYMENT_PENDING.
    PROVIDER_ACCEPTED: ["PAYMENT_PENDING", "CANCELLED", "DISPUTED"],
    // CONFIRMED is reachable ONLY from PAYMENT_PENDING and ONLY with a
    // verified fee payment (flags.feeVerified — see canTransition).
    // An admin rejecting a payment proof does NOT move this state: the
    // booking stays PAYMENT_PENDING and the passenger resubmits.
    PAYMENT_PENDING: ["CONFIRMED", "CANCELLED", "DISPUTED"],
    CONFIRMED: ["PICKUP_VERIFIED", "CANCELLED", "NO_SHOW", "DISPUTED"],
    PICKUP_VERIFIED: ["RENTAL_ACTIVE", "DISPUTED"],
    RENTAL_ACTIVE: ["RETURN_PENDING", "DISPUTED"],
    RETURN_PENDING: ["COMPLETED", "DISPUTED"],
    COMPLETED: [],
    CANCELLED: [],
    NO_SHOW: [],
    DISPUTED: [],
};

const TERMINAL_STATUSES = ["COMPLETED", "CANCELLED", "NO_SHOW", "DISPUTED"];

// Booking statuses that HOLD the vehicle for their window: an accepted
// hold, a payment in flight, and every live stage of a rental. Used by
// the overlap guard — a vehicle in one of these states for an
// overlapping window cannot be promised to anyone else.
const HOLDING_STATUSES = [
    "PROVIDER_ACCEPTED",
    "PAYMENT_PENDING",
    "CONFIRMED",
    "PICKUP_VERIFIED",
    "RENTAL_ACTIVE",
    "RETURN_PENDING",
];

function isValidStatus(status) {
    return RENTAL_STATUSES.includes(status);
}

function nextStatuses(status) {
    return [...(RENTAL_TRANSITIONS[status] || [])];
}

// `flags.feeVerified` gates the PAYMENT_PENDING -> CONFIRMED edge: the
// fee must have been VERIFIED (manual-payment admin verification in the
// pilot) before any booking confirms. `flags.otpVerified` gates the
// CONFIRMED -> PICKUP_VERIFIED edge: the handover can only be recorded
// against the passenger's pickup OTP (the hash check itself lives in
// the controller, which passes the outcome in here).
function canTransition(from, to, flags = {}) {
    if (!nextStatuses(from).includes(to)) {
        return false;
    }

    if (to === "CONFIRMED" && flags.feeVerified !== true) {
        return false;
    }

    if (to === "PICKUP_VERIFIED" && flags.otpVerified !== true) {
        return false;
    }

    return true;
}

// Whether a dispute may be raised from `status` (either party). Before
// acceptance there is nothing to dispute — the passenger simply
// cancels; terminal states are closed.
function canDispute(status) {
    return (
        !TERMINAL_STATUSES.includes(status) &&
        status !== "SEARCHING" &&
        status !== "REQUESTED"
    );
}

// What a cancel request means for a booking in `status`:
//   "CANCELLED" — safe to cancel (refund handled by resolveFeeRefund)
//   null        — cannot be cancelled from here (vehicle is out; the
//                 party must dispute, or the partner marks NO_SHOW)
function resolveCancelOutcome(status) {
    if (
        ["SEARCHING", "REQUESTED", "PROVIDER_ACCEPTED", "PAYMENT_PENDING", "CONFIRMED"].includes(status)
    ) {
        return "CANCELLED";
    }

    return null;
}

// ---------------------------------------------------------------------------
// Amounts — safe-integer PKR, mirroring the rest of the codebase.
// ---------------------------------------------------------------------------

function isValidAmount(value) {
    return Number.isSafeInteger(value) && value >= 1;
}

function isValidMoneyOrZero(value) {
    return Number.isSafeInteger(value) && value >= 0;
}

// ---------------------------------------------------------------------------
// Pricing — the rental charges for a window.
//
// The passenger picks a billing unit (HOURLY / DAILY / WEEKLY /
// MONTHLY); when they don't, the unit is derived from the window
// length, preferring the largest sensible unit the vehicle actually
// prices. Units are always rounded UP (a 25-hour rental bills 2 days)
// — the same figure is shown to the passenger before they confirm, so
// there are no surprises at the door.
// ---------------------------------------------------------------------------

const BILLING_UNITS = ["HOURLY", "DAILY", "WEEKLY", "MONTHLY"];

const UNIT_RATE_FIELD = {
    HOURLY: "hourly",
    DAILY: "daily",
    WEEKLY: "weekly",
    MONTHLY: "monthly",
};

function unitsForWindow(unit, startAt, endAt) {
    const ms = new Date(endAt) - new Date(startAt);

    if (!Number.isFinite(ms) || ms <= 0) return null;

    const hours = ms / (1000 * 60 * 60);

    switch (unit) {
        case "HOURLY":
            return Math.max(1, Math.ceil(hours));
        case "DAILY":
            return Math.max(1, Math.ceil(hours / 24));
        case "WEEKLY":
            return Math.max(1, Math.ceil(hours / 24 / 7));
        case "MONTHLY":
            return Math.max(1, Math.ceil(hours / 24 / 30));
        default:
            return null;
    }
}

function deriveBillingUnit(pricing, startAt, endAt) {
    const ms = new Date(endAt) - new Date(startAt);
    const hours = ms / (1000 * 60 * 60);
    const days = hours / 24;

    const has = (unit) => isValidAmount(pricing?.[UNIT_RATE_FIELD[unit]]);

    if (days >= 25 && has("MONTHLY")) return "MONTHLY";
    if (days >= 6 && has("WEEKLY")) return "WEEKLY";
    if ((hours > 20 || !has("HOURLY")) && has("DAILY")) return "DAILY";
    if (has("HOURLY")) return "HOURLY";
    if (has("DAILY")) return "DAILY";
    if (has("WEEKLY")) return "WEEKLY";
    if (has("MONTHLY")) return "MONTHLY";

    return null;
}

// Returns { ok: true, billingUnit, units, ratePerUnit, rentalCharges }
// or { ok: false, code, message }.
function computeRentalCharges({ pricing, startAt, endAt, billingUnit = null } = {}) {
    const start = new Date(startAt);
    const end = new Date(endAt);

    if (
        !Number.isFinite(start.getTime()) ||
        !Number.isFinite(end.getTime()) ||
        end <= start
    ) {
        return {
            ok: false,
            code: "INVALID_WINDOW",
            message: "Rental end must be after the start",
        };
    }

    let unit = billingUnit;

    if (unit !== null && !BILLING_UNITS.includes(unit)) {
        return {
            ok: false,
            code: "INVALID_BILLING_UNIT",
            message: "Invalid billing unit",
        };
    }

    if (!unit) {
        unit = deriveBillingUnit(pricing, start, end);
    }

    if (!unit) {
        return {
            ok: false,
            code: "NO_PRICING",
            message: "This vehicle has no pricing configured",
        };
    }

    const ratePerUnit = pricing?.[UNIT_RATE_FIELD[unit]];

    if (!isValidAmount(ratePerUnit)) {
        const unitLabel = {
            HOURLY: "hour",
            DAILY: "day",
            WEEKLY: "week",
            MONTHLY: "month",
        }[unit];

        return {
            ok: false,
            code: "UNIT_NOT_PRICED",
            message: `This vehicle is not priced per ${unitLabel}`,
        };
    }

    const units = unitsForWindow(unit, start, end);

    return {
        ok: true,
        billingUnit: unit,
        units,
        ratePerUnit,
        rentalCharges: ratePerUnit * units,
    };
}

// ---------------------------------------------------------------------------
// The three amounts — always separate, always recorded.
//   rentalCharges   — the partner's money for the rental itself.
//   bookingFee      — Safar's platform fee: feePercent of the RENTAL
//                     CHARGES ONLY (never of the deposit), paid by the
//                     customer, due before confirmation.
//   securityDeposit — refundable hold the partner collects at handover;
//                     nobody's revenue.
// ---------------------------------------------------------------------------
function computeBookingAmounts({ rentalCharges, securityDeposit = 0, feePercent } = {}) {
    if (!isValidAmount(rentalCharges)) {
        return {
            ok: false,
            code: "INVALID_AMOUNT",
            message: "Rental charges must be a positive whole number of PKR",
        };
    }

    if (!isValidMoneyOrZero(securityDeposit)) {
        return {
            ok: false,
            code: "INVALID_AMOUNT",
            message: "Security deposit must be a whole number of PKR (0 allowed)",
        };
    }

    if (
        typeof feePercent !== "number" ||
        !Number.isFinite(feePercent) ||
        feePercent < 0 ||
        feePercent > 100 ||
        // At most two decimal places, epsilon-tolerant.
        Math.abs(feePercent * 100 - Math.round(feePercent * 100)) > 1e-9
    ) {
        return {
            ok: false,
            code: "INVALID_FEE_PERCENT",
            message: "Booking fee percent must be between 0 and 100",
        };
    }

    const bookingFee = Math.round((rentalCharges * feePercent) / 100);

    return {
        ok: true,
        rentalCharges,
        bookingFee,
        bookingFeePercent: feePercent,
        securityDeposit,
        // What the customer pays the PLATFORM before confirmation.
        feeDueBeforeConfirmation: bookingFee,
        // Full economic size of the booking, for display only — the
        // three components stay separate in storage and in refunds.
        grandTotal: rentalCharges + bookingFee + securityDeposit,
    };
}

// ---------------------------------------------------------------------------
// Booking-fee refunds on cancellation.
//
// Fair, disclosed rules (Amir's plan §1/§7): fraud or provider failure
// ALWAYS refunds the fee in full — the customer did nothing wrong. A
// provider cancelling also refunds in full. A customer cancelling
// refunds per the listing's cancellation policy and how much notice
// they gave. Before the fee was ever verified paid there is nothing to
// refund (feePaid=false → amount 0, status NONE).
// ---------------------------------------------------------------------------

const CANCELLATION_POLICIES = ["FLEXIBLE", "MODERATE", "STRICT"];

// [minimum hours before pickup, refund percent] — first match wins.
const POLICY_REFUND_TIERS = {
    FLEXIBLE: [
        [24, 100],
        [6, 50],
        [0, 0],
    ],
    MODERATE: [
        [72, 100],
        [24, 50],
        [0, 0],
    ],
    STRICT: [
        [168, 50],
        [0, 0],
    ],
};

function resolveFeeRefund({
    policy = "MODERATE",
    cancelledBy,
    hoursBeforePickup = 0,
    providerFailure = false,
    bookingFee = 0,
    feeVerified = false,
} = {}) {
    if (!feeVerified || !isValidAmount(bookingFee)) {
        return { status: "NONE", percent: 0, amount: 0 };
    }

    // Provider-side failure (fraud, vehicle unavailable, provider
    // no-show) or the provider cancelling: full refund, always.
    if (providerFailure || cancelledBy === "PARTNER" || cancelledBy === "ADMIN") {
        return { status: "DUE", percent: 100, amount: bookingFee };
    }

    const tiers = POLICY_REFUND_TIERS[policy] || POLICY_REFUND_TIERS.MODERATE;
    const hours = Number.isFinite(hoursBeforePickup) ? hoursBeforePickup : 0;

    let percent = 0;

    for (const [minHours, tierPercent] of tiers) {
        if (hours >= minHours) {
            percent = tierPercent;
            break;
        }
    }

    const amount = Math.round((bookingFee * percent) / 100);

    return {
        status: amount > 0 ? "DUE" : "NONE",
        percent,
        amount,
    };
}

// ---------------------------------------------------------------------------
// Calendar — overlap + blocked dates + hold expiry.
// ---------------------------------------------------------------------------

// Half-open interval overlap: a return at 10:00 and a pickup at 10:00
// on the same vehicle do NOT collide.
function windowsOverlap(aStart, aEnd, bStart, bEnd) {
    const aS = new Date(aStart).getTime();
    const aE = new Date(aEnd).getTime();
    const bS = new Date(bStart).getTime();
    const bE = new Date(bEnd).getTime();

    if (![aS, aE, bS, bE].every(Number.isFinite) || aE <= aS || bE <= bS) {
        return false;
    }

    return aS < bE && bS < aE;
}

// The double-booking guard, shared by the accept + confirm paths and
// directly unit-tested: given the vehicle's existing bookings (plain
// objects with status/startAt/endAt/paymentDeadlineAt), is `window`
// still free? Expired payment holds (PAYMENT_PENDING past their
// deadline) no longer count — the inventory is released.
function findBlockingBooking(bookings, window, { now = new Date(), excludeBookingId = null } = {}) {
    for (const booking of bookings || []) {
        if (!HOLDING_STATUSES.includes(booking.status)) continue;

        if (
            excludeBookingId &&
            String(booking._id || booking.id || "") === String(excludeBookingId)
        ) {
            continue;
        }

        if (booking.status === "PAYMENT_PENDING" && isHoldExpired(booking, now)) {
            continue;
        }

        if (windowsOverlap(window.startAt, window.endAt, booking.startAt, booking.endAt)) {
            return booking;
        }
    }

    return null;
}

// A date key is a UTC "YYYY-MM-DD" string, matching how partners block
// days on the availability calendar.
function dateKey(date) {
    const d = new Date(date);
    return d.toISOString().slice(0, 10);
}

// Does the window touch any partner-blocked calendar day?
function windowTouchesBlockedDate(blockedDates, startAt, endAt) {
    if (!Array.isArray(blockedDates) || blockedDates.length === 0) {
        return false;
    }

    const blocked = new Set(blockedDates);
    const cursor = new Date(dateKey(startAt) + "T00:00:00.000Z");
    const last = new Date(dateKey(endAt) + "T00:00:00.000Z");

    while (cursor <= last) {
        if (blocked.has(dateKey(cursor))) return true;
        cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    return false;
}

// The payment hold expires at paymentDeadlineAt. Applies to the two
// pre-confirmation holding states; once CONFIRMED the fee is verified
// and there is no hold left to expire.
function isHoldExpired(booking, now = new Date()) {
    if (!booking || !["PROVIDER_ACCEPTED", "PAYMENT_PENDING"].includes(booking.status)) {
        return false;
    }

    if (!booking.paymentDeadlineAt) return false;

    return new Date(booking.paymentDeadlineAt) <= now;
}

// ---------------------------------------------------------------------------
// Mode eligibility — Self-Drive is ENABLED (Amir decision, Amir-test
// fix round T-19, superseding the Phase 8 launch gate). Callers pass
// selfDriveEnabled derived as "settings flag is not explicitly false",
// so the mode works by default; the SELF_DRIVE_DISABLED branch below
// now fires only when an admin has deliberately switched Self-Drive
// off (kill-switch). A self-drive renter must also present a valid
// driving licence (declared number + future expiry, checked here).
// ---------------------------------------------------------------------------
function evaluateModeEligibility({
    vehicle,
    mode,
    selfDriveEnabled = false,
    renterLicence = null,
    now = new Date(),
} = {}) {
    if (!vehicle || !["SELF_DRIVE", "WITH_DRIVER"].includes(mode)) {
        return { ok: false, code: "INVALID_MODE", message: "Invalid rental mode" };
    }

    const modes = Array.isArray(vehicle.rentalModes) ? vehicle.rentalModes : [];

    if (!modes.includes(mode)) {
        return {
            ok: false,
            code: "MODE_NOT_OFFERED",
            message: "This vehicle is not offered for that rental mode",
        };
    }

    if (mode === "WITH_DRIVER") {
        return { ok: true };
    }

    // SELF_DRIVE below.
    if (selfDriveEnabled !== true) {
        return {
            ok: false,
            code: "SELF_DRIVE_DISABLED",
            message: "Self-Drive rentals are not available yet",
        };
    }

    if (
        !renterLicence ||
        typeof renterLicence.number !== "string" ||
        !renterLicence.number.trim() ||
        !renterLicence.expiryDate ||
        new Date(renterLicence.expiryDate) <= now
    ) {
        return {
            ok: false,
            code: "LICENCE_REQUIRED",
            message: "A valid driving licence is required for Self-Drive rentals",
        };
    }

    return { ok: true };
}

// Chauffeur rule for With-Driver bookings: if the partner supplies the
// driver themselves, that chauffeur must be separately APPROVED. A
// partner who hires verified external chauffeurs is out of scope for
// the pilot; providesChauffeur=true is the platform-supplied case.
function evaluateChauffeurEligibility({ partner, mode } = {}) {
    if (mode !== "WITH_DRIVER") return { ok: true };

    if (partner?.providesChauffeur && partner.chauffeurVerificationStatus !== "APPROVED") {
        return {
            ok: false,
            code: "CHAUFFEUR_NOT_VERIFIED",
            message: "The partner's chauffeur is not verified for With-Driver rentals yet",
        };
    }

    return { ok: true };
}

// ---------------------------------------------------------------------------
// Return dues — computed from the two inspection records, never typed
// in as one opaque number: extra kilometres beyond the allowance and
// overtime beyond the agreed end, plus any other agreed dues lines.
// ---------------------------------------------------------------------------
function computeRemainingDues({
    startOdometerKm,
    returnOdometerKm,
    rentalDays = 1,
    mileageLimitKmPerDay = null,
    extraKmFee = 0,
    overtimeHours = 0,
    overtimeFeePerHour = 0,
    otherDues = 0,
} = {}) {
    const drivenKm =
        Number.isFinite(returnOdometerKm) && Number.isFinite(startOdometerKm)
            ? Math.max(0, returnOdometerKm - startOdometerKm)
            : 0;

    const allowanceKm =
        Number.isFinite(mileageLimitKmPerDay) && mileageLimitKmPerDay > 0
            ? mileageLimitKmPerDay * Math.max(1, rentalDays)
            : null;

    const extraKm =
        allowanceKm === null ? 0 : Math.max(0, Math.round(drivenKm) - allowanceKm);

    const extraKmCharges = extraKm * (isValidMoneyOrZero(extraKmFee) ? extraKmFee : 0);

    const overtime = Number.isFinite(overtimeHours) && overtimeHours > 0
        ? Math.ceil(overtimeHours)
        : 0;

    const overtimeCharges =
        overtime * (isValidMoneyOrZero(overtimeFeePerHour) ? overtimeFeePerHour : 0);

    const other = isValidMoneyOrZero(otherDues) ? otherDues : 0;

    return {
        drivenKm: Math.round(drivenKm),
        allowanceKm,
        extraKm,
        extraKmCharges,
        overtimeHours: overtime,
        overtimeCharges,
        otherDues: other,
        remainingDues: extraKmCharges + overtimeCharges + other,
    };
}

// ---------------------------------------------------------------------------
// Contact masking — THE anti-bypass serializer rule.
//
// A listing's exact pickup address and pickup contact live on the
// vehicle record, but serializers built on serializeRentalVehicle are
// the ONLY way listings/bookings are exposed, and they include the
// exact details solely when `unlocked` is true — which controllers set
// exclusively for parties to a CONFIRMED-or-later booking. The approx
// pickup AREA (a neighbourhood-level point + label) is always public.
// ---------------------------------------------------------------------------
function serializeRentalVehicle(vehicle, { unlocked = false } = {}) {
    if (!vehicle) return null;

    const v = typeof vehicle.toObject === "function" ? vehicle.toObject() : vehicle;

    const serialized = {
        id: v._id || v.id,
        rentalPartnerId: v.rentalPartnerId,
        brand: v.brand,
        model: v.model,
        year: v.year,
        transmission: v.transmission,
        hasAC: v.hasAC,
        seats: v.seats,
        photos: v.photos || { exterior: [], interior: [], condition: [] },
        rentalModes: v.rentalModes || [],
        pricing: v.pricing || {},
        mileageLimitKmPerDay: v.mileageLimitKmPerDay ?? null,
        extraKmFee: v.extraKmFee ?? 0,
        fuelPolicy: v.fuelPolicy || "",
        tollsNote: v.tollsNote || "",
        overtimeFeePerHour: v.overtimeFeePerHour ?? 0,
        securityDeposit: v.securityDeposit ?? 0,
        insuranceNote: v.insuranceNote || "",
        cancellationPolicy: v.cancellationPolicy || "MODERATE",
        pickupArea: v.pickupArea || null,
        pickupAreaLabel: v.pickupAreaLabel || "",
        listingStatus: v.listingStatus,
        blockedDates: v.blockedDates || [],
        isActive: v.isActive !== false,
        rating: v.rating ?? 0,
        ratingCount: v.ratingCount ?? 0,
        createdAt: v.createdAt,
        updatedAt: v.updatedAt,
        // Anti-bypass: exact handover details exist on the record but
        // are only ever serialized for a confirmed booking's parties.
        exactPickupAddress: null,
        pickupContactName: null,
        pickupContactPhone: null,
        contactUnlocked: false,
    };

    if (unlocked === true) {
        serialized.exactPickupAddress = v.exactPickupAddress || null;
        serialized.pickupContactName = v.pickupContactName || null;
        serialized.pickupContactPhone = v.pickupContactPhone || null;
        serialized.contactUnlocked = true;
    }

    return serialized;
}

// Should this viewer see the exact pickup details for this booking?
// Only the booking's own passenger and partner, and only once the
// booking is CONFIRMED or beyond (pickup, active rental, return,
// completed). Admins use their own serializers.
const CONTACT_UNLOCKED_STATUSES = [
    "CONFIRMED",
    "PICKUP_VERIFIED",
    "RENTAL_ACTIVE",
    "RETURN_PENDING",
    "COMPLETED",
];

function isContactUnlocked(booking) {
    return !!booking && CONTACT_UNLOCKED_STATUSES.includes(booking.status);
}

// ---------------------------------------------------------------------------
// Dispute resolution (Phase 7 — ADMIN only).
//
// DISPUTED stays terminal in RENTAL_TRANSITIONS above ON PURPOSE: no
// passenger/partner action may leave it. Resolution is a separate,
// admin-only outcome set defined HERE (never as ad-hoc status writes in
// a controller), applied by the admin controller through an atomic
// update still guarded on status === "DISPUTED":
//
//   COMPLETED — the rental is deemed fulfilled as it stands (any
//               return dues already recorded on the booking stay as
//               they are). The verified booking fee is platform revenue
//               and is never refunded on this outcome.
//   CANCELLED — the booking is voided. The booking-fee refund is
//               decided by the SAME resolveFeeRefund rules as an
//               ordinary cancellation, with the admin's fault finding
//               mapped onto `cancelledBy`: partner fault (or a
//               platform/no-fault void) refunds 100% of a verified fee;
//               passenger fault follows the listing's cancellation
//               policy tiers. A DUE refund is then paid out through the
//               existing admin mark-refunded action.
//   NO_SHOW   — the booking ends as a no-show; `fault` decides who
//               no-showed (partner fault -> PARTNER, anything else ->
//               PASSENGER). The verified fee is forfeited (the
//               anti-bypass design: the reservation was held).
// ---------------------------------------------------------------------------
const RENTAL_DISPUTE_OUTCOMES = ["COMPLETED", "CANCELLED", "NO_SHOW"];
const RENTAL_DISPUTE_FAULTS = ["PASSENGER", "PARTNER", "NONE"];

function evaluateRentalDisputeResolution({
    booking,
    outcome,
    fault = "NONE",
    policy = "MODERATE",
    now = new Date(),
} = {}) {
    if (!booking || booking.status !== "DISPUTED") {
        return {
            ok: false,
            code: "BOOKING_NOT_DISPUTED",
            message: "Only a disputed booking can be resolved",
        };
    }

    if (!RENTAL_DISPUTE_OUTCOMES.includes(outcome)) {
        return {
            ok: false,
            code: "INVALID_OUTCOME",
            message: "Dispute outcome must be COMPLETED, CANCELLED or NO_SHOW",
        };
    }

    if (!RENTAL_DISPUTE_FAULTS.includes(fault)) {
        return {
            ok: false,
            code: "INVALID_FAULT",
            message: "Fault must be PASSENGER, PARTNER or NONE",
        };
    }

    if (outcome === "COMPLETED") {
        return { ok: true, toStatus: "COMPLETED", feeRefund: null, noShowBy: null };
    }

    if (outcome === "NO_SHOW") {
        return {
            ok: true,
            toStatus: "NO_SHOW",
            feeRefund: null,
            noShowBy: fault === "PARTNER" ? "PARTNER" : "PASSENGER",
        };
    }

    // outcome === "CANCELLED" — refund decided by the ordinary
    // cancellation rules; the fault finding picks whose cancellation
    // this counts as. A no-fault/platform void is recorded as an ADMIN
    // cancellation, which resolveFeeRefund already refunds in full.
    const cancelledBy =
        fault === "PARTNER" ? "PARTNER" : fault === "PASSENGER" ? "PASSENGER" : "ADMIN";

    const startMs = new Date(booking.startAt || 0).getTime();
    const hoursBeforePickup = Number.isFinite(startMs)
        ? Math.max(0, (startMs - new Date(now).getTime()) / (1000 * 60 * 60))
        : 0;

    const feeRefund = resolveFeeRefund({
        policy,
        cancelledBy,
        hoursBeforePickup,
        providerFailure: fault === "PARTNER",
        bookingFee: booking.bookingFee || 0,
        feeVerified: booking.feePayment?.status === "VERIFIED",
    });

    return { ok: true, toStatus: "CANCELLED", feeRefund, noShowBy: null };
}

module.exports = {
    RENTAL_STATUSES,
    RENTAL_DISPUTE_OUTCOMES,
    RENTAL_DISPUTE_FAULTS,
    evaluateRentalDisputeResolution,
    RENTAL_TRANSITIONS,
    TERMINAL_STATUSES,
    HOLDING_STATUSES,
    isValidStatus,
    nextStatuses,
    canTransition,
    canDispute,
    resolveCancelOutcome,
    isValidAmount,
    isValidMoneyOrZero,
    BILLING_UNITS,
    unitsForWindow,
    deriveBillingUnit,
    computeRentalCharges,
    computeBookingAmounts,
    CANCELLATION_POLICIES,
    POLICY_REFUND_TIERS,
    resolveFeeRefund,
    windowsOverlap,
    findBlockingBooking,
    dateKey,
    windowTouchesBlockedDate,
    isHoldExpired,
    evaluateModeEligibility,
    evaluateChauffeurEligibility,
    computeRemainingDues,
    serializeRentalVehicle,
    isContactUnlocked,
    CONTACT_UNLOCKED_STATUSES,
};
