// ---------------------------------------------------------------------------
// Phase 6 — Order chat (Buy & Deliver + Rentals) pure domain rules.
//
// This module is deliberately PURE — no database access, no model
// imports — so the rules can be unit-tested without MongoDB (see
// backend/tests/orderChatService.test.js), exactly like
// services/purchaseOrderService.js and services/rentalBookingService.js.
//
// Core rule of the whole feature: chat NEVER writes amounts. EVENT
// messages shown in a thread are materialized by the controller from
// the order's own server-validated events[] log and from PurchaseOffer
// records; the mapping tables below are the single source of truth for
// how a raw order event becomes a structured chat card.
// ---------------------------------------------------------------------------

// --- Raw order event type -> structured chat eventType ---------------------

const PURCHASE_EVENT_TYPE_MAP = {
    // OFFER_ACCEPTED also becomes an OFFER card (its amount is the
    // accepted delivery fee); the per-driver offer SNAPSHOT card is
    // synced separately from the PurchaseOffer record itself.
    OFFER_ACCEPTED: "OFFER",
    COST_ESTIMATE_SUBMITTED: "ESTIMATE",
    ESTIMATE_UPDATED: "ESTIMATE",
    COST_INCREASE_REQUESTED: "PRICE_INCREASE",
    AMOUNT_APPROVED: "APPROVAL",
    // Budget-cap auto-approval (A13): an approval decision made by the
    // system under the passenger's stated budget, not by the passenger.
    ESTIMATE_AUTO_APPROVED: "APPROVAL",
    // ESTIMATE_REJECTED is an approval DECISION (a "no"); the raw type
    // is preserved in event.type so the UI can distinguish it from an
    // approval.
    ESTIMATE_REJECTED: "APPROVAL",
    SUBSTITUTION_REQUESTED: "SUBSTITUTION",
    SUBSTITUTION_APPROVED: "SUBSTITUTION",
    SUBSTITUTION_REJECTED: "SUBSTITUTION",
    ITEMS_PURCHASED: "PURCHASE_CONFIRMATION",
    PAYMENT_CONFIRMED: "PURCHASE_CONFIRMATION",
    // Everything else on a purchase order (ORDER_CREATED,
    // SHOPPING_STARTED, OUT_FOR_DELIVERY, ARRIVED, DELIVERED,
    // ORDER_COMPLETED, ORDER_CANCELLED, DISPUTE_RAISED, PARTNER_RATED,
    // REQUEST_OPENED, and any future raw type) is a plain STATUS card.
};

const RENTAL_EVENT_TYPE_MAP = {
    FEE_PAYMENT_SUBMITTED: "BOOKING_FEE",
    PICKUP_VERIFIED: "HANDOVER",
    RENTAL_STARTED: "HANDOVER",
    RETURN_RECORDED: "RETURN",
    RETURN_CONFIRMED: "RETURN",
    // Everything else on a rental booking is a plain STATUS card.
};

function mapPurchaseEventType(rawType) {
    return PURCHASE_EVENT_TYPE_MAP[rawType] || "STATUS";
}

function mapRentalEventType(rawType) {
    return RENTAL_EVENT_TYPE_MAP[rawType] || "STATUS";
}

function mapEventType(orderType, rawType) {
    return orderType === "RENTAL"
        ? mapRentalEventType(rawType)
        : mapPurchaseEventType(rawType);
}

// --- Actor role -> chat senderRole ------------------------------------------
// Order events carry actorRole PASSENGER / DRIVER / PARTNER / ADMIN /
// SYSTEM. Chat senderRoles are PASSENGER / DRIVER / PARTNER / SYSTEM:
// anything that is not one of the three parties (ADMIN, SYSTEM, or an
// unknown value) is presented as SYSTEM.

function mapSenderRole(actorRole) {
    if (actorRole === "PASSENGER") return "PASSENGER";
    if (actorRole === "DRIVER") return "DRIVER";
    if (actorRole === "PARTNER") return "PARTNER";
    return "SYSTEM";
}

// --- Terminal order statuses -------------------------------------------------
// Mirrors TERMINAL_STATUSES in purchaseOrderService /
// rentalBookingService (duplicated here so this module stays pure and
// import-free; the tests pin these lists).

const PURCHASE_TERMINAL_STATUSES = ["COMPLETED", "CANCELLED", "FAILED", "DISPUTED"];
const RENTAL_TERMINAL_STATUSES = ["COMPLETED", "CANCELLED", "NO_SHOW", "DISPUTED"];

function isTerminalOrderStatus(orderType, status) {
    return orderType === "RENTAL"
        ? RENTAL_TERMINAL_STATUSES.includes(status)
        : PURCHASE_TERMINAL_STATUSES.includes(status);
}

// --- Conversation closed computation (lazy) ----------------------------------
// A conversation is closed for POSTING when ANY of these hold:
//  - its stored status is already CLOSED;
//  - PURCHASE: an assigned driver exists and this thread's partner is
//    not that driver (a losing bidder's thread closes at assignment);
//  - the order/booking has reached a terminal status (this also closes
//    the WINNER's thread — history stays readable, posting stops).
//
// Inputs are plain ids/status strings so the rule is testable without
// Mongoose documents.
function computeConversationClosed({
    orderType,
    orderStatus,
    orderDriverId = null,
    partnerRefId = null,
    storedStatus = "ACTIVE",
} = {}) {
    if (storedStatus === "CLOSED") return true;

    if (isTerminalOrderStatus(orderType, orderStatus)) return true;

    if (orderType === "PURCHASE" && orderDriverId) {
        if (String(partnerRefId || "") !== String(orderDriverId)) return true;
    }

    return false;
}

function effectiveConversationStatus(input) {
    return computeConversationClosed(input) ? "CLOSED" : "ACTIVE";
}

// --- Which order events belong in a given thread ------------------------------
// The ASSIGNED partner's thread receives every order event. A
// PRE-assignment bidder thread (and, after assignment, a losing
// bidder's thread) receives only the events that concern that bidder:
// their own actions (actorId === their user id) plus ORDER_CREATED,
// which opens every thread. Their OFFER snapshot card is synced
// separately from the PurchaseOffer record.
function eventBelongsInConversation({ orderType, rawType, actorId, partnerUserId, partnerRefId, orderDriverId }) {
    if (orderType === "RENTAL") return true;

    const isWinner =
        !!orderDriverId && String(partnerRefId || "") === String(orderDriverId);
    if (isWinner) return true;

    if (rawType === "ORDER_CREATED") return true;

    return !!actorId && !!partnerUserId && String(actorId) === String(partnerUserId);
}

// Idempotency key for a synced order event: position in the append-only
// events[] array plus the raw type makes re-syncs skip existing cards.
function buildEventKey(orderType, orderId, index, rawType) {
    return `${orderType}:${orderId}:${index}:${rawType}`;
}

function buildOfferEventKey(offerId) {
    return `offer:${offerId}`;
}

// --- Outgoing participant message validation (pure) ---------------------------
// Returns { valid: true, kind, body, imageUrl } with the body trimmed,
// or { valid: false, message }. AUDIO additionally returns
// { audioUrl, audioMime, audioDurationSec }.
function validateOutgoingMessage({
    kind,
    body,
    imageUrl,
    audioUrl,
    audioMime,
    audioDurationSec,
    clientMessageId,
} = {}) {
    if (typeof clientMessageId !== "string" || !clientMessageId.trim()) {
        return { valid: false, message: "clientMessageId is required" };
    }

    if (kind !== "TEXT" && kind !== "IMAGE" && kind !== "AUDIO") {
        return { valid: false, message: 'kind must be "TEXT", "IMAGE" or "AUDIO"' };
    }

    const cleanBody = typeof body === "string" ? body.trim() : "";
    const cleanImageUrl = typeof imageUrl === "string" ? imageUrl.trim() : "";

    if (kind === "TEXT") {
        if (cleanBody.length < 1 || cleanBody.length > 1000) {
            return {
                valid: false,
                message: "Message must contain 1–1000 characters",
            };
        }
        return { valid: true, kind, body: cleanBody, imageUrl: "" };
    }

    if (kind === "IMAGE") {
        if (!cleanImageUrl) {
            return { valid: false, message: "imageUrl is required for an image message" };
        }
        if (cleanBody.length > 1000) {
            return {
                valid: false,
                message: "Caption must contain at most 1000 characters",
            };
        }
        return { valid: true, kind, body: cleanBody, imageUrl: cleanImageUrl };
    }

    // AUDIO
    const cleanAudioUrl = typeof audioUrl === "string" ? audioUrl.trim() : "";
    if (!cleanAudioUrl) {
        return { valid: false, message: "audioUrl is required for an audio message" };
    }
    if (cleanAudioUrl.length > 1000) {
        return {
            valid: false,
            message: "audioUrl must contain at most 1000 characters",
        };
    }
    if (cleanBody.length > 1000) {
        return {
            valid: false,
            message: "Caption must contain at most 1000 characters",
        };
    }
    const cleanAudioMime = typeof audioMime === "string" ? audioMime.trim() : "";
    if (cleanAudioMime.length > 100) {
        return {
            valid: false,
            message: "audioMime must contain at most 100 characters",
        };
    }
    let cleanAudioDurationSec = null;
    if (audioDurationSec !== undefined && audioDurationSec !== null && audioDurationSec !== "") {
        const duration = Number(audioDurationSec);
        if (!Number.isFinite(duration) || duration < 0 || duration > 600) {
            return {
                valid: false,
                message: "audioDurationSec must be a number between 0 and 600",
            };
        }
        cleanAudioDurationSec = duration;
    }
    return {
        valid: true,
        kind,
        body: cleanBody,
        imageUrl: "",
        audioUrl: cleanAudioUrl,
        audioMime: cleanAudioMime,
        audioDurationSec: cleanAudioDurationSec,
    };
}

module.exports = {
    PURCHASE_EVENT_TYPE_MAP,
    RENTAL_EVENT_TYPE_MAP,
    PURCHASE_TERMINAL_STATUSES,
    RENTAL_TERMINAL_STATUSES,
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
};
