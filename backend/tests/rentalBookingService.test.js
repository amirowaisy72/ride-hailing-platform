// Phase 5 — Safar Rentals domain-rule tests (plain node, no test
// framework, no DB).
//
// services/rentalBookingService.js is pure by design, so these tests
// exercise the REAL production state machine, money math, calendar
// guard and masking rules against plain-object fixtures without
// MongoDB — the same approach as tests/purchaseOrderService.test.js.
//
// Run:  node tests/rentalBookingService.test.js
// Exit code 0 = all passed, 1 = at least one failure.

const assert = require("node:assert");

const {
    RENTAL_STATUSES,
    canTransition,
    nextStatuses,
    canDispute,
    resolveCancelOutcome,
    computeRentalCharges,
    computeBookingAmounts,
    resolveFeeRefund,
    windowsOverlap,
    findBlockingBooking,
    windowTouchesBlockedDate,
    isHoldExpired,
    evaluateModeEligibility,
    evaluateChauffeurEligibility,
    computeRemainingDues,
    serializeRentalVehicle,
    isContactUnlocked,
} = require("../src/services/rentalBookingService");

const tests = [];
function test(name, fn) {
    tests.push({ name, fn });
}

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const T0 = new Date("2026-11-10T09:00:00.000Z");

// ---------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------

test("happy-path lifecycle is walkable end to end", () => {
    const path = [
        "SEARCHING",
        "REQUESTED",
        "PROVIDER_ACCEPTED",
        "PAYMENT_PENDING",
        "CONFIRMED",
        "PICKUP_VERIFIED",
        "RENTAL_ACTIVE",
        "RETURN_PENDING",
        "COMPLETED",
    ];

    for (let i = 0; i < path.length - 1; i += 1) {
        const to = path[i + 1];
        const flags = {};

        if (to === "CONFIRMED") flags.feeVerified = true;
        if (to === "PICKUP_VERIFIED") flags.otpVerified = true;

        assert.strictEqual(
            canTransition(path[i], to, flags),
            true,
            `${path[i]} -> ${to} should be allowed`
        );
    }
});

test("illegal skips are rejected", () => {
    assert.strictEqual(canTransition("REQUESTED", "CONFIRMED", { feeVerified: true }), false);
    assert.strictEqual(canTransition("REQUESTED", "RENTAL_ACTIVE"), false);
    assert.strictEqual(canTransition("PROVIDER_ACCEPTED", "CONFIRMED", { feeVerified: true }), false);
    assert.strictEqual(canTransition("CONFIRMED", "COMPLETED"), false);
    assert.strictEqual(canTransition("RENTAL_ACTIVE", "COMPLETED"), false);
    assert.strictEqual(canTransition("PAYMENT_PENDING", "PICKUP_VERIFIED", { otpVerified: true }), false);
});

test("terminal states have no outgoing transitions", () => {
    for (const status of ["COMPLETED", "CANCELLED", "NO_SHOW", "DISPUTED"]) {
        assert.deepStrictEqual(nextStatuses(status), []);
    }
});

test("CONFIRMED is impossible without a VERIFIED fee payment", () => {
    assert.strictEqual(canTransition("PAYMENT_PENDING", "CONFIRMED"), false);
    assert.strictEqual(canTransition("PAYMENT_PENDING", "CONFIRMED", {}), false);
    assert.strictEqual(canTransition("PAYMENT_PENDING", "CONFIRMED", { feeVerified: false }), false);
    assert.strictEqual(canTransition("PAYMENT_PENDING", "CONFIRMED", { feeVerified: true }), true);
});

test("pickup verification is gated on the OTP", () => {
    assert.strictEqual(canTransition("CONFIRMED", "PICKUP_VERIFIED"), false);
    assert.strictEqual(canTransition("CONFIRMED", "PICKUP_VERIFIED", { otpVerified: true }), true);
});

test("cancel is only possible before the vehicle goes out", () => {
    for (const s of ["REQUESTED", "PROVIDER_ACCEPTED", "PAYMENT_PENDING", "CONFIRMED"]) {
        assert.strictEqual(resolveCancelOutcome(s), "CANCELLED", s);
    }
    for (const s of ["PICKUP_VERIFIED", "RENTAL_ACTIVE", "RETURN_PENDING", "COMPLETED"]) {
        assert.strictEqual(resolveCancelOutcome(s), null, s);
    }
});

test("disputes need an assigned, non-terminal booking", () => {
    assert.strictEqual(canDispute("REQUESTED"), false);
    assert.strictEqual(canDispute("CONFIRMED"), true);
    assert.strictEqual(canDispute("RENTAL_ACTIVE"), true);
    assert.strictEqual(canDispute("COMPLETED"), false);
    assert.strictEqual(canDispute("CANCELLED"), false);
});

test("all declared statuses exist in the machine", () => {
    for (const status of RENTAL_STATUSES) {
        assert.ok(Array.isArray(nextStatuses(status)), status);
    }
});

// ---------------------------------------------------------------------
// Pricing + the three amounts
// ---------------------------------------------------------------------

const PRICING = { hourly: 1500, daily: 8000, weekly: 45000, monthly: 150000 };

test("rental charges: daily rate, 2-day window", () => {
    const result = computeRentalCharges({
        pricing: PRICING,
        startAt: T0,
        endAt: new Date(T0.getTime() + 2 * DAY),
        billingUnit: "DAILY",
    });

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.units, 2);
    assert.strictEqual(result.rentalCharges, 16000);
});

test("rental charges: partial units round UP", () => {
    const result = computeRentalCharges({
        pricing: PRICING,
        startAt: T0,
        endAt: new Date(T0.getTime() + 25 * HOUR),
        billingUnit: "DAILY",
    });

    assert.strictEqual(result.units, 2);
    assert.strictEqual(result.rentalCharges, 16000);
});

test("rental charges: unit is derived when not chosen", () => {
    const twoDays = computeRentalCharges({
        pricing: PRICING,
        startAt: T0,
        endAt: new Date(T0.getTime() + 2 * DAY),
    });
    assert.strictEqual(twoDays.billingUnit, "DAILY");

    const threeHours = computeRentalCharges({
        pricing: PRICING,
        startAt: T0,
        endAt: new Date(T0.getTime() + 3 * HOUR),
    });
    assert.strictEqual(threeHours.billingUnit, "HOURLY");
    assert.strictEqual(threeHours.rentalCharges, 4500);
});

test("rental charges: invalid window and unpriced unit fail cleanly", () => {
    assert.strictEqual(
        computeRentalCharges({ pricing: PRICING, startAt: T0, endAt: T0 }).ok,
        false
    );
    assert.strictEqual(
        computeRentalCharges({
            pricing: { daily: 8000 },
            startAt: T0,
            endAt: new Date(T0.getTime() + 3 * HOUR),
            billingUnit: "HOURLY",
        }).ok,
        false
    );
});

test("booking fee is a % of the RENTAL CHARGES only — never the deposit", () => {
    // Amir's worked example: PKR 8,000/day x 2 days, 5% fee.
    const amounts = computeBookingAmounts({
        rentalCharges: 16000,
        securityDeposit: 50000,
        feePercent: 5,
    });

    assert.strictEqual(amounts.ok, true);
    assert.strictEqual(amounts.bookingFee, 800);
    assert.strictEqual(amounts.rentalCharges, 16000);
    assert.strictEqual(amounts.securityDeposit, 50000);
    assert.strictEqual(amounts.feeDueBeforeConfirmation, 800);
    assert.strictEqual(amounts.grandTotal, 16000 + 800 + 50000);
});

test("zero-fee configuration and zero deposit are valid", () => {
    const amounts = computeBookingAmounts({
        rentalCharges: 8000,
        securityDeposit: 0,
        feePercent: 0,
    });

    assert.strictEqual(amounts.ok, true);
    assert.strictEqual(amounts.bookingFee, 0);
});

test("invalid amounts are rejected", () => {
    assert.strictEqual(computeBookingAmounts({ rentalCharges: 0, feePercent: 5 }).ok, false);
    assert.strictEqual(computeBookingAmounts({ rentalCharges: 8000, securityDeposit: -1, feePercent: 5 }).ok, false);
    assert.strictEqual(computeBookingAmounts({ rentalCharges: 8000, feePercent: 101 }).ok, false);
});

// ---------------------------------------------------------------------
// Fee refunds — the fairness matrix
// ---------------------------------------------------------------------

test("refund: nothing was verified paid -> nothing to refund", () => {
    const refund = resolveFeeRefund({
        policy: "FLEXIBLE",
        cancelledBy: "PASSENGER",
        hoursBeforePickup: 100,
        bookingFee: 800,
        feeVerified: false,
    });

    assert.deepStrictEqual(refund, { status: "NONE", percent: 0, amount: 0 });
});

test("refund: provider failure ALWAYS refunds in full, any policy", () => {
    for (const policy of ["FLEXIBLE", "MODERATE", "STRICT"]) {
        const refund = resolveFeeRefund({
            policy,
            cancelledBy: "PASSENGER",
            hoursBeforePickup: 0,
            providerFailure: true,
            bookingFee: 800,
            feeVerified: true,
        });

        assert.strictEqual(refund.amount, 800, policy);
        assert.strictEqual(refund.status, "DUE", policy);
    }
});

test("refund: provider cancelling refunds in full", () => {
    const refund = resolveFeeRefund({
        policy: "STRICT",
        cancelledBy: "PARTNER",
        hoursBeforePickup: 1,
        bookingFee: 800,
        feeVerified: true,
    });

    assert.strictEqual(refund.amount, 800);
});

test("refund: FLEXIBLE tiers for passenger cancellations", () => {
    const base = { policy: "FLEXIBLE", cancelledBy: "PASSENGER", bookingFee: 800, feeVerified: true };

    assert.strictEqual(resolveFeeRefund({ ...base, hoursBeforePickup: 48 }).amount, 800);
    assert.strictEqual(resolveFeeRefund({ ...base, hoursBeforePickup: 12 }).amount, 400);
    assert.strictEqual(resolveFeeRefund({ ...base, hoursBeforePickup: 2 }).amount, 0);
});

test("refund: MODERATE and STRICT tiers for passenger cancellations", () => {
    const moderate = { policy: "MODERATE", cancelledBy: "PASSENGER", bookingFee: 800, feeVerified: true };
    assert.strictEqual(resolveFeeRefund({ ...moderate, hoursBeforePickup: 100 }).amount, 800);
    assert.strictEqual(resolveFeeRefund({ ...moderate, hoursBeforePickup: 48 }).amount, 400);
    assert.strictEqual(resolveFeeRefund({ ...moderate, hoursBeforePickup: 12 }).amount, 0);

    const strict = { policy: "STRICT", cancelledBy: "PASSENGER", bookingFee: 800, feeVerified: true };
    assert.strictEqual(resolveFeeRefund({ ...strict, hoursBeforePickup: 200 }).amount, 400);
    assert.strictEqual(resolveFeeRefund({ ...strict, hoursBeforePickup: 100 }).amount, 0);
});

// ---------------------------------------------------------------------
// Calendar — overlap, blocked dates, hold expiry
// ---------------------------------------------------------------------

test("windowsOverlap: half-open semantics", () => {
    const a = { start: T0, end: new Date(T0.getTime() + 2 * DAY) };

    // Touching at the boundary does NOT overlap.
    assert.strictEqual(
        windowsOverlap(a.start, a.end, a.end, new Date(a.end.getTime() + DAY)),
        false
    );
    // One hour of real overlap DOES.
    assert.strictEqual(
        windowsOverlap(
            a.start, a.end,
            new Date(a.end.getTime() - HOUR), new Date(a.end.getTime() + DAY)
        ),
        true
    );
    // Fully inside.
    assert.strictEqual(
        windowsOverlap(a.start, a.end, new Date(T0.getTime() + HOUR), new Date(T0.getTime() + 2 * HOUR)),
        true
    );
});

test("double-booking: a CONFIRMED booking blocks an overlapping window", () => {
    const existing = [{
        _id: "b1",
        status: "CONFIRMED",
        startAt: T0,
        endAt: new Date(T0.getTime() + 2 * DAY),
    }];

    const blocker = findBlockingBooking(existing, {
        startAt: new Date(T0.getTime() + DAY),
        endAt: new Date(T0.getTime() + 3 * DAY),
    });

    assert.strictEqual(blocker?._id, "b1");
});

test("double-booking: a booking does not block itself, cancelled ones never block", () => {
    const existing = [
        { _id: "b1", status: "CONFIRMED", startAt: T0, endAt: new Date(T0.getTime() + 2 * DAY) },
        { _id: "b2", status: "CANCELLED", startAt: T0, endAt: new Date(T0.getTime() + 2 * DAY) },
    ];

    assert.strictEqual(
        findBlockingBooking(existing, { startAt: T0, endAt: new Date(T0.getTime() + DAY) }, { excludeBookingId: "b1" }),
        null
    );
});

test("hold expiry releases the vehicle", () => {
    const now = new Date(T0.getTime() + 10 * DAY);
    const expiredHold = {
        _id: "b1",
        status: "PAYMENT_PENDING",
        startAt: new Date(T0.getTime() + 12 * DAY),
        endAt: new Date(T0.getTime() + 13 * DAY),
        paymentDeadlineAt: new Date(T0.getTime() + 9 * DAY),
    };

    assert.strictEqual(isHoldExpired(expiredHold, now), true);
    assert.strictEqual(
        findBlockingBooking([expiredHold], {
            startAt: expiredHold.startAt,
            endAt: expiredHold.endAt,
        }, { now }),
        null
    );

    // A hold still inside its deadline DOES block.
    const liveHold = { ...expiredHold, paymentDeadlineAt: new Date(T0.getTime() + 11 * DAY) };
    assert.strictEqual(isHoldExpired(liveHold, now), false);
    assert.strictEqual(
        findBlockingBooking([liveHold], {
            startAt: liveHold.startAt,
            endAt: liveHold.endAt,
        }, { now })?._id,
        "b1"
    );

    // CONFIRMED bookings have no expiring hold.
    assert.strictEqual(isHoldExpired({ status: "CONFIRMED", paymentDeadlineAt: new Date(0) }, now), false);
});

test("partner-blocked dates make a window unavailable", () => {
    assert.strictEqual(
        windowTouchesBlockedDate(["2026-11-11"], T0, new Date(T0.getTime() + 2 * DAY)),
        true
    );
    assert.strictEqual(
        windowTouchesBlockedDate(["2026-11-20"], T0, new Date(T0.getTime() + 2 * DAY)),
        false
    );
    assert.strictEqual(windowTouchesBlockedDate([], T0, new Date(T0.getTime() + 2 * DAY)), false);
});

// ---------------------------------------------------------------------
// Modes — the launch gate
// ---------------------------------------------------------------------

const VEHICLE_BOTH = { rentalModes: ["SELF_DRIVE", "WITH_DRIVER"] };
const LICENCE = { number: "KPK-12345", expiryDate: new Date(T0.getTime() + 365 * DAY) };

test("self-drive is blocked while the admin flag is OFF, however the vehicle is set", () => {
    const result = evaluateModeEligibility({
        vehicle: VEHICLE_BOTH,
        mode: "SELF_DRIVE",
        selfDriveEnabled: false,
        renterLicence: LICENCE,
        now: T0,
    });

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.code, "SELF_DRIVE_DISABLED");
});

test("with-driver is allowed while the self-drive flag is OFF", () => {
    const result = evaluateModeEligibility({
        vehicle: VEHICLE_BOTH,
        mode: "WITH_DRIVER",
        selfDriveEnabled: false,
        now: T0,
    });

    assert.strictEqual(result.ok, true);
});

test("self-drive needs the flag AND a valid licence AND the mode offered", () => {
    assert.strictEqual(
        evaluateModeEligibility({
            vehicle: VEHICLE_BOTH, mode: "SELF_DRIVE",
            selfDriveEnabled: true, renterLicence: LICENCE, now: T0,
        }).ok,
        true
    );
    assert.strictEqual(
        evaluateModeEligibility({
            vehicle: VEHICLE_BOTH, mode: "SELF_DRIVE",
            selfDriveEnabled: true, renterLicence: null, now: T0,
        }).code,
        "LICENCE_REQUIRED"
    );
    assert.strictEqual(
        evaluateModeEligibility({
            vehicle: VEHICLE_BOTH, mode: "SELF_DRIVE",
            selfDriveEnabled: true,
            renterLicence: { number: "X", expiryDate: new Date(T0.getTime() - DAY) },
            now: T0,
        }).code,
        "LICENCE_REQUIRED"
    );
    assert.strictEqual(
        evaluateModeEligibility({
            vehicle: { rentalModes: ["WITH_DRIVER"] }, mode: "SELF_DRIVE",
            selfDriveEnabled: true, renterLicence: LICENCE, now: T0,
        }).code,
        "MODE_NOT_OFFERED"
    );
});

test("with-driver via an unverified partner chauffeur is blocked", () => {
    assert.strictEqual(
        evaluateChauffeurEligibility({
            partner: { providesChauffeur: true, chauffeurVerificationStatus: "PENDING" },
            mode: "WITH_DRIVER",
        }).ok,
        false
    );
    assert.strictEqual(
        evaluateChauffeurEligibility({
            partner: { providesChauffeur: true, chauffeurVerificationStatus: "APPROVED" },
            mode: "WITH_DRIVER",
        }).ok,
        true
    );
});

// ---------------------------------------------------------------------
// Masking — the anti-bypass serializer
// ---------------------------------------------------------------------

const LISTING = {
    _id: "v1",
    rentalPartnerId: "p1",
    brand: "Toyota",
    model: "Corolla",
    year: 2022,
    transmission: "AUTOMATIC",
    hasAC: true,
    seats: 5,
    photos: { exterior: ["a.jpg"], interior: [], condition: [] },
    rentalModes: ["WITH_DRIVER"],
    pricing: { daily: 8000 },
    securityDeposit: 50000,
    cancellationPolicy: "MODERATE",
    pickupArea: { type: "Point", coordinates: [71.4, 34.0] },
    pickupAreaLabel: "Charsadda Road",
    exactPickupAddress: "House 12, Street 3, Secret Lane",
    pickupContactName: "Partner Owner",
    pickupContactPhone: "0300-0000000",
    listingStatus: "APPROVED",
    blockedDates: [],
    isActive: true,
};

test("masking: browsing NEVER exposes the exact address or contact", () => {
    const view = serializeRentalVehicle(LISTING);

    assert.strictEqual(view.exactPickupAddress, null);
    assert.strictEqual(view.pickupContactPhone, null);
    assert.strictEqual(view.pickupContactName, null);
    assert.strictEqual(view.contactUnlocked, false);
    // The approximate area stays public.
    assert.strictEqual(view.pickupAreaLabel, "Charsadda Road");
    assert.ok(!JSON.stringify(view).includes("Secret Lane"));
    assert.ok(!JSON.stringify(view).includes("0300-0000000"));
});

test("masking: exact details unlock only from CONFIRMED onward", () => {
    for (const status of ["REQUESTED", "PROVIDER_ACCEPTED", "PAYMENT_PENDING"]) {
        assert.strictEqual(isContactUnlocked({ status }), false, status);
    }
    for (const status of ["CONFIRMED", "PICKUP_VERIFIED", "RENTAL_ACTIVE", "RETURN_PENDING", "COMPLETED"]) {
        assert.strictEqual(isContactUnlocked({ status }), true, status);
    }

    const unlocked = serializeRentalVehicle(LISTING, { unlocked: true });
    assert.strictEqual(unlocked.exactPickupAddress, "House 12, Street 3, Secret Lane");
    assert.strictEqual(unlocked.pickupContactPhone, "0300-0000000");
    assert.strictEqual(unlocked.contactUnlocked, true);
});

// ---------------------------------------------------------------------
// Return dues
// ---------------------------------------------------------------------

test("remaining dues are computed from inspections, not typed in", () => {
    const dues = computeRemainingDues({
        startOdometerKm: 10000,
        returnOdometerKm: 10350,
        rentalDays: 2,
        mileageLimitKmPerDay: 100,
        extraKmFee: 50,
        overtimeHours: 2.2,
        overtimeFeePerHour: 500,
        otherDues: 0,
    });

    assert.strictEqual(dues.drivenKm, 350);
    assert.strictEqual(dues.allowanceKm, 200);
    assert.strictEqual(dues.extraKm, 150);
    assert.strictEqual(dues.extraKmCharges, 7500);
    assert.strictEqual(dues.overtimeHours, 3);
    assert.strictEqual(dues.overtimeCharges, 1500);
    assert.strictEqual(dues.remainingDues, 9000);
});

test("no mileage limit means no extra-km dues", () => {
    const dues = computeRemainingDues({
        startOdometerKm: 10000,
        returnOdometerKm: 10999,
        rentalDays: 2,
        mileageLimitKmPerDay: null,
        extraKmFee: 50,
    });

    assert.strictEqual(dues.extraKm, 0);
    assert.strictEqual(dues.remainingDues, 0);
});

// ---------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------

let failures = 0;

for (const { name, fn } of tests) {
    try {
        fn();
        console.log(`ok   - ${name}`);
    } catch (error) {
        failures += 1;
        console.error(`FAIL - ${name}`);
        console.error(`       ${error.message}`);
    }
}

console.log(`\n${tests.length - failures}/${tests.length} tests passed`);

process.exit(failures ? 1 : 0);
