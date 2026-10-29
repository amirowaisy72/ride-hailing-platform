// Phase 8 — Acceptance suite (plain node, no test framework, no DB).
//
// RECONSTRUCTED acceptance set: Amir's original spec Part 12 list of 25
// Buy & Deliver acceptance tests is NOT recorded verbatim anywhere in
// the project docs — only the phase-gate number ranges in
// COMBINED_PLAN.md exist. The 25 items below are reconstructed from
// those gates and the Phase 2/4/6/7 rule text (see
// ~/workspace/safar/buy_deliver/ACCEPTANCE_TESTS.md for the mapping,
// gate citations and findings). Rental equivalents R1–R10 are appended
// from the Phase 5–7 rental gates.
//
// Every item gets exactly one verdict:
//   PASS                  — a real assertion ran against the REAL
//                           production code (pure services under
//                           src/services/, plus the PurchaseOrder model
//                           schema for BD-08, which loads without a DB).
//   FAIL                  — an assertion ran and failed.
//   INTEGRATION-REQUIRED  — the rule lives only in a DB/socket-coupled
//                           controller; no pure helper exists to call.
//   UNRUNNABLE            — cannot run in this environment at all.
//
// Run:  node tests/acceptanceSuite.test.js   (from backend/)
// Exit code 0 = no FAIL (INTEGRATION-REQUIRED / UNRUNNABLE are reported
// limitations, not failures); 1 = at least one FAIL.

const assert = require("node:assert");

const eligibility = require("../src/services/eligibilityService");
const purchase = require("../src/services/purchaseOrderService");
const rental = require("../src/services/rentalBookingService");
const chat = require("../src/services/orderChatService");
const rentalPartnerService = require("../src/services/rentalPartnerService");
// Schema-only inspection for BD-08 (registering the model needs no DB
// connection; no document is created, read or written).
const PurchaseOrder = require("../src/models/PurchaseOrder");

const {
    canReceiveRideRequests,
    canReceiveParcelRequests,
    canReceiveBuyDeliverRequests,
    getRequiredDocuments,
    evaluateServiceEligibility,
} = eligibility;

const {
    canTransition: purchaseCanTransition,
    nextStatuses: purchaseNextStatuses,
    resolveCancelOutcome: purchaseResolveCancelOutcome,
    checkAmountWithinCaps,
    checkPurchaseWithinApproval,
    computeTotals,
    applyPayment,
    computePurchaseCommission,
    evaluateOfferAcceptance,
    findBlockedTerm,
    DEFAULT_BLOCKED_TERMS,
    evaluatePurchaseDisputeResolution,
} = purchase;

const {
    canTransition: rentalCanTransition,
    nextStatuses: rentalNextStatuses,
    computeBookingAmounts,
    computeRentalCharges,
    resolveFeeRefund,
    findBlockingBooking,
    isHoldExpired,
    evaluateModeEligibility,
    computeRemainingDues,
    serializeRentalVehicle,
    isContactUnlocked,
    evaluateRentalDisputeResolution,
} = rental;

const {
    PURCHASE_EVENT_TYPE_MAP,
    RENTAL_EVENT_TYPE_MAP,
    mapPurchaseEventType,
    mapRentalEventType,
    mapEventType,
    computeConversationClosed,
    effectiveConversationStatus,
} = chat;

// ---------------------------------------------------------------------
// Verdict plumbing
// ---------------------------------------------------------------------

class Verdict extends Error {
    constructor(verdict, reason) {
        super(reason);
        this.verdict = verdict;
        this.reason = reason;
    }
}

function integrationRequired(reason) {
    throw new Verdict("INTEGRATION-REQUIRED", reason);
}

function unrunnable(reason) {
    throw new Verdict("UNRUNNABLE", reason);
}

const tests = [];
function test(id, title, fn) {
    tests.push({ id, title, fn });
}

// ---------------------------------------------------------------------
// Shared fixtures (same shapes as tests/eligibilityService.test.js)
// ---------------------------------------------------------------------

const DAY = 24 * 60 * 60 * 1000;
const FUTURE_DATE = new Date(Date.now() + 365 * DAY);

function doc(documentType, verificationStatus = "APPROVED", expiryDate = null) {
    return { documentType, verificationStatus, expiryDate };
}

const MOTOR_DOCS = [
    doc("CNIC_FRONT"),
    doc("CNIC_BACK"),
    doc("DRIVING_LICENSE", "APPROVED", FUTURE_DATE),
    doc("VEHICLE_REGISTRATION", "APPROVED", FUTURE_DATE),
];

const IDENTITY_DOCS = [
    doc("CNIC_FRONT"),
    doc("CNIC_BACK"),
    doc("PROFILE_PHOTO"),
];

// Full Buy & Deliver set (Amir correction 2026-10-29): identity +
// profile photo + licence + vehicle registration, every mode.
const BUY_DELIVER_DOCS = [
    doc("CNIC_FRONT"),
    doc("CNIC_BACK"),
    doc("PROFILE_PHOTO"),
    doc("DRIVING_LICENSE", "APPROVED", FUTURE_DATE),
    doc("VEHICLE_REGISTRATION", "APPROVED", FUTURE_DATE),
];

const BIKE = {
    vehicleType: "BIKE",
    verificationStatus: "APPROVED",
    isActive: true,
    registrationExpiryDate: FUTURE_DATE,
};

const CAR = {
    vehicleType: "CAR_AC",
    verificationStatus: "APPROVED",
    isActive: true,
    registrationExpiryDate: FUTURE_DATE,
};

const LEGACY_APPROVED_DRIVER = {
    verificationStatus: "APPROVED",
    currentVehicleId: "vehicle-1",
};

function buyDeliverPartner(transportMode, extraServices = {}) {
    return {
        verificationStatus: "PENDING",
        currentVehicleId: "vehicle-1",
        services: {
            ...extraServices,
            BUY_DELIVER: {
                status: "APPROVED",
                enabled: true,
                transportMode,
                policyAcknowledgedAt: new Date(),
            },
        },
    };
}

// =====================================================================
// BD-01..07 — Eligibility (Phase 2 gate: tests 1–7)
// =====================================================================

test("BD-01", "existing APPROVED ride driver retains RIDE+PARCEL access by derivation", async () => {
    const context = { vehicle: BIKE, documents: MOTOR_DOCS };
    assert.strictEqual(await canReceiveRideRequests(LEGACY_APPROVED_DRIVER, context), true);
    assert.strictEqual(await canReceiveParcelRequests(LEGACY_APPROVED_DRIVER, context), true);
    // Derivation grants the legacy pair only — never Buy & Deliver.
    assert.strictEqual(await canReceiveBuyDeliverRequests(LEGACY_APPROVED_DRIVER, context), false);
});

test("BD-02", "Buy & Deliver applicant without full vehicle verification is NOT eligible", async () => {
    const applicant = buyDeliverPartner("WALKING");
    // Identity documents only, no vehicle at all.
    assert.strictEqual(
        await canReceiveBuyDeliverRequests(applicant, { vehicle: null, documents: IDENTITY_DOCS }),
        false
    );
    // Approved vehicle but licence / registration documents missing.
    assert.strictEqual(
        await canReceiveBuyDeliverRequests(applicant, { vehicle: BIKE, documents: IDENTITY_DOCS }),
        false
    );
    // Full documents but no approved active vehicle.
    assert.strictEqual(
        await canReceiveBuyDeliverRequests(applicant, { vehicle: null, documents: BUY_DELIVER_DOCS }),
        false
    );
    // Approved + full docs but policy NOT acknowledged.
    const noPolicy = buyDeliverPartner("WALKING");
    noPolicy.services.BUY_DELIVER.policyAcknowledgedAt = null;
    assert.strictEqual(
        await canReceiveBuyDeliverRequests(noPolicy, { vehicle: BIKE, documents: BUY_DELIVER_DOCS }),
        false
    );
});

test("BD-03", "Buy & Deliver applicant WITH full verification IS eligible", async () => {
    assert.deepStrictEqual(getRequiredDocuments("BUY_DELIVER", "MOTORBIKE"), [
        "CNIC_FRONT",
        "CNIC_BACK",
        "PROFILE_PHOTO",
        "DRIVING_LICENSE",
        "VEHICLE_REGISTRATION",
    ]);
    const partner = buyDeliverPartner("MOTORBIKE");
    const context = { vehicle: BIKE, documents: BUY_DELIVER_DOCS };
    assert.strictEqual(await canReceiveBuyDeliverRequests(partner, context), true);
    const evaluation = evaluateServiceEligibility("BUY_DELIVER", {
        driver: partner,
        vehicle: BIKE,
        documents: BUY_DELIVER_DOCS,
    });
    assert.strictEqual(evaluation.eligible, true);
    assert.deepStrictEqual(evaluation.reasons, []);
    assert.deepStrictEqual(evaluation.missingDocuments, []);
});

test("BD-04", "bicycle-mode partner can be approved independently (mode is metadata only, full verification still required)", async () => {
    const cyclist = buyDeliverPartner("BICYCLE");
    // Mode alone grants nothing: identity-only documents still block.
    assert.strictEqual(
        await canReceiveBuyDeliverRequests(cyclist, { vehicle: BIKE, documents: IDENTITY_DOCS }),
        false
    );
    // With the FULL set the bicycle-mode partner is eligible on their own.
    const context = { vehicle: BIKE, documents: BUY_DELIVER_DOCS };
    assert.strictEqual(await canReceiveBuyDeliverRequests(cyclist, context), true);
    // …and that approval is independent: it is not a ride/parcel approval.
    assert.strictEqual(await canReceiveRideRequests(cyclist, context), false);
    assert.strictEqual(await canReceiveParcelRequests(cyclist, context), false);
});

test("BD-05", "motorbike partner cannot bypass vehicle checks", async () => {
    const rider = buyDeliverPartner("MOTORBIKE");
    // No licence / registration documents.
    assert.strictEqual(
        await canReceiveBuyDeliverRequests(rider, { vehicle: BIKE, documents: IDENTITY_DOCS }),
        false
    );
    // Full documents but no approved vehicle.
    assert.strictEqual(
        await canReceiveBuyDeliverRequests(rider, { vehicle: null, documents: BUY_DELIVER_DOCS }),
        false
    );
    // Full documents but the active vehicle is a car, not a bike.
    assert.strictEqual(
        await canReceiveBuyDeliverRequests(rider, { vehicle: CAR, documents: BUY_DELIVER_DOCS }),
        false
    );
    // Control: matching approved bike + full documents IS eligible.
    assert.strictEqual(
        await canReceiveBuyDeliverRequests(rider, { vehicle: BIKE, documents: BUY_DELIVER_DOCS }),
        true
    );
});

test("BD-06", "approval of one service never grants another", async () => {
    const rideOnly = {
        verificationStatus: "PENDING",
        currentVehicleId: "vehicle-1",
        services: { RIDE: { status: "APPROVED", enabled: true } },
    };
    const context = { vehicle: BIKE, documents: MOTOR_DOCS };
    assert.strictEqual(await canReceiveRideRequests(rideOnly, context), true);
    assert.strictEqual(await canReceiveParcelRequests(rideOnly, context), false);
    assert.strictEqual(await canReceiveBuyDeliverRequests(rideOnly, context), false);
});

test("BD-07", "Buy & Deliver-only partner gets no ride eligibility and vice-versa (matching isolation)", async () => {
    const bdOnly = buyDeliverPartner("MOTORBIKE");
    const bdContext = { vehicle: BIKE, documents: BUY_DELIVER_DOCS };
    assert.strictEqual(await canReceiveBuyDeliverRequests(bdOnly, bdContext), true);
    assert.strictEqual(await canReceiveRideRequests(bdOnly, bdContext), false);
    assert.strictEqual(await canReceiveParcelRequests(bdOnly, bdContext), false);

    // Vice-versa: a fully ride-approved driver with no Buy & Deliver
    // record receives no Buy & Deliver work.
    const motorContext = { vehicle: BIKE, documents: MOTOR_DOCS };
    assert.strictEqual(await canReceiveRideRequests(LEGACY_APPROVED_DRIVER, motorContext), true);
    assert.strictEqual(await canReceiveBuyDeliverRequests(LEGACY_APPROVED_DRIVER, motorContext), false);
});

// =====================================================================
// BD-08..09 — Creation / fan-out (Phase 4 gate: tests 8–9)
// =====================================================================

test("BD-08", "passenger can create a request with NO store selection / no pickup pin (delivery location only)", () => {
    // Model shape (real production schema, inspected without a DB):
    // the only location the passenger must supply is the delivery
    // destination; there is no store / pickup path on the order at all.
    const pathNames = Object.keys(PurchaseOrder.schema.paths);
    assert.strictEqual(PurchaseOrder.schema.path("deliveryAddress").isRequired, true);
    assert.strictEqual(PurchaseOrder.schema.path("itemsText").isRequired, true);
    assert.strictEqual(PurchaseOrder.schema.path("estimatedBudget").isRequired, true);
    assert.deepStrictEqual(pathNames.filter((p) => /store|pickup/i.test(p)), []);

    // Pure creation rules (purchaseOrderService): a request defined
    // solely by items + budget passes the financial/shape rules — no
    // rule takes, or requires, a store or a pickup coordinate.
    assert.strictEqual(checkAmountWithinCaps(5000, { globalCap: 50000 }).ok, true);
    assert.strictEqual(findBlockedTerm("2 litres milk, one bread, six eggs"), null);
    assert.deepStrictEqual(
        computeTotals({ actualCost: null, deliveryFee: null }),
        { shoppingCost: 0, deliveryFee: 0, customerTotalPayable: 0 }
    );
});

test("BD-09", "fan-out restricted to eligible partners only", () => {
    // No pure fan-out / matching helper exists in purchaseOrderService:
    // evaluateOfferAcceptance governs ACCEPTANCE of an offer, not the
    // fan-out. Asserting that absence is what makes this verdict honest.
    const fanOutLike = Object.keys(purchase).filter((k) =>
        /fan|match|eligible|nearby|broadcast/i.test(k)
    );
    assert.deepStrictEqual(fanOutLike, []);
    integrationRequired(
        "fan-out lives only in controllers/purchaseController.js createPurchaseOrder: a MongoDB $near query on Driver.currentLocation, then a per-driver eligibilityService.canReceiveBuyDeliverRequests + cap check, then socket/FCM notify — it needs MongoDB, geospatial data and live sockets, so no pure assertion can exercise it"
    );
});

// =====================================================================
// BD-10..13 — Chat / selection (Phase 6 gate: tests 10–13)
// =====================================================================

const NOW = new Date("2026-10-29T12:00:00Z");
const OFFER_FUTURE = new Date(NOW.getTime() + 5 * 60 * 1000);

test("BD-10", "exactly one driver selectable (single-winner offer acceptance)", () => {
    const first = evaluateOfferAcceptance({
        order: { status: "BIDDING", driverId: null },
        offer: { status: "PENDING", expiresAt: OFFER_FUTURE },
        now: NOW,
    });
    assert.strictEqual(first.ok, true);

    // After the first win the order has a driver and has left BIDDING:
    // every competing acceptance is refused.
    const second = evaluateOfferAcceptance({
        order: { status: "DRIVER_SELECTED", driverId: "driver-1" },
        offer: { status: "PENDING", expiresAt: OFFER_FUTURE },
        now: NOW,
    });
    assert.strictEqual(second.ok, false);
    assert.match(second.message, /already has a selected partner/);
});

test("BD-11", "unauthorized users cannot read a conversation", () => {
    // orderChatService exports NO read-authorization / participant
    // helper — its pure surface is event mapping, closed-state and
    // message validation only. Asserting that absence is what makes
    // this verdict honest.
    const authLike = Object.keys(chat).filter((k) =>
        /author|participant|canRead|isParty|access/i.test(k)
    );
    assert.deepStrictEqual(authLike, []);
    integrationRequired(
        "read authorization lives only in controllers/orderChatController.js (isOrderParty + loadParticipantConversation, 403 for non-participants) and is coupled to OrderConversation/PurchaseOrder/RentalBooking DB lookups — it needs MongoDB and an authenticated request, so no pure assertion can exercise it"
    );
});

const WINNER = "64b0000000000000000000a1";
const LOSER = "64b0000000000000000000a2";

test("BD-12", "chat history survives disconnect/reconnect (conversation is not closed by disconnect)", () => {
    // The closed computation has no disconnect input at all: a live
    // winner thread in a working state stays ACTIVE however often the
    // (pure, idempotent) computation is re-run — e.g. on reconnect.
    const input = {
        orderType: "PURCHASE",
        orderStatus: "SHOPPING",
        orderDriverId: WINNER,
        partnerRefId: WINNER,
        storedStatus: "ACTIVE",
    };
    for (let i = 0; i < 3; i += 1) {
        assert.strictEqual(computeConversationClosed(input), false);
        assert.strictEqual(effectiveConversationStatus(input), "ACTIVE");
    }
    // Same for a live rental thread.
    assert.strictEqual(
        effectiveConversationStatus({ orderType: "RENTAL", orderStatus: "CONFIRMED" }),
        "ACTIVE"
    );
});

test("BD-13", "losing bidders' conversations close read-only after selection while the winner's stays open", () => {
    for (const status of ["DRIVER_SELECTED", "SHOPPING", "AWAITING_APPROVAL"]) {
        assert.strictEqual(
            computeConversationClosed({
                orderType: "PURCHASE",
                orderStatus: status,
                orderDriverId: WINNER,
                partnerRefId: LOSER,
            }),
            true,
            `loser @ ${status}`
        );
        assert.strictEqual(
            computeConversationClosed({
                orderType: "PURCHASE",
                orderStatus: status,
                orderDriverId: WINNER,
                partnerRefId: WINNER,
            }),
            false,
            `winner @ ${status}`
        );
    }
    assert.strictEqual(
        effectiveConversationStatus({
            orderType: "PURCHASE",
            orderStatus: "SHOPPING",
            orderDriverId: WINNER,
            partnerRefId: LOSER,
        }),
        "CLOSED"
    );
});

// =====================================================================
// BD-14..19 — Financial core (Phase 4 gate: tests 14–19)
// =====================================================================

test("BD-14", "amounts cannot change without passenger approval", () => {
    // Spending beyond the approved maximum is refused outright…
    assert.strictEqual(checkPurchaseWithinApproval(4500, 4000).ok, false);
    // …and the only sanctioned route to a higher amount is back
    // through AWAITING_APPROVAL for a FRESH approval.
    assert.strictEqual(purchaseCanTransition("PURCHASE_APPROVED", "AWAITING_APPROVAL"), true);
    assert.strictEqual(purchaseCanTransition("AWAITING_APPROVAL", "PURCHASE_APPROVED"), true);
    // There is no shortcut around the approval state.
    assert.strictEqual(purchaseCanTransition("SHOPPING", "PURCHASED"), false);
    assert.strictEqual(purchaseCanTransition("DRIVER_SELECTED", "PURCHASED"), false);
});

test("BD-15", "purchase above the approved maximum is hard-rejected (caps + ceiling)", () => {
    const aboveApproval = checkPurchaseWithinApproval(4500, 4000);
    assert.strictEqual(aboveApproval.ok, false);
    assert.strictEqual(aboveApproval.code, "ABOVE_APPROVED_AMOUNT");
    // At the ceiling is allowed.
    assert.strictEqual(checkPurchaseWithinApproval(4000, 4000).ok, true);
    // Platform + per-partner caps are hard ceilings too.
    assert.strictEqual(checkAmountWithinCaps(60000, { globalCap: 50000 }).code, "ABOVE_GLOBAL_CAP");
    assert.strictEqual(checkAmountWithinCaps(8000, { partnerLimit: 5000 }).code, "ABOVE_PARTNER_LIMIT");
    // No approval recorded yet means no purchase at all.
    assert.strictEqual(checkPurchaseWithinApproval(100, null).code, "NO_APPROVED_AMOUNT");
});

test("BD-16", "OTP delivery completion cannot be duplicated", () => {
    // Delivery is gated on a verified OTP.
    assert.strictEqual(purchaseCanTransition("ARRIVED", "DELIVERED"), false);
    assert.strictEqual(purchaseCanTransition("ARRIVED", "DELIVERED", { otpVerified: false }), false);
    assert.strictEqual(purchaseCanTransition("ARRIVED", "DELIVERED", { otpVerified: true }), true);
    // A second completion is impossible: DELIVERED cannot go to
    // DELIVERED again, and terminal states have no outgoing edges.
    assert.strictEqual(purchaseCanTransition("DELIVERED", "DELIVERED", { otpVerified: true }), false);
    assert.deepStrictEqual(purchaseNextStatuses("COMPLETED"), []);
    assert.deepStrictEqual(purchaseNextStatuses("DELIVERED"), ["COMPLETED", "DISPUTED"]);
});

test("BD-17", "reimbursement tracked separately from earnings", () => {
    const totals = computeTotals({ actualCost: 2000, deliveryFee: 300 });
    assert.strictEqual(totals.shoppingCost, 2000);
    assert.strictEqual(totals.deliveryFee, 300);
    assert.strictEqual(totals.customerTotalPayable, 2300);

    const partial = applyPayment({
        customerTotalPayable: totals.customerTotalPayable,
        reimbursementReceived: 0,
        amount: 2000,
    });
    assert.deepStrictEqual(partial, {
        reimbursementReceived: 2000,
        unpaidAmount: 300,
        fullyPaid: false,
    });

    // Earnings are computed from the delivery-fee side ONLY — the
    // reimbursement figure never enters the earnings result.
    const commission = computePurchaseCommission({
        deliveryFee: totals.deliveryFee,
        settings: { topUpRequired: true, isActive: true, percentage: 10 },
        paymentsConfiguredFlag: true,
    });
    assert.strictEqual(commission.fare, 300);
    assert.strictEqual(commission.driverEarnings, 270);
});

test("BD-18", "commission applies to the delivery fee ONLY, never to shopping amounts", () => {
    // A large shopping cost in play changes nothing: the commission
    // function's only money input is the delivery fee.
    const totals = computeTotals({ actualCost: 20000, deliveryFee: 500 });
    assert.strictEqual(totals.shoppingCost, 20000);
    const result = computePurchaseCommission({
        deliveryFee: totals.deliveryFee,
        settings: { topUpRequired: true, isActive: true, percentage: 10 },
        paymentsConfiguredFlag: true,
    });
    assert.strictEqual(result.commission, 50); // 10% of PKR 500 fee — not of 20,500
    assert.strictEqual(result.driverEarnings, 450);
    assert.strictEqual(result.fare, 500);
});

test("BD-19", "Free Mode ⇒ commission is exactly 0", () => {
    const settings = { topUpRequired: true, isActive: true, percentage: 10 };
    const noGateway = computePurchaseCommission({
        deliveryFee: 500,
        settings,
        paymentsConfiguredFlag: false,
    });
    assert.strictEqual(noGateway.commission, 0);
    assert.strictEqual(noGateway.driverEarnings, 500);
    assert.strictEqual(noGateway.freeMode, true);

    const topUpOff = computePurchaseCommission({
        deliveryFee: 500,
        settings: { topUpRequired: false, isActive: true, percentage: 10 },
        paymentsConfiguredFlag: true,
    });
    assert.strictEqual(topUpOff.commission, 0);
    assert.strictEqual(topUpOff.driverEarnings, 500);
});

// =====================================================================
// BD-20..21 — Phase 4 safeguards (reconstructed)
// =====================================================================

test("BD-20", "cancellation after purchase routes to DISPUTED/reimbursement path, not a plain cancel", () => {
    for (const status of ["PURCHASED", "OUT_FOR_DELIVERY", "ARRIVED"]) {
        assert.strictEqual(purchaseResolveCancelOutcome(status), "DISPUTED", status);
    }
    // Contrast: before anything is bought, a plain cancel is correct.
    for (const status of ["REQUESTED", "BIDDING", "SHOPPING", "PURCHASE_APPROVED"]) {
        assert.strictEqual(purchaseResolveCancelOutcome(status), "CANCELLED", status);
    }
    // Delivered / terminal orders cannot be cancelled at all.
    assert.strictEqual(purchaseResolveCancelOutcome("DELIVERED"), null);
    assert.strictEqual(purchaseResolveCancelOutcome("COMPLETED"), null);
});

test("BD-21", "prohibited/blocked terms in the shopping list are rejected", () => {
    assert.strictEqual(findBlockedTerm("Please bring 2 litres of milk and a Beer crate"), "beer");
    assert.strictEqual(findBlockedTerm("one pack of CIGARETTES please"), "cigarettes");
    assert.ok(DEFAULT_BLOCKED_TERMS.length >= 10);
    // Ordinary lists pass, and substrings do not false-positive.
    assert.strictEqual(findBlockedTerm("2 litres milk, one bread, six eggs, grape juice"), null);
    assert.strictEqual(findBlockedTerm(""), null);
    assert.strictEqual(findBlockedTerm(null), null);
});

// =====================================================================
// BD-22..23 — Notifications (Phase 6 gate: tests 22–23)
// =====================================================================

test("BD-22", "foreground socket event mapping exists for purchase + rental lifecycle events", () => {
    assert.ok(Object.keys(PURCHASE_EVENT_TYPE_MAP).length > 0);
    assert.ok(Object.keys(RENTAL_EVENT_TYPE_MAP).length > 0);
    // Purchase lifecycle → structured foreground cards.
    assert.strictEqual(mapPurchaseEventType("OFFER_ACCEPTED"), "OFFER");
    assert.strictEqual(mapPurchaseEventType("COST_ESTIMATE_SUBMITTED"), "ESTIMATE");
    assert.strictEqual(mapPurchaseEventType("AMOUNT_APPROVED"), "APPROVAL");
    assert.strictEqual(mapPurchaseEventType("ITEMS_PURCHASED"), "PURCHASE_CONFIRMATION");
    assert.strictEqual(mapPurchaseEventType("DELIVERED"), "STATUS");
    // Rental lifecycle → structured foreground cards.
    assert.strictEqual(mapRentalEventType("FEE_PAYMENT_SUBMITTED"), "BOOKING_FEE");
    assert.strictEqual(mapRentalEventType("PICKUP_VERIFIED"), "HANDOVER");
    assert.strictEqual(mapRentalEventType("RETURN_RECORDED"), "RETURN");
    assert.strictEqual(mapRentalEventType("BOOKING_CANCELLED"), "STATUS");
    // The dispatcher routes by order type.
    assert.strictEqual(mapEventType("PURCHASE", "OFFER_ACCEPTED"), "OFFER");
    assert.strictEqual(mapEventType("RENTAL", "PICKUP_VERIFIED"), "HANDOVER");
});

test("BD-23", "background FCM push on device", () => {
    unrunnable(
        "no Android device/emulator and no Firebase credentials in this environment — background FCM push delivery cannot be exercised or claimed; foreground socket mapping is covered by BD-22"
    );
});

// =====================================================================
// BD-24..25 — Admin (Phase 7 gate: tests 24–25)
// =====================================================================

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

test("BD-24", "admin dispute resolution rules work", () => {
    // DISPUTED stays terminal in the operational machines; resolution
    // is the separate admin-only evaluator (mirrors
    // tests/adminDisputeResolution.test.js).
    assert.deepStrictEqual(purchaseNextStatuses("DISPUTED"), []);
    assert.deepStrictEqual(rentalNextStatuses("DISPUTED"), []);

    const settled = evaluatePurchaseDisputeResolution({
        order: disputedPurchase({ reimbursementReceived: 2100 }),
        outcome: "COMPLETED",
    });
    assert.strictEqual(settled.ok, true);
    assert.strictEqual(settled.toStatus, "COMPLETED");

    const notDisputed = evaluatePurchaseDisputeResolution({
        order: disputedPurchase({ status: "SHOPPING" }),
        outcome: "CANCELLED",
    });
    assert.strictEqual(notDisputed.ok, false);
    assert.strictEqual(notDisputed.code, "ORDER_NOT_DISPUTED");

    const rentalResolved = evaluateRentalDisputeResolution({
        booking: {
            status: "DISPUTED",
            bookingFee: 800,
            feePayment: { status: "VERIFIED" },
            startAt: new Date(NOW.getTime() + 48 * 60 * 60 * 1000),
        },
        outcome: "CANCELLED",
        fault: "PARTNER",
        policy: "STRICT",
        now: NOW,
    });
    assert.strictEqual(rentalResolved.ok, true);
    assert.deepStrictEqual(rentalResolved.feeRefund, { status: "DUE", percent: 100, amount: 800 });
});

test("BD-25", "suspending one service never disables another approved service", async () => {
    // Derived path: suspending RIDE on a legacy approved driver leaves
    // the derived PARCEL access untouched.
    const rideSuspended = {
        ...LEGACY_APPROVED_DRIVER,
        services: { RIDE: { status: "SUSPENDED", enabled: true } },
    };
    const motorContext = { vehicle: BIKE, documents: MOTOR_DOCS };
    assert.strictEqual(await canReceiveRideRequests(rideSuspended, motorContext), false);
    assert.strictEqual(await canReceiveParcelRequests(rideSuspended, motorContext), true);

    // Explicit path: suspending BUY_DELIVER leaves explicitly approved
    // RIDE and PARCEL untouched.
    const bdSuspended = {
        verificationStatus: "PENDING",
        currentVehicleId: "vehicle-1",
        services: {
            RIDE: { status: "APPROVED", enabled: true },
            PARCEL: { status: "APPROVED", enabled: true },
            BUY_DELIVER: {
                status: "SUSPENDED",
                enabled: true,
                transportMode: "MOTORBIKE",
                policyAcknowledgedAt: new Date(),
            },
        },
    };
    assert.strictEqual(await canReceiveBuyDeliverRequests(bdSuspended, { vehicle: BIKE, documents: BUY_DELIVER_DOCS }), false);
    assert.strictEqual(await canReceiveRideRequests(bdSuspended, motorContext), true);
    assert.strictEqual(await canReceiveParcelRequests(bdSuspended, motorContext), true);
});

// =====================================================================
// R1..R10 — Rental equivalents (Phase 5–7 gates)
// =====================================================================

const HOUR = 60 * 60 * 1000;
const RDAY = 24 * HOUR;
const T0 = new Date("2026-11-10T09:00:00.000Z");
const PRICING = { hourly: 1500, daily: 8000, weekly: 45000, monthly: 150000 };

test("R1", "booking fee / rental charges / security deposit are three separate amounts; fee = % of charges ONLY (16000 @ 5% ⇒ 800)", () => {
    const charges = computeRentalCharges({
        pricing: PRICING,
        startAt: T0,
        endAt: new Date(T0.getTime() + 2 * RDAY),
        billingUnit: "DAILY",
    });
    assert.strictEqual(charges.ok, true);
    assert.strictEqual(charges.rentalCharges, 16000);

    const amounts = computeBookingAmounts({
        rentalCharges: charges.rentalCharges,
        securityDeposit: 50000,
        feePercent: 5,
    });
    assert.strictEqual(amounts.ok, true);
    assert.strictEqual(amounts.rentalCharges, 16000);
    assert.strictEqual(amounts.bookingFee, 800); // 5% of charges — deposit excluded
    assert.strictEqual(amounts.securityDeposit, 50000);
    assert.strictEqual(amounts.feeDueBeforeConfirmation, 800);
    assert.strictEqual(amounts.grandTotal, 16000 + 800 + 50000);
});

test("R2", "CONFIRMED is unreachable without a verified fee (no REQUESTED→CONFIRMED path)", () => {
    // No direct edge exists, even claiming a verified fee.
    assert.strictEqual(rentalCanTransition("REQUESTED", "CONFIRMED", { feeVerified: true }), false);
    assert.strictEqual(rentalCanTransition("PROVIDER_ACCEPTED", "CONFIRMED", { feeVerified: true }), false);
    assert.ok(!rentalNextStatuses("REQUESTED").includes("CONFIRMED"));
    // The ONLY confirming edge is PAYMENT_PENDING → CONFIRMED, and it
    // is gated on feeVerified === true.
    assert.strictEqual(rentalCanTransition("PAYMENT_PENDING", "CONFIRMED"), false);
    assert.strictEqual(rentalCanTransition("PAYMENT_PENDING", "CONFIRMED", { feeVerified: false }), false);
    assert.strictEqual(rentalCanTransition("PAYMENT_PENDING", "CONFIRMED", { feeVerified: true }), true);
});

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

test("R3", "contact/pickup details masked before CONFIRMED", () => {
    const view = serializeRentalVehicle(LISTING);
    assert.strictEqual(view.exactPickupAddress, null);
    assert.strictEqual(view.pickupContactPhone, null);
    assert.strictEqual(view.pickupContactName, null);
    assert.strictEqual(view.contactUnlocked, false);
    assert.strictEqual(view.pickupAreaLabel, "Charsadda Road"); // approximate area stays public
    assert.ok(!JSON.stringify(view).includes("Secret Lane"));
    assert.ok(!JSON.stringify(view).includes("0300-0000000"));

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

test("R4", "overlap/double-booking guard rejects overlapping bookings for the same vehicle", () => {
    const existing = [{
        _id: "b1",
        status: "CONFIRMED",
        startAt: T0,
        endAt: new Date(T0.getTime() + 2 * RDAY),
    }];
    const blocker = findBlockingBooking(existing, {
        startAt: new Date(T0.getTime() + RDAY),
        endAt: new Date(T0.getTime() + 3 * RDAY),
    });
    assert.strictEqual(blocker?._id, "b1");
    // A back-to-back window (touching at the boundary) does NOT block.
    assert.strictEqual(
        findBlockingBooking(existing, {
            startAt: new Date(T0.getTime() + 2 * RDAY),
            endAt: new Date(T0.getTime() + 3 * RDAY),
        }),
        null
    );
    // Cancelled bookings never block.
    assert.strictEqual(
        findBlockingBooking(
            [{ _id: "b2", status: "CANCELLED", startAt: T0, endAt: new Date(T0.getTime() + 2 * RDAY) }],
            { startAt: T0, endAt: new Date(T0.getTime() + RDAY) }
        ),
        null
    );
});

test("R5", "expired PAYMENT_PENDING releases the calendar hold", () => {
    const now = new Date(T0.getTime() + 10 * RDAY);
    const expiredHold = {
        _id: "b1",
        status: "PAYMENT_PENDING",
        startAt: new Date(T0.getTime() + 12 * RDAY),
        endAt: new Date(T0.getTime() + 13 * RDAY),
        paymentDeadlineAt: new Date(T0.getTime() + 9 * RDAY),
    };
    assert.strictEqual(isHoldExpired(expiredHold, now), true);
    assert.strictEqual(
        findBlockingBooking([expiredHold], { startAt: expiredHold.startAt, endAt: expiredHold.endAt }, { now }),
        null
    );
    // Control: a hold still inside its deadline DOES block.
    const liveHold = { ...expiredHold, paymentDeadlineAt: new Date(T0.getTime() + 11 * RDAY) };
    assert.strictEqual(isHoldExpired(liveHold, now), false);
    assert.strictEqual(
        findBlockingBooking([liveHold], { startAt: liveHold.startAt, endAt: liveHold.endAt }, { now })?._id,
        "b1"
    );
});

test("R6", "refund matrix: provider failure/fraud ⇒ 100% refund", () => {
    for (const policy of ["FLEXIBLE", "MODERATE", "STRICT"]) {
        const refund = resolveFeeRefund({
            policy,
            cancelledBy: "PASSENGER",
            hoursBeforePickup: 0,
            providerFailure: true,
            bookingFee: 800,
            feeVerified: true,
        });
        assert.deepStrictEqual(refund, { status: "DUE", percent: 100, amount: 800 }, policy);
    }
    // A provider cancelling also refunds in full, even under STRICT.
    assert.strictEqual(
        resolveFeeRefund({
            policy: "STRICT",
            cancelledBy: "PARTNER",
            hoursBeforePickup: 1,
            bookingFee: 800,
            feeVerified: true,
        }).amount,
        800
    );
});

test("R7", "pickup OTP gate: RENTAL_ACTIVE unreachable without PICKUP_VERIFIED", () => {
    // No shortcut from CONFIRMED (or anywhere earlier) to RENTAL_ACTIVE.
    assert.strictEqual(rentalCanTransition("CONFIRMED", "RENTAL_ACTIVE"), false);
    assert.strictEqual(rentalCanTransition("PAYMENT_PENDING", "RENTAL_ACTIVE", { feeVerified: true }), false);
    // The pickup step itself is OTP-gated.
    assert.strictEqual(rentalCanTransition("CONFIRMED", "PICKUP_VERIFIED"), false);
    assert.strictEqual(rentalCanTransition("CONFIRMED", "PICKUP_VERIFIED", { otpVerified: false }), false);
    assert.strictEqual(rentalCanTransition("CONFIRMED", "PICKUP_VERIFIED", { otpVerified: true }), true);
    // Only PICKUP_VERIFIED may advance to RENTAL_ACTIVE.
    assert.strictEqual(rentalCanTransition("PICKUP_VERIFIED", "RENTAL_ACTIVE"), true);
});

test("R8", "return dues computed from both odometer readings at the listing's rates", () => {
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

test("R9", "self-drive launch gate: SELF_DRIVE rejected while rentalsSelfDriveEnabled is false", () => {
    const vehicle = { rentalModes: ["SELF_DRIVE", "WITH_DRIVER"] };
    const licence = { number: "KPK-12345", expiryDate: new Date(T0.getTime() + 365 * RDAY) };
    // The pure guard in rentalBookingService: flag off ⇒ rejected,
    // however the vehicle and licence are configured.
    const blocked = evaluateModeEligibility({
        vehicle,
        mode: "SELF_DRIVE",
        selfDriveEnabled: false,
        renterLicence: licence,
        now: T0,
    });
    assert.strictEqual(blocked.ok, false);
    assert.strictEqual(blocked.code, "SELF_DRIVE_DISABLED");
    // With Driver is unaffected by the flag.
    assert.strictEqual(
        evaluateModeEligibility({ vehicle, mode: "WITH_DRIVER", selfDriveEnabled: false, now: T0 }).ok,
        true
    );
    // Control: flag on + valid licence + mode offered ⇒ allowed.
    assert.strictEqual(
        evaluateModeEligibility({ vehicle, mode: "SELF_DRIVE", selfDriveEnabled: true, renterLicence: licence, now: T0 }).ok,
        true
    );
});

test("R10", "listing approval blocked until the anti-bypass agreement is accepted", () => {
    // No pure agreement-gate helper exists in either rental service:
    // rentalBookingService has no agreement export and
    // rentalPartnerService covers KYC documents only. Asserting that
    // absence is what makes this verdict honest.
    const agreementLike = [
        ...Object.keys(rental),
        ...Object.keys(rentalPartnerService),
    ].filter((k) => /agreement/i.test(k));
    assert.deepStrictEqual(agreementLike, []);
    integrationRequired(
        "the gate lives only in controllers/adminRentalController.js (listing APPROVED is refused with code AGREEMENT_NOT_ACCEPTED when RentalPartner.agreementAcceptedAt is null, after a DB lookup of the partner record) — it needs MongoDB and an admin request, so no pure assertion can exercise it"
    );
});

// ---------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------

(async () => {
    const counts = { PASS: 0, FAIL: 0, "INTEGRATION-REQUIRED": 0, UNRUNNABLE: 0 };
    const failures = [];

    console.log("Phase 8 — Acceptance suite (reconstructed BD-01..25 + R1..R10)\n");

    for (const { id, title, fn } of tests) {
        try {
            await fn();
            counts.PASS += 1;
            console.log(`${id} PASS — ${title}`);
        } catch (error) {
            if (error instanceof Verdict) {
                counts[error.verdict] += 1;
                console.log(`${id} ${error.verdict} — ${title}`);
                console.log(`        reason: ${error.reason}`);
            } else {
                counts.FAIL += 1;
                failures.push({ id, title, error });
                console.log(`${id} FAIL — ${title}`);
                console.log(`        ${String(error.message || error).split("\n")[0]}`);
            }
        }
    }

    console.log(
        `\nTotals: ${tests.length} items — ${counts.PASS} PASS, ${counts.FAIL} FAIL, ` +
            `${counts["INTEGRATION-REQUIRED"]} INTEGRATION-REQUIRED, ${counts.UNRUNNABLE} UNRUNNABLE`
    );

    if (failures.length) {
        console.log("\nFailures:");
        for (const { id, title, error } of failures) {
            console.log(`  ${id} ${title}\n        ${error.message}`);
        }
    }

    process.exitCode = counts.FAIL ? 1 : 0;
})();
