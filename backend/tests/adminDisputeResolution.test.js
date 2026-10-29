// Phase 7 — Admin dispute-resolution rule tests (plain node, no test
// framework, no DB).
//
// Dispute resolution is an ADMIN-only outcome set that lives BESIDE the
// operational state machines: DISPUTED stays terminal in
// PURCHASE_TRANSITIONS / RENTAL_TRANSITIONS (asserted below, mirroring
// the Phase 4/5 suites), and the only sanctioned way out is the pure
// evaluators exercised here —
// services/purchaseOrderService.evaluatePurchaseDisputeResolution and
// services/rentalBookingService.evaluateRentalDisputeResolution —
// which the admin controllers apply through status-guarded updates.
//
// Run:  node tests/adminDisputeResolution.test.js
// Exit code 0 = all passed, 1 = at least one failure.

const assert = require("node:assert");

const {
    nextStatuses: purchaseNextStatuses,
    evaluatePurchaseDisputeResolution,
    PURCHASE_DISPUTE_OUTCOMES,
} = require("../src/services/purchaseOrderService");

const {
    nextStatuses: rentalNextStatuses,
    evaluateRentalDisputeResolution,
    RENTAL_DISPUTE_OUTCOMES,
} = require("../src/services/rentalBookingService");

const tests = [];
function test(name, fn) {
    tests.push({ name, fn });
}

// --------------------------------------------------------------------
// The operational machines are untouched: DISPUTED remains terminal
// --------------------------------------------------------------------

test("DISPUTED stays terminal in both operational machines", () => {
    assert.deepStrictEqual(purchaseNextStatuses("DISPUTED"), []);
    assert.deepStrictEqual(rentalNextStatuses("DISPUTED"), []);
    assert.deepStrictEqual(PURCHASE_DISPUTE_OUTCOMES, ["COMPLETED", "CANCELLED"]);
    assert.deepStrictEqual(RENTAL_DISPUTE_OUTCOMES, ["COMPLETED", "CANCELLED", "NO_SHOW"]);
});

// --------------------------------------------------------------------
// Purchase orders
// --------------------------------------------------------------------

function disputedPurchase(overrides = {}) {
    return {
        status: "DISPUTED",
        actualCost: 1800,
        deliveryFee: 300,
        customerTotalPayable: 2100,
        reimbursementReceived: 0,
        ...overrides,
    };
}

test("purchase: only a DISPUTED order can be resolved", () => {
    for (const status of ["SHOPPING", "DELIVERED", "COMPLETED", "CANCELLED"]) {
        const result = evaluatePurchaseDisputeResolution({
            order: disputedPurchase({ status }),
            outcome: "CANCELLED",
        });
        assert.strictEqual(result.ok, false, status);
        assert.strictEqual(result.code, "ORDER_NOT_DISPUTED", status);
    }
});

test("purchase: unknown outcomes are rejected", () => {
    const result = evaluatePurchaseDisputeResolution({
        order: disputedPurchase(),
        outcome: "FAILED",
    });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.code, "INVALID_OUTCOME");
});

test("purchase: COMPLETED requires a recorded purchase to settle", () => {
    const result = evaluatePurchaseDisputeResolution({
        order: disputedPurchase({
            actualCost: null,
            deliveryFee: null,
            customerTotalPayable: null,
        }),
        outcome: "COMPLETED",
    });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.code, "NOTHING_TO_SETTLE");
});

test("purchase: COMPLETED succeeds when the ledger is already fully paid", () => {
    const result = evaluatePurchaseDisputeResolution({
        order: disputedPurchase({ reimbursementReceived: 2100 }),
        outcome: "COMPLETED",
    });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.toStatus, "COMPLETED");
    assert.strictEqual(result.ledger.unpaidAmount, 0);
    assert.strictEqual(result.ledger.fullyPaid, true);
});

test("purchase: COMPLETED applies the admin-recorded payment to the ledger", () => {
    const result = evaluatePurchaseDisputeResolution({
        order: disputedPurchase({ reimbursementReceived: 1500 }),
        outcome: "COMPLETED",
        paymentAmount: 600,
    });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.ledger.reimbursementReceived, 2100);
    assert.strictEqual(result.ledger.unpaidAmount, 0);
});

test("purchase: COMPLETED is refused while money is still unpaid", () => {
    const result = evaluatePurchaseDisputeResolution({
        order: disputedPurchase({ reimbursementReceived: 1500 }),
        outcome: "COMPLETED",
        paymentAmount: 100,
    });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.code, "ORDER_NOT_FULLY_PAID");
    assert.strictEqual(result.ledger.unpaidAmount, 500);
});

test("purchase: CANCELLED voids the order and carries no ledger change", () => {
    const result = evaluatePurchaseDisputeResolution({
        order: disputedPurchase(),
        outcome: "CANCELLED",
    });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.toStatus, "CANCELLED");
    assert.strictEqual(result.ledger, null);
});

test("purchase: a payment cannot ride along with a CANCELLED outcome", () => {
    const result = evaluatePurchaseDisputeResolution({
        order: disputedPurchase(),
        outcome: "CANCELLED",
        paymentAmount: 500,
    });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.code, "PAYMENT_WITH_CANCELLATION");
});

test("purchase: malformed payment amounts are rejected", () => {
    for (const paymentAmount of [-5, 10.5, Number.NaN]) {
        const result = evaluatePurchaseDisputeResolution({
            order: disputedPurchase({ reimbursementReceived: 2100 }),
            outcome: "COMPLETED",
            paymentAmount,
        });
        assert.strictEqual(result.ok, false, String(paymentAmount));
        assert.strictEqual(result.code, "INVALID_AMOUNT", String(paymentAmount));
    }
});

// --------------------------------------------------------------------
// Rental bookings
// --------------------------------------------------------------------

const NOW = new Date("2026-10-29T12:00:00Z");
const inHours = (hours) => new Date(NOW.getTime() + hours * 60 * 60 * 1000);

function disputedRental(overrides = {}) {
    return {
        status: "DISPUTED",
        bookingFee: 800,
        feePayment: { status: "VERIFIED" },
        startAt: inHours(48),
        ...overrides,
    };
}

test("rental: only a DISPUTED booking can be resolved", () => {
    for (const status of ["CONFIRMED", "RENTAL_ACTIVE", "COMPLETED"]) {
        const result = evaluateRentalDisputeResolution({
            booking: disputedRental({ status }),
            outcome: "CANCELLED",
            now: NOW,
        });
        assert.strictEqual(result.ok, false, status);
        assert.strictEqual(result.code, "BOOKING_NOT_DISPUTED", status);
    }
});

test("rental: unknown outcomes and faults are rejected", () => {
    assert.strictEqual(
        evaluateRentalDisputeResolution({
            booking: disputedRental(),
            outcome: "FAILED",
            now: NOW,
        }).code,
        "INVALID_OUTCOME"
    );
    assert.strictEqual(
        evaluateRentalDisputeResolution({
            booking: disputedRental(),
            outcome: "CANCELLED",
            fault: "PLATFORM",
            now: NOW,
        }).code,
        "INVALID_FAULT"
    );
});

test("rental: COMPLETED keeps the verified fee and decides no refund", () => {
    const result = evaluateRentalDisputeResolution({
        booking: disputedRental(),
        outcome: "COMPLETED",
        fault: "PASSENGER",
        now: NOW,
    });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.toStatus, "COMPLETED");
    assert.strictEqual(result.feeRefund, null);
});

test("rental: partner-fault CANCELLED refunds a verified fee in full", () => {
    const result = evaluateRentalDisputeResolution({
        booking: disputedRental(),
        outcome: "CANCELLED",
        fault: "PARTNER",
        policy: "STRICT",
        now: NOW,
    });
    assert.strictEqual(result.ok, true);
    assert.deepStrictEqual(result.feeRefund, {
        status: "DUE",
        percent: 100,
        amount: 800,
    });
});

test("rental: no-fault CANCELLED is a platform void — full refund", () => {
    const result = evaluateRentalDisputeResolution({
        booking: disputedRental(),
        outcome: "CANCELLED",
        fault: "NONE",
        policy: "STRICT",
        now: NOW,
    });
    assert.strictEqual(result.ok, true);
    assert.deepStrictEqual(result.feeRefund, {
        status: "DUE",
        percent: 100,
        amount: 800,
    });
});

test("rental: passenger-fault CANCELLED follows the listing policy tiers", () => {
    // MODERATE at 48h before pickup -> 50% tier.
    const result = evaluateRentalDisputeResolution({
        booking: disputedRental(),
        outcome: "CANCELLED",
        fault: "PASSENGER",
        policy: "MODERATE",
        now: NOW,
    });
    assert.strictEqual(result.ok, true);
    assert.deepStrictEqual(result.feeRefund, {
        status: "DUE",
        percent: 50,
        amount: 400,
    });
});

test("rental: an unverified fee is never refundable, whatever the fault", () => {
    const result = evaluateRentalDisputeResolution({
        booking: disputedRental({ feePayment: { status: "SUBMITTED" } }),
        outcome: "CANCELLED",
        fault: "PARTNER",
        now: NOW,
    });
    assert.strictEqual(result.ok, true);
    assert.deepStrictEqual(result.feeRefund, {
        status: "NONE",
        percent: 0,
        amount: 0,
    });
});

test("rental: NO_SHOW records the party at fault and forfeits the fee", () => {
    const partnerFault = evaluateRentalDisputeResolution({
        booking: disputedRental(),
        outcome: "NO_SHOW",
        fault: "PARTNER",
        now: NOW,
    });
    assert.strictEqual(partnerFault.ok, true);
    assert.strictEqual(partnerFault.toStatus, "NO_SHOW");
    assert.strictEqual(partnerFault.noShowBy, "PARTNER");
    assert.strictEqual(partnerFault.feeRefund, null);

    const passengerFault = evaluateRentalDisputeResolution({
        booking: disputedRental(),
        outcome: "NO_SHOW",
        fault: "PASSENGER",
        now: NOW,
    });
    assert.strictEqual(passengerFault.noShowBy, "PASSENGER");
});

// ---------------------------------------------------------------------

(async () => {
    let passed = 0;
    const failures = [];

    for (const { name, fn } of tests) {
        try {
            await fn();
            passed += 1;
            console.log(`  PASS  ${name}`);
        } catch (error) {
            failures.push({ name, error });
            console.log(`  FAIL  ${name}`);
            console.log(`        ${error.message.split("\n")[0]}`);
        }
    }

    console.log(
        `\n${passed}/${tests.length} tests passed` +
            (failures.length ? ` — ${failures.length} FAILED` : "")
    );

    process.exitCode = failures.length ? 1 : 0;
})();
