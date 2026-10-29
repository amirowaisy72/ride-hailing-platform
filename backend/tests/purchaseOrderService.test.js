// Phase 4 — Buy & Deliver domain-rule tests (plain node, no test
// framework, no DB).
//
// services/purchaseOrderService.js is pure by design, so these tests
// exercise the REAL production state machine and financial rules
// against plain-object fixtures without MongoDB — the same approach as
// tests/eligibilityService.test.js.
//
// Run:  node tests/purchaseOrderService.test.js
// Exit code 0 = all passed, 1 = at least one failure.

const assert = require("node:assert");

const {
    PURCHASE_STATUSES,
    canTransition,
    nextStatuses,
    resolveCancelOutcome,
    canDispute,
    checkAmountWithinCaps,
    checkPurchaseWithinApproval,
    computeTotals,
    applyPayment,
    computePurchaseCommission,
    evaluateOfferAcceptance,
    findBlockedTerm,
    DEFAULT_BLOCKED_TERMS,
} = require("../src/services/purchaseOrderService");

const tests = [];
function test(name, fn) {
    tests.push({ name, fn });
}

// ---------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------

test("happy-path lifecycle is walkable end to end", () => {
    const path = [
        "REQUESTED",
        "BIDDING",
        "DRIVER_SELECTED",
        "SHOPPING",
        "AWAITING_APPROVAL",
        "PURCHASE_APPROVED",
        "PURCHASED",
        "OUT_FOR_DELIVERY",
        "ARRIVED",
        "DELIVERED",
        "COMPLETED",
    ];

    for (let i = 0; i < path.length - 1; i += 1) {
        const flags =
            path[i + 1] === "DELIVERED" ? { otpVerified: true } : {};

        assert.strictEqual(
            canTransition(path[i], path[i + 1], flags),
            true,
            `${path[i]} -> ${path[i + 1]} should be allowed`
        );
    }
});

test("skipping states is rejected", () => {
    assert.strictEqual(canTransition("REQUESTED", "PURCHASED"), false);
    assert.strictEqual(canTransition("BIDDING", "SHOPPING"), false);
    assert.strictEqual(canTransition("SHOPPING", "PURCHASED"), false);
    assert.strictEqual(canTransition("DRIVER_SELECTED", "PURCHASED"), false);
});

test("terminal states have no outgoing transitions", () => {
    for (const status of ["COMPLETED", "CANCELLED", "FAILED", "DISPUTED"]) {
        assert.deepStrictEqual(nextStatuses(status), []);
    }
});

test("delivery requires a verified OTP — the transition is gated on it", () => {
    assert.strictEqual(canTransition("ARRIVED", "DELIVERED"), false);
    assert.strictEqual(
        canTransition("ARRIVED", "DELIVERED", { otpVerified: false }),
        false
    );
    assert.strictEqual(
        canTransition("ARRIVED", "DELIVERED", { otpVerified: true }),
        true
    );
});

test("cost increase loops PURCHASE_APPROVED back through AWAITING_APPROVAL", () => {
    assert.strictEqual(
        canTransition("PURCHASE_APPROVED", "AWAITING_APPROVAL"),
        true
    );
    assert.strictEqual(
        canTransition("AWAITING_APPROVAL", "SHOPPING"),
        true,
        "passenger rejecting an estimate returns the order to SHOPPING"
    );
});

test("every declared status is reachable in the machine definition", () => {
    for (const status of PURCHASE_STATUSES) {
        assert.ok(
            status === "REQUESTED" ||
                PURCHASE_STATUSES.some((from) =>
                    nextStatuses(from).includes(status)
                ),
            `${status} should be reachable`
        );
    }
});

// ---------------------------------------------------------------------
// Cancellation rules
// ---------------------------------------------------------------------

test("cancel before purchase is a plain cancel", () => {
    for (const status of [
        "REQUESTED",
        "BIDDING",
        "DRIVER_SELECTED",
        "SHOPPING",
        "AWAITING_APPROVAL",
        "PURCHASE_APPROVED",
    ]) {
        assert.strictEqual(resolveCancelOutcome(status), "CANCELLED", status);
    }
});

test("cancel after purchase routes to the dispute / reimbursement workflow", () => {
    for (const status of ["PURCHASED", "OUT_FOR_DELIVERY", "ARRIVED"]) {
        assert.strictEqual(resolveCancelOutcome(status), "DISPUTED", status);
    }
});

test("delivered / terminal orders cannot be cancelled at all", () => {
    for (const status of ["DELIVERED", "COMPLETED", "CANCELLED", "FAILED", "DISPUTED"]) {
        assert.strictEqual(resolveCancelOutcome(status), null, status);
    }
});

test("disputes need an assigned partner and a live order", () => {
    assert.strictEqual(canDispute("REQUESTED"), false);
    assert.strictEqual(canDispute("BIDDING"), false);
    assert.strictEqual(canDispute("SHOPPING"), true);
    assert.strictEqual(canDispute("DELIVERED"), true);
    assert.strictEqual(canDispute("COMPLETED"), false);
});

// ---------------------------------------------------------------------
// Offer acceptance — the double-accept rule
// ---------------------------------------------------------------------

const NOW = new Date("2026-10-29T12:00:00Z");
const FUTURE = new Date(NOW.getTime() + 5 * 60 * 1000);
const PAST = new Date(NOW.getTime() - 60 * 1000);

function openOrder() {
    return { status: "BIDDING", driverId: null };
}

function pendingOffer(extra = {}) {
    return { status: "PENDING", expiresAt: FUTURE, ...extra };
}

test("first acceptance of a live offer on an open order succeeds", () => {
    assert.strictEqual(
        evaluateOfferAcceptance({
            order: openOrder(),
            offer: pendingOffer(),
            now: NOW,
        }).ok,
        true
    );
});

test("double-accept fails: after the first win the order has a driver and left BIDDING", () => {
    const afterFirstAccept = { status: "DRIVER_SELECTED", driverId: "driver-1" };

    const second = evaluateOfferAcceptance({
        order: afterFirstAccept,
        offer: pendingOffer(),
        now: NOW,
    });

    assert.strictEqual(second.ok, false);
    assert.match(second.message, /already has a selected partner/);
});

test("expired or already-decided offers cannot be accepted", () => {
    assert.strictEqual(
        evaluateOfferAcceptance({
            order: openOrder(),
            offer: pendingOffer({ expiresAt: PAST }),
            now: NOW,
        }).ok,
        false
    );
    assert.strictEqual(
        evaluateOfferAcceptance({
            order: openOrder(),
            offer: pendingOffer({ status: "REJECTED" }),
            now: NOW,
        }).ok,
        false
    );
    assert.strictEqual(
        evaluateOfferAcceptance({
            order: openOrder(),
            offer: pendingOffer({ status: "WITHDRAWN" }),
            now: NOW,
        }).ok,
        false
    );
});

// ---------------------------------------------------------------------
// Caps + approved-amount rules
// ---------------------------------------------------------------------

test("amounts must be positive whole PKR", () => {
    assert.strictEqual(checkAmountWithinCaps(0).ok, false);
    assert.strictEqual(checkAmountWithinCaps(-50).ok, false);
    assert.strictEqual(checkAmountWithinCaps(10.5).ok, false);
    assert.strictEqual(checkAmountWithinCaps(500).ok, true);
});

test("admin global cap blocks oversized orders", () => {
    const result = checkAmountWithinCaps(60000, { globalCap: 50000 });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.code, "ABOVE_GLOBAL_CAP");
    assert.strictEqual(
        checkAmountWithinCaps(50000, { globalCap: 50000 }).ok,
        true
    );
});

test("per-partner purchase limit blocks orders above the partner's limit", () => {
    const result = checkAmountWithinCaps(8000, { partnerLimit: 5000 });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.code, "ABOVE_PARTNER_LIMIT");
});

test("purchase above the approved maximum is blocked — approval is a hard ceiling", () => {
    const result = checkPurchaseWithinApproval(4500, 4000);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.code, "ABOVE_APPROVED_AMOUNT");
});

test("purchase at or below the approved maximum is allowed; no approval means no purchase", () => {
    assert.strictEqual(checkPurchaseWithinApproval(4000, 4000).ok, true);
    assert.strictEqual(checkPurchaseWithinApproval(3999, 4000).ok, true);
    assert.strictEqual(
        checkPurchaseWithinApproval(100, null).code,
        "NO_APPROVED_AMOUNT"
    );
});

// ---------------------------------------------------------------------
// Totals + reimbursement ledger (reimbursement is NOT earnings)
// ---------------------------------------------------------------------

test("customer total = shopping cost + delivery fee, tracked as separate parts", () => {
    const totals = computeTotals({ actualCost: 2000, deliveryFee: 300 });

    assert.strictEqual(totals.shoppingCost, 2000);
    assert.strictEqual(totals.deliveryFee, 300);
    assert.strictEqual(totals.customerTotalPayable, 2300);
});

test("full COD payment clears the unpaid balance; partial payment leaves the remainder", () => {
    const full = applyPayment({
        customerTotalPayable: 2300,
        reimbursementReceived: 0,
        amount: 2300,
    });
    assert.deepStrictEqual(full, {
        reimbursementReceived: 2300,
        unpaidAmount: 0,
        fullyPaid: true,
    });

    const partial = applyPayment({
        customerTotalPayable: 2300,
        reimbursementReceived: 0,
        amount: 2000,
    });
    assert.strictEqual(partial.unpaidAmount, 300);
    assert.strictEqual(partial.fullyPaid, false);

    const toppedUp = applyPayment({
        customerTotalPayable: 2300,
        reimbursementReceived: partial.reimbursementReceived,
        amount: 300,
    });
    assert.strictEqual(toppedUp.fullyPaid, true);
    assert.strictEqual(toppedUp.unpaidAmount, 0);
});

// ---------------------------------------------------------------------
// Commission — delivery fee only, zero in Free Mode
// ---------------------------------------------------------------------

const FREE_MODE_SETTINGS = {
    topUpRequired: true, // would enforce IF a gateway were configured
    isActive: true,
    percentage: 10,
};

test("Free Mode: no configured payment method means ZERO commission", () => {
    const result = computePurchaseCommission({
        deliveryFee: 500,
        settings: FREE_MODE_SETTINGS,
        paymentsConfiguredFlag: false,
    });

    assert.strictEqual(result.commission, 0);
    assert.strictEqual(result.driverEarnings, 500);
    assert.strictEqual(result.freeMode, true);
});

test("Free Mode: topUpRequired off also means zero commission", () => {
    const result = computePurchaseCommission({
        deliveryFee: 500,
        settings: { topUpRequired: false, isActive: true, percentage: 10 },
        paymentsConfiguredFlag: true,
    });

    assert.strictEqual(result.commission, 0);
    assert.strictEqual(result.driverEarnings, 500);
});

test("commission, when live, applies ONLY to the delivery fee — never to reimbursement", () => {
    // Even with a huge shopping cost in play, the commission base is
    // the fee: computePurchaseCommission never even receives the
    // shopping amount.
    const result = computePurchaseCommission({
        deliveryFee: 500,
        settings: FREE_MODE_SETTINGS,
        paymentsConfiguredFlag: true,
    });

    assert.strictEqual(result.commission, 50); // 10% of PKR 500 fee
    assert.strictEqual(result.commissionPercentage, 10);
    assert.strictEqual(result.driverEarnings, 450);
    assert.strictEqual(result.fare, 500);
});

test("inactive settings mean zero commission even when a gateway exists", () => {
    const result = computePurchaseCommission({
        deliveryFee: 500,
        settings: { topUpRequired: true, isActive: false, percentage: 10 },
        paymentsConfiguredFlag: true,
    });

    assert.strictEqual(result.commission, 0);
});

// ---------------------------------------------------------------------
// Prohibited goods
// ---------------------------------------------------------------------

test("restricted items are caught at creation, case-insensitively", () => {
    assert.strictEqual(
        findBlockedTerm("Please bring 2 litres of milk and a Beer crate"),
        "beer"
    );
    assert.strictEqual(
        findBlockedTerm("one pack of CIGARETTES please"),
        "cigarettes"
    );
});

test("ordinary grocery lists pass; substrings do not false-positive", () => {
    assert.strictEqual(
        findBlockedTerm("2 litres milk, one bread, six eggs, grape juice"),
        null
    );
    assert.strictEqual(findBlockedTerm(""), null);
    assert.strictEqual(findBlockedTerm(null), null);
});

test("admin term lists replace the defaults; an empty admin list falls back to defaults", () => {
    assert.strictEqual(
        findBlockedTerm("bring the special tonic", ["tonic"]),
        "tonic"
    );
    assert.strictEqual(
        findBlockedTerm("bring beer", []),
        "beer",
        "empty admin list must fall back to the conservative defaults"
    );
    assert.ok(DEFAULT_BLOCKED_TERMS.length >= 10);
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
