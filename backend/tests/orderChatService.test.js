// Phase 6 — Order chat domain-rule tests (plain node, no test
// framework, no DB).
//
// services/orderChatService.js is pure by design, so these tests
// exercise the REAL production event-mapping tables, the lazy
// conversation-closed computation and the outgoing-message validation
// against plain values — the same approach as
// tests/purchaseOrderService.test.js.
//
// Run:  node tests/orderChatService.test.js
// Exit code 0 = all passed, 1 = at least one failure.

const assert = require("node:assert");

const {
    PURCHASE_EVENT_TYPE_MAP,
    RENTAL_EVENT_TYPE_MAP,
    mapPurchaseEventType,
    mapRentalEventType,
    mapEventType,
    mapSenderRole,
    isTerminalOrderStatus,
    computeConversationClosed,
    effectiveConversationStatus,
    eventBelongsInConversation,
    buildEventKey,
    buildOfferEventKey,
    validateOutgoingMessage,
} = require("../src/services/orderChatService");

const tests = [];
function test(name, fn) {
    tests.push({ name, fn });
}

const WINNER = "64b0000000000000000000a1";
const LOSER = "64b0000000000000000000a2";
const PASSENGER_USER = "64b0000000000000000000b1";
const LOSER_USER = "64b0000000000000000000b2";

// ---------------------------------------------------------------------
// Purchase event mapping — every raw type named in the Phase 6 contract
// ---------------------------------------------------------------------

test("purchase: offer / estimate / approval family maps correctly", () => {
    assert.strictEqual(mapPurchaseEventType("OFFER_ACCEPTED"), "OFFER");
    assert.strictEqual(mapPurchaseEventType("COST_ESTIMATE_SUBMITTED"), "ESTIMATE");
    assert.strictEqual(mapPurchaseEventType("ESTIMATE_UPDATED"), "ESTIMATE");
    assert.strictEqual(mapPurchaseEventType("COST_INCREASE_REQUESTED"), "PRICE_INCREASE");
    assert.strictEqual(mapPurchaseEventType("AMOUNT_APPROVED"), "APPROVAL");
    // A rejection is an approval DECISION card; the raw type survives
    // in event.type for the UI.
    assert.strictEqual(mapPurchaseEventType("ESTIMATE_REJECTED"), "APPROVAL");
});

test("purchase: substitution family maps to SUBSTITUTION", () => {
    assert.strictEqual(mapPurchaseEventType("SUBSTITUTION_REQUESTED"), "SUBSTITUTION");
    assert.strictEqual(mapPurchaseEventType("SUBSTITUTION_APPROVED"), "SUBSTITUTION");
    assert.strictEqual(mapPurchaseEventType("SUBSTITUTION_REJECTED"), "SUBSTITUTION");
});

test("purchase: purchase-made and payment events map to PURCHASE_CONFIRMATION", () => {
    assert.strictEqual(mapPurchaseEventType("ITEMS_PURCHASED"), "PURCHASE_CONFIRMATION");
    assert.strictEqual(mapPurchaseEventType("PAYMENT_CONFIRMED"), "PURCHASE_CONFIRMATION");
});

test("purchase: lifecycle events all fall back to STATUS", () => {
    for (const raw of [
        "ORDER_CREATED",
        "SHOPPING_STARTED",
        "OUT_FOR_DELIVERY",
        "ARRIVED",
        "DELIVERED",
        "ORDER_COMPLETED",
        "ORDER_CANCELLED",
        "DISPUTE_RAISED",
        "PARTNER_RATED",
        "REQUEST_OPENED",
    ]) {
        assert.strictEqual(mapPurchaseEventType(raw), "STATUS", raw);
    }
});

test("purchase: an unknown future raw type still maps to STATUS", () => {
    assert.strictEqual(mapPurchaseEventType("SOME_FUTURE_EVENT"), "STATUS");
    assert.strictEqual(mapEventType("PURCHASE", "SOME_FUTURE_EVENT"), "STATUS");
});

// ---------------------------------------------------------------------
// Rental event mapping
// ---------------------------------------------------------------------

test("rental: fee / handover / return family maps correctly", () => {
    assert.strictEqual(mapRentalEventType("FEE_PAYMENT_SUBMITTED"), "BOOKING_FEE");
    assert.strictEqual(mapRentalEventType("PICKUP_VERIFIED"), "HANDOVER");
    assert.strictEqual(mapRentalEventType("RENTAL_STARTED"), "HANDOVER");
    assert.strictEqual(mapRentalEventType("RETURN_RECORDED"), "RETURN");
    assert.strictEqual(mapRentalEventType("RETURN_CONFIRMED"), "RETURN");
});

test("rental: everything else falls back to STATUS", () => {
    for (const raw of [
        "BOOKING_REQUESTED",
        "BOOKING_ACCEPTED",
        "BOOKING_DECLINED",
        "BOOKING_CANCELLED",
        "NO_SHOW_MARKED",
        "DISPUTE_RAISED",
        "PARTNER_RATED",
        "HOLD_EXPIRED",
        "SOME_FUTURE_EVENT",
    ]) {
        assert.strictEqual(mapRentalEventType(raw), "STATUS", raw);
        assert.strictEqual(mapEventType("RENTAL", raw), "STATUS", raw);
    }
});

test("mapping tables are exported and consistent with the mappers", () => {
    for (const [raw, mapped] of Object.entries(PURCHASE_EVENT_TYPE_MAP)) {
        assert.strictEqual(mapPurchaseEventType(raw), mapped, raw);
    }
    for (const [raw, mapped] of Object.entries(RENTAL_EVENT_TYPE_MAP)) {
        assert.strictEqual(mapRentalEventType(raw), mapped, raw);
    }
});

// ---------------------------------------------------------------------
// Sender role mapping
// ---------------------------------------------------------------------

test("senderRole: parties pass through, ADMIN/SYSTEM become SYSTEM", () => {
    assert.strictEqual(mapSenderRole("PASSENGER"), "PASSENGER");
    assert.strictEqual(mapSenderRole("DRIVER"), "DRIVER");
    assert.strictEqual(mapSenderRole("PARTNER"), "PARTNER");
    assert.strictEqual(mapSenderRole("ADMIN"), "SYSTEM");
    assert.strictEqual(mapSenderRole("SYSTEM"), "SYSTEM");
    assert.strictEqual(mapSenderRole(undefined), "SYSTEM");
});

// ---------------------------------------------------------------------
// Closed-conversation computation
// ---------------------------------------------------------------------

test("closed: pre-assignment bidder thread is open", () => {
    assert.strictEqual(
        computeConversationClosed({
            orderType: "PURCHASE",
            orderStatus: "BIDDING",
            orderDriverId: null,
            partnerRefId: LOSER,
        }),
        false
    );
});

test("closed: losing bidder closes once a driver is assigned", () => {
    assert.strictEqual(
        computeConversationClosed({
            orderType: "PURCHASE",
            orderStatus: "DRIVER_SELECTED",
            orderDriverId: WINNER,
            partnerRefId: LOSER,
        }),
        true
    );
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

test("closed: winner thread stays open through the working states", () => {
    for (const status of ["DRIVER_SELECTED", "SHOPPING", "DELIVERED"]) {
        assert.strictEqual(
            computeConversationClosed({
                orderType: "PURCHASE",
                orderStatus: status,
                orderDriverId: WINNER,
                partnerRefId: WINNER,
            }),
            false,
            status
        );
    }
});

test("closed: terminal purchase status closes even the winner thread", () => {
    for (const status of ["COMPLETED", "CANCELLED", "FAILED", "DISPUTED"]) {
        assert.strictEqual(isTerminalOrderStatus("PURCHASE", status), true, status);
        assert.strictEqual(
            computeConversationClosed({
                orderType: "PURCHASE",
                orderStatus: status,
                orderDriverId: WINNER,
                partnerRefId: WINNER,
            }),
            true,
            status
        );
    }
});

test("closed: rental terminal statuses close the thread, live ones do not", () => {
    for (const status of ["COMPLETED", "CANCELLED", "NO_SHOW", "DISPUTED"]) {
        assert.strictEqual(isTerminalOrderStatus("RENTAL", status), true, status);
        assert.strictEqual(
            computeConversationClosed({ orderType: "RENTAL", orderStatus: status }),
            true,
            status
        );
    }
    for (const status of ["REQUESTED", "CONFIRMED", "RENTAL_ACTIVE", "RETURN_PENDING"]) {
        assert.strictEqual(
            computeConversationClosed({ orderType: "RENTAL", orderStatus: status }),
            false,
            status
        );
    }
    // FAILED is a purchase terminal, NOT a rental one.
    assert.strictEqual(isTerminalOrderStatus("RENTAL", "FAILED"), false);
    assert.strictEqual(isTerminalOrderStatus("PURCHASE", "NO_SHOW"), false);
});

test("closed: a stored CLOSED status always wins", () => {
    assert.strictEqual(
        computeConversationClosed({
            orderType: "RENTAL",
            orderStatus: "CONFIRMED",
            storedStatus: "CLOSED",
        }),
        true
    );
});

// ---------------------------------------------------------------------
// Per-thread event visibility
// ---------------------------------------------------------------------

test("visibility: winner thread receives every purchase event", () => {
    assert.strictEqual(
        eventBelongsInConversation({
            orderType: "PURCHASE",
            rawType: "SHOPPING_STARTED",
            actorId: PASSENGER_USER,
            partnerUserId: "64b0000000000000000000b9",
            partnerRefId: WINNER,
            orderDriverId: WINNER,
        }),
        true
    );
});

test("visibility: bidder thread gets ORDER_CREATED and only its own events", () => {
    const base = {
        orderType: "PURCHASE",
        partnerUserId: LOSER_USER,
        partnerRefId: LOSER,
        orderDriverId: null,
    };
    assert.strictEqual(
        eventBelongsInConversation({ ...base, rawType: "ORDER_CREATED", actorId: PASSENGER_USER }),
        true
    );
    assert.strictEqual(
        eventBelongsInConversation({ ...base, rawType: "SHOPPING_STARTED", actorId: LOSER_USER }),
        true
    );
    assert.strictEqual(
        eventBelongsInConversation({ ...base, rawType: "AMOUNT_APPROVED", actorId: PASSENGER_USER }),
        false
    );
    // After assignment the loser still only sees their own events.
    assert.strictEqual(
        eventBelongsInConversation({
            ...base,
            orderDriverId: WINNER,
            rawType: "ITEMS_PURCHASED",
            actorId: PASSENGER_USER,
        }),
        false
    );
});

test("visibility: rental threads receive every booking event", () => {
    assert.strictEqual(
        eventBelongsInConversation({
            orderType: "RENTAL",
            rawType: "BOOKING_CANCELLED",
            actorId: PASSENGER_USER,
            partnerUserId: LOSER_USER,
            partnerRefId: LOSER,
            orderDriverId: null,
        }),
        true
    );
});

// ---------------------------------------------------------------------
// Event keys
// ---------------------------------------------------------------------

test("event keys are stable and distinct per position/type/offer", () => {
    assert.strictEqual(
        buildEventKey("PURCHASE", "abc123", 4, "AMOUNT_APPROVED"),
        "PURCHASE:abc123:4:AMOUNT_APPROVED"
    );
    assert.notStrictEqual(
        buildEventKey("PURCHASE", "abc123", 4, "AMOUNT_APPROVED"),
        buildEventKey("PURCHASE", "abc123", 5, "AMOUNT_APPROVED")
    );
    assert.strictEqual(buildOfferEventKey("offer42"), "offer:offer42");
});

// ---------------------------------------------------------------------
// Outgoing message validation
// ---------------------------------------------------------------------

test("validation: TEXT requires 1-1000 chars and a clientMessageId", () => {
    assert.strictEqual(
        validateOutgoingMessage({ kind: "TEXT", body: " hello ", clientMessageId: "c1" }).valid,
        true
    );
    assert.strictEqual(
        validateOutgoingMessage({ kind: "TEXT", body: " hello ", clientMessageId: "c1" }).body,
        "hello"
    );
    assert.strictEqual(validateOutgoingMessage({ kind: "TEXT", body: "", clientMessageId: "c1" }).valid, false);
    assert.strictEqual(validateOutgoingMessage({ kind: "TEXT", body: "   ", clientMessageId: "c1" }).valid, false);
    assert.strictEqual(
        validateOutgoingMessage({ kind: "TEXT", body: "x".repeat(1001), clientMessageId: "c1" }).valid,
        false
    );
    assert.strictEqual(
        validateOutgoingMessage({ kind: "TEXT", body: "x".repeat(1000), clientMessageId: "c1" }).valid,
        true
    );
    assert.strictEqual(validateOutgoingMessage({ kind: "TEXT", body: "hi" }).valid, false);
    assert.strictEqual(validateOutgoingMessage({ kind: "TEXT", body: "hi", clientMessageId: " " }).valid, false);
});

test("validation: IMAGE requires imageUrl, caption is optional up to 1000", () => {
    const ok = validateOutgoingMessage({
        kind: "IMAGE",
        imageUrl: "https://cdn.example/x.jpg",
        clientMessageId: "c2",
    });
    assert.strictEqual(ok.valid, true);
    assert.strictEqual(ok.body, "");
    assert.strictEqual(
        validateOutgoingMessage({ kind: "IMAGE", body: "cap", clientMessageId: "c2" }).valid,
        false
    );
    assert.strictEqual(
        validateOutgoingMessage({
            kind: "IMAGE",
            imageUrl: "https://cdn.example/x.jpg",
            body: "y".repeat(1001),
            clientMessageId: "c2",
        }).valid,
        false
    );
});

test("validation: AUDIO accepts a valid voice message and normalizes its fields", () => {
    const ok = validateOutgoingMessage({
        kind: "AUDIO",
        audioUrl: " https://cdn.example/voice.webm ",
        audioMime: "audio/webm",
        audioDurationSec: 12.5,
        body: " listen ",
        clientMessageId: "c4",
    });
    assert.strictEqual(ok.valid, true);
    assert.strictEqual(ok.kind, "AUDIO");
    assert.strictEqual(ok.audioUrl, "https://cdn.example/voice.webm");
    assert.strictEqual(ok.audioMime, "audio/webm");
    assert.strictEqual(ok.audioDurationSec, 12.5);
    assert.strictEqual(ok.body, "listen");
    assert.strictEqual(ok.imageUrl, "");

    // Caption, mime and duration are all optional.
    const bare = validateOutgoingMessage({
        kind: "AUDIO",
        audioUrl: "https://cdn.example/voice.webm",
        clientMessageId: "c4",
    });
    assert.strictEqual(bare.valid, true);
    assert.strictEqual(bare.body, "");
    assert.strictEqual(bare.audioMime, "");
    assert.strictEqual(bare.audioDurationSec, null);

    // Boundary durations are accepted.
    for (const d of [0, 600]) {
        assert.strictEqual(
            validateOutgoingMessage({
                kind: "AUDIO",
                audioUrl: "https://cdn.example/v.webm",
                audioDurationSec: d,
                clientMessageId: "c4",
            }).valid,
            true,
            `duration ${d}`
        );
    }
});

test("validation: AUDIO rejects missing/blank and over-long audioUrl", () => {
    assert.strictEqual(
        validateOutgoingMessage({ kind: "AUDIO", clientMessageId: "c5" }).valid,
        false
    );
    assert.strictEqual(
        validateOutgoingMessage({ kind: "AUDIO", audioUrl: "   ", clientMessageId: "c5" }).valid,
        false
    );
    assert.strictEqual(
        validateOutgoingMessage({
            kind: "AUDIO",
            audioUrl: `https://cdn.example/${"x".repeat(1000)}`,
            clientMessageId: "c5",
        }).valid,
        false
    );
    assert.strictEqual(
        validateOutgoingMessage({
            kind: "AUDIO",
            audioUrl: "https://cdn.example/v.webm",
            body: "y".repeat(1001),
            clientMessageId: "c5",
        }).valid,
        false,
        "over-long caption"
    );
    assert.strictEqual(
        validateOutgoingMessage({
            kind: "AUDIO",
            audioUrl: "https://cdn.example/v.webm",
            audioMime: "m".repeat(101),
            clientMessageId: "c5",
        }).valid,
        false,
        "over-long mime"
    );
});

test("validation: AUDIO rejects out-of-range or non-numeric durations", () => {
    for (const d of [-1, 600.01, 601, "abc", NaN]) {
        assert.strictEqual(
            validateOutgoingMessage({
                kind: "AUDIO",
                audioUrl: "https://cdn.example/v.webm",
                audioDurationSec: d,
                clientMessageId: "c6",
            }).valid,
            false,
            `duration ${d}`
        );
    }
});

test("validation: EVENT and unknown kinds can never be sent by clients", () => {
    assert.strictEqual(
        validateOutgoingMessage({ kind: "EVENT", body: "hi", clientMessageId: "c3" }).valid,
        false
    );
    assert.strictEqual(
        validateOutgoingMessage({ kind: "VIDEO", body: "hi", clientMessageId: "c3" }).valid,
        false
    );
    assert.strictEqual(validateOutgoingMessage({}).valid, false);
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
