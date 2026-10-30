// ---------------------------------------------------------------------------
// Phase 4 — Buy & Deliver (PurchaseOrder) domain rules: SINGLE SOURCE OF
// TRUTH for the order state machine and every financial rule.
//
// This module is deliberately PURE — no database access, no model imports —
// so the rules can be unit-tested without MongoDB (see
// backend/tests/purchaseOrderService.test.js) and reused identically by
// the REST controller and the settlement service.
//
// Financial invariants enforced here:
//  - Shopping money is NOT earnings. The partner's service earnings are
//    computed from the DELIVERY FEE only; the shopping cost is a
//    reimbursement the passenger owes back, tracked on the order itself
//    and never routed through the driver wallet.
//  - A partner can never purchase above the passenger-approved maximum
//    without a fresh approval event (state returns to AWAITING_APPROVAL).
//  - Commission — when enabled at all — is a percentage of the delivery
//    fee only, and is ZERO while Auto Free Mode applies (same rule as
//    rides/parcels: topUpRequired === true AND a payment method is
//    actually configured AND the settings are active).
//  - Every amount is a safe integer number of PKR, mirroring the rest of
//    the codebase (parcel/ride offer validation).
// ---------------------------------------------------------------------------

const PURCHASE_STATUSES = [
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
    "CANCELLED",
    "FAILED",
    "DISPUTED",
];

// Allowed forward transitions. Every controller action must move the
// order along one of these edges, via an atomic status-guarded update.
// DISPUTED is reachable from every post-assignment working state;
// COMPLETED / CANCELLED / FAILED / DISPUTED are terminal in this phase
// (dispute RESOLUTION is an admin action — Phase 7).
const PURCHASE_TRANSITIONS = {
    REQUESTED: ["BIDDING", "CANCELLED", "FAILED"],
    BIDDING: ["DRIVER_SELECTED", "CANCELLED", "FAILED"],
    DRIVER_SELECTED: ["SHOPPING", "CANCELLED", "DISPUTED"],
    // SHOPPING -> PURCHASE_APPROVED is the budget-cap auto-approval edge
    // (Amir review A13): when the partner's estimate is at or below the
    // budget the passenger stated at creation, that budget IS the
    // approval, so no passenger approval round-trip is needed. The edge
    // may ONLY be taken through evaluateBudgetCapApproval below; an
    // over-budget estimate still goes SHOPPING -> AWAITING_APPROVAL.
    SHOPPING: [
        "AWAITING_APPROVAL",
        "PURCHASE_APPROVED",
        "CANCELLED",
        "DISPUTED",
    ],
    AWAITING_APPROVAL: [
        "PURCHASE_APPROVED",
        "SHOPPING",
        "CANCELLED",
        "DISPUTED",
    ],
    // A cost increase discovered before buying sends the order back to
    // AWAITING_APPROVAL for a FRESH passenger approval — the partner may
    // not simply spend more.
    PURCHASE_APPROVED: ["PURCHASED", "AWAITING_APPROVAL", "DISPUTED"],
    PURCHASED: ["OUT_FOR_DELIVERY", "DISPUTED"],
    OUT_FOR_DELIVERY: ["ARRIVED", "DISPUTED"],
    ARRIVED: ["DELIVERED", "DISPUTED"],
    DELIVERED: ["COMPLETED", "DISPUTED"],
    COMPLETED: [],
    CANCELLED: [],
    FAILED: [],
    DISPUTED: [],
};

const TERMINAL_STATUSES = ["COMPLETED", "CANCELLED", "FAILED", "DISPUTED"];

// Statuses in which the passenger may still cancel outright: nothing has
// been bought yet, so no money is owed to anyone.
const PRE_PURCHASE_CANCELLABLE = [
    "REQUESTED",
    "BIDDING",
    "DRIVER_SELECTED",
    "SHOPPING",
    "AWAITING_APPROVAL",
    "PURCHASE_APPROVED",
];

// After PURCHASED the partner has spent their own money on the
// passenger's items, so a "cancel" can no longer be a plain cancel: it
// enters the reimbursement / dispute workflow instead.
const POST_PURCHASE_CANCEL_TO_DISPUTE = [
    "PURCHASED",
    "OUT_FOR_DELIVERY",
    "ARRIVED",
];

function isValidStatus(status) {
    return PURCHASE_STATUSES.includes(status);
}

function nextStatuses(status) {
    return [...(PURCHASE_TRANSITIONS[status] || [])];
}

// `flags.otpVerified` gates the ARRIVED -> DELIVERED edge: a delivery can
// never be recorded without the passenger's delivery OTP having been
// verified first (the hash check itself lives in the controller, which
// passes the outcome in here so the rule stays testable and central).
function canTransition(from, to, flags = {}) {
    if (!nextStatuses(from).includes(to)) {
        return false;
    }

    if (to === "DELIVERED" && flags.otpVerified !== true) {
        return false;
    }

    return true;
}

// What a cancel request means for an order in `status`:
//   "CANCELLED" — safe to cancel outright (nothing purchased yet)
//   "DISPUTED"  — money already spent; route to the dispute workflow
//   null        — cannot be cancelled from here at all
function resolveCancelOutcome(status) {
    if (PRE_PURCHASE_CANCELLABLE.includes(status)) {
        return "CANCELLED";
    }

    if (POST_PURCHASE_CANCEL_TO_DISPUTE.includes(status)) {
        return "DISPUTED";
    }

    return null;
}

// Whether a dispute may be raised from `status` (either party). Before a
// partner is assigned there is nothing to dispute — the passenger simply
// cancels; terminal states are closed.
function canDispute(status) {
    return (
        !TERMINAL_STATUSES.includes(status) &&
        status !== "REQUESTED" &&
        status !== "BIDDING"
    );
}

// ---------------------------------------------------------------------------
// Amounts + caps
// ---------------------------------------------------------------------------

function isValidAmount(value) {
    return Number.isSafeInteger(value) && value >= 1;
}

// Checks an amount against the two spending caps. `partnerLimit` is the
// per-partner purchaseLimit from the eligibility record; `globalCap` is
// the admin-configured platform maximum (CommissionSettings
// .buyDeliverMaxOrderValue). null/undefined on either means "no cap".
// Returns { ok: true } or { ok: false, code, message }.
function checkAmountWithinCaps(amount, { partnerLimit = null, globalCap = null } = {}) {
    if (!isValidAmount(amount)) {
        return {
            ok: false,
            code: "INVALID_AMOUNT",
            message: "Amount must be a positive whole number of PKR",
        };
    }

    if (
        Number.isSafeInteger(globalCap) &&
        globalCap >= 1 &&
        amount > globalCap
    ) {
        return {
            ok: false,
            code: "ABOVE_GLOBAL_CAP",
            message: `Amount exceeds the platform maximum of PKR ${globalCap} for Buy & Deliver orders`,
        };
    }

    if (
        Number.isSafeInteger(partnerLimit) &&
        partnerLimit >= 1 &&
        amount > partnerLimit
    ) {
        return {
            ok: false,
            code: "ABOVE_PARTNER_LIMIT",
            message: `Amount exceeds this partner's purchase limit of PKR ${partnerLimit}`,
        };
    }

    return { ok: true };
}

// ---------------------------------------------------------------------------
// Budget-cap approval (Amir review A13 — approved decision: the
// passenger's stated budget IS the approved cap)
//
// How an estimate becomes an approval, and what `approvedMaxAmount`
// (the ceiling checkPurchaseWithinApproval enforces at purchase time)
// means for each source, recorded on the order as
// `estimateApprovalSource`:
//
//   "PASSENGER"  — the estimate exceeded the stated budget (or was an
//                  increase above a previous ceiling), the order waited
//                  in AWAITING_APPROVAL, and the passenger approved an
//                  amount explicitly. approvedMaxAmount = THAT amount.
//   "BUDGET_CAP" — the estimate was at or below `estimatedBudget`, so
//                  it was auto-approved with NO passenger action.
//                  approvedMaxAmount = estimatedBudget (the stated
//                  cap itself, NOT the estimate): the passenger
//                  authorised spending up to their budget, so till
//                  prices landing above the estimate but at/below the
//                  budget need no fresh approval round, while anything
//                  above the budget still does (a new estimate above
//                  approvedMaxAmount loops PURCHASE_APPROVED ->
//                  AWAITING_APPROVAL exactly as before).
// ---------------------------------------------------------------------------
const ESTIMATE_APPROVAL_SOURCES = ["PASSENGER", "BUDGET_CAP"];

function evaluateBudgetCapApproval({ estimatedCost, estimatedBudget } = {}) {
    if (!isValidAmount(estimatedCost) || !isValidAmount(estimatedBudget)) {
        return { autoApproved: false };
    }

    if (estimatedCost > estimatedBudget) {
        return { autoApproved: false };
    }

    return {
        autoApproved: true,
        approvalSource: "BUDGET_CAP",
        approvedMaxAmount: estimatedBudget,
    };
}

// Receipt photos are OPTIONAL when recording a purchase (Amir review
// A14): zero photos is valid. When photos ARE provided the historical
// validation is unchanged — an array of at most 6 non-empty URL
// strings, each at most 1000 characters (mirrors the controller's
// validImageUrls rule for order/product images).
function checkReceiptImageUrls(receiptImageUrls) {
    if (receiptImageUrls === undefined || receiptImageUrls === null) {
        return { ok: true, receiptImageUrls: [] };
    }

    const valid =
        Array.isArray(receiptImageUrls) &&
        receiptImageUrls.length <= 6 &&
        receiptImageUrls.every(
            (url) =>
                typeof url === "string" &&
                url.trim().length > 0 &&
                url.length <= 1000
        );

    if (!valid) {
        return {
            ok: false,
            code: "INVALID_RECEIPT_URLS",
            message:
                "Receipt photos must be image URLs (max 6). A receipt photo is optional — you may record the purchase without one.",
        };
    }

    return { ok: true, receiptImageUrls };
}

// The hard purchase rule: actual spending may never exceed the amount
// the passenger explicitly approved. Any excess requires a renewed
// approval (a new estimate + approval cycle), never a silent overrun.
function checkPurchaseWithinApproval(actualCost, approvedMaxAmount) {
    if (!isValidAmount(actualCost)) {
        return {
            ok: false,
            code: "INVALID_AMOUNT",
            message: "Actual cost must be a positive whole number of PKR",
        };
    }

    if (!isValidAmount(approvedMaxAmount)) {
        return {
            ok: false,
            code: "NO_APPROVED_AMOUNT",
            message: "The passenger has not approved a purchase amount yet",
        };
    }

    if (actualCost > approvedMaxAmount) {
        return {
            ok: false,
            code: "ABOVE_APPROVED_AMOUNT",
            message: `Actual cost PKR ${actualCost} exceeds the approved maximum of PKR ${approvedMaxAmount}. Request a cost increase approval first.`,
        };
    }

    return { ok: true };
}

// ---------------------------------------------------------------------------
// Totals — reimbursement is tracked separately from earnings, always.
// ---------------------------------------------------------------------------

// customerTotalPayable = what the passenger owes in total at the door:
// the shopping cost (a reimbursement of the partner's own money) PLUS
// the negotiated delivery fee (the partner's actual service charge).
function computeTotals({ actualCost = null, deliveryFee = null } = {}) {
    const shoppingCost = isValidAmount(actualCost) ? actualCost : 0;
    const fee = isValidAmount(deliveryFee) ? deliveryFee : 0;

    return {
        shoppingCost,
        deliveryFee: fee,
        customerTotalPayable: shoppingCost + fee,
    };
}

// Applies a COD payment (passenger -> partner at delivery, or a later
// top-up confirmation) to an order's reimbursement ledger. Returns the
// new ledger values; `fullyPaid` decides DELIVERED -> COMPLETED.
function applyPayment({ customerTotalPayable = 0, reimbursementReceived = 0, amount = 0 } = {}) {
    const total = Number.isSafeInteger(customerTotalPayable) && customerTotalPayable >= 0
        ? customerTotalPayable
        : 0;
    const already = Number.isSafeInteger(reimbursementReceived) && reimbursementReceived >= 0
        ? reimbursementReceived
        : 0;
    const paid = Number.isSafeInteger(amount) && amount >= 0 ? amount : 0;

    const received = already + paid;

    return {
        reimbursementReceived: received,
        unpaidAmount: Math.max(0, total - received),
        fullyPaid: received >= total,
    };
}

// ---------------------------------------------------------------------------
// Commission — delivery fee ONLY, zero in Auto Free Mode.
// Mirrors the rides/parcels rule (see parcelSettlementService): the
// commission machinery only bites when settings.topUpRequired is true
// AND a payment method is actually configured AND settings are active.
// `driverEarnings` is the partner's net SERVICE income from this order —
// the shopping reimbursement is never part of it.
// ---------------------------------------------------------------------------
function computePurchaseCommission({ deliveryFee = 0, settings = null, paymentsConfiguredFlag = false } = {}) {
    const fee = isValidAmount(deliveryFee) ? deliveryFee : 0;

    const topUpEnforced =
        settings?.topUpRequired === true && paymentsConfiguredFlag === true;

    const basisPoints =
        topUpEnforced && settings.isActive === true
            ? Math.round(settings.percentage * 100)
            : 0;

    const commission =
        Number.isSafeInteger(basisPoints) && basisPoints >= 0 && basisPoints <= 10000
            ? Math.round((fee * basisPoints) / 10000)
            : 0;

    return {
        fare: fee,
        commission,
        commissionPercentage: basisPoints / 100,
        driverEarnings: fee - commission,
        freeMode: commission === 0 && !topUpEnforced,
    };
}

// ---------------------------------------------------------------------------
// Offer acceptance guard (the controller ALSO performs the assignment
// with an atomic status-guarded update; this pure check gives one shared
// definition of "acceptable" and makes the double-accept rule testable:
// after the first acceptance the order leaves BIDDING with a driverId
// set, so any competing acceptance fails here AND at the atomic update).
// ---------------------------------------------------------------------------
function evaluateOfferAcceptance({ order, offer, now = new Date() } = {}) {
    if (!order || !offer) {
        return { ok: false, message: "Offer unavailable or expired" };
    }

    if (order.status !== "BIDDING" || order.driverId) {
        return {
            ok: false,
            message: "This request already has a selected partner",
        };
    }

    if (offer.status !== "PENDING") {
        return { ok: false, message: "Offer unavailable or expired" };
    }

    if (offer.expiresAt && new Date(offer.expiresAt) <= now) {
        return { ok: false, message: "Offer unavailable or expired" };
    }

    return { ok: true };
}

// ---------------------------------------------------------------------------
// Prohibited / restricted goods — conservative default list. Admins can
// replace it via CommissionSettings.buyDeliverBlockedTerms; an empty
// admin list means "use these defaults", never "no restrictions".
// ---------------------------------------------------------------------------
const DEFAULT_BLOCKED_TERMS = [
    "alcohol",
    "liquor",
    "wine",
    "beer",
    "vodka",
    "whisky",
    "whiskey",
    "cigarette",
    "cigarettes",
    "tobacco",
    "vape",
    "vaping",
    "shisha",
    "hookah",
    "weapon",
    "weapons",
    "firearm",
    "firearms",
    "pistol",
    "revolver",
    "ammunition",
    "charas",
    "heroin",
    "cocaine",
    "narcotics",
    "narcotic",
    "methamphetamine",
    "cannabis",
    "marijuana",
];

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Returns the first blocked term found in `text`, or null. Matching is
// case-insensitive and word-boundaried so e.g. "grape" never trips on
// an unrelated substring rule.
function findBlockedTerm(text, terms = DEFAULT_BLOCKED_TERMS) {
    if (typeof text !== "string" || !text.trim()) {
        return null;
    }

    const list = Array.isArray(terms) && terms.length ? terms : DEFAULT_BLOCKED_TERMS;
    const haystack = text.toLowerCase();

    for (const rawTerm of list) {
        const term = String(rawTerm || "").trim().toLowerCase();

        if (!term) continue;

        const pattern = new RegExp(
            `(^|[^a-z0-9])${escapeRegExp(term)}([^a-z0-9]|$)`
        );

        if (pattern.test(haystack)) {
            return term;
        }
    }

    return null;
}

// ---------------------------------------------------------------------------
// Dispute resolution (Phase 7 — ADMIN only).
//
// DISPUTED stays terminal in PURCHASE_TRANSITIONS above ON PURPOSE: no
// passenger/partner action may leave it. Resolution is a separate,
// admin-only outcome set defined HERE (never as ad-hoc status writes in
// a controller), applied by the admin controller through an atomic
// update still guarded on status === "DISPUTED":
//
//   COMPLETED — the order is settled in full: the goods were delivered
//               and the partner is owed their delivery fee. Only
//               possible when a purchase was actually recorded
//               (customerTotalPayable > 0) AND the ledger is fully paid
//               after applying any payment the admin records as part of
//               the resolution.
//   CANCELLED — the order is voided: goods returned / never bought /
//               the claim is not payable. No payment may be recorded
//               with this outcome; any unpaidAmount stays on the record
//               as the (now uncollectable) audit figure.
// ---------------------------------------------------------------------------
const PURCHASE_DISPUTE_OUTCOMES = ["COMPLETED", "CANCELLED"];

function evaluatePurchaseDisputeResolution({ order, outcome, paymentAmount = 0 } = {}) {
    if (!order || order.status !== "DISPUTED") {
        return {
            ok: false,
            code: "ORDER_NOT_DISPUTED",
            message: "Only a disputed order can be resolved",
        };
    }

    if (!PURCHASE_DISPUTE_OUTCOMES.includes(outcome)) {
        return {
            ok: false,
            code: "INVALID_OUTCOME",
            message: "Dispute outcome must be COMPLETED or CANCELLED",
        };
    }

    if (
        paymentAmount !== 0 &&
        paymentAmount !== undefined &&
        paymentAmount !== null &&
        !isValidAmount(paymentAmount)
    ) {
        return {
            ok: false,
            code: "INVALID_AMOUNT",
            message: "Payment amount must be a positive whole number of PKR",
        };
    }

    const recordedPayment = paymentAmount || 0;

    if (outcome === "CANCELLED") {
        if (recordedPayment > 0) {
            return {
                ok: false,
                code: "PAYMENT_WITH_CANCELLATION",
                message: "A payment can only be recorded when resolving a dispute as COMPLETED",
            };
        }

        return { ok: true, toStatus: "CANCELLED", ledger: null };
    }

    // outcome === "COMPLETED"
    const total = Number.isSafeInteger(order.customerTotalPayable)
        ? order.customerTotalPayable
        : 0;

    if (total <= 0) {
        return {
            ok: false,
            code: "NOTHING_TO_SETTLE",
            message:
                "Nothing was purchased on this order, so it cannot be completed — resolve it as CANCELLED instead",
        };
    }

    const ledger = applyPayment({
        customerTotalPayable: total,
        reimbursementReceived: order.reimbursementReceived || 0,
        amount: recordedPayment,
    });

    if (!ledger.fullyPaid) {
        return {
            ok: false,
            code: "ORDER_NOT_FULLY_PAID",
            message: `PKR ${ledger.unpaidAmount} is still unpaid on this order. Record the full remaining payment to complete it, or resolve as CANCELLED.`,
            ledger,
        };
    }

    return { ok: true, toStatus: "COMPLETED", ledger };
}

module.exports = {
    PURCHASE_STATUSES,
    PURCHASE_TRANSITIONS,
    TERMINAL_STATUSES,
    PURCHASE_DISPUTE_OUTCOMES,
    evaluatePurchaseDisputeResolution,
    PRE_PURCHASE_CANCELLABLE,
    POST_PURCHASE_CANCEL_TO_DISPUTE,
    isValidStatus,
    nextStatuses,
    canTransition,
    resolveCancelOutcome,
    canDispute,
    isValidAmount,
    checkAmountWithinCaps,
    ESTIMATE_APPROVAL_SOURCES,
    evaluateBudgetCapApproval,
    checkReceiptImageUrls,
    checkPurchaseWithinApproval,
    computeTotals,
    applyPayment,
    computePurchaseCommission,
    evaluateOfferAcceptance,
    DEFAULT_BLOCKED_TERMS,
    findBlockedTerm,
};
