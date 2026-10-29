import { apiRequest } from "@/lib/api";

// Phase 6 — client wrappers for the Buy & Deliver (PurchaseOrder)
// REST API (backend Phase 4, controllers/purchaseController.js).
// Signatures are (args..., token) with the token LAST, mirroring
// driverServicesService.js. Bodies are JSON via apiRequest.
//
// Verified backend notes:
//  - Create reads the delivery point from `delivery` (NOT
//    `deliveryAddress`): createPurchaseOrder below sends BOTH keys
//    with the same { latitude, longitude, address } point so either
//    reader works; the order stores it as a GeoJSON deliveryAddress
//    and falls back to the passenger's HOME saved place when omitted.
//  - GET /purchases/:id/offers enriches each PENDING offer with
//    `driver: { name, rating, ratingCount, vehicle }` — the offer
//    itself carries `driverId` (a Driver record id). The enrichment
//    does NOT expose the driver's User id, so chat callers should
//    pass `offer.driver?.userId || offer.driverId` as partnerUserId.
//  - POST /purchases/:id/otp returns { success, stage, otp } — the
//    plaintext delivery OTP for the passenger to show the partner.
//    It is only available while PURCHASED / OUT_FOR_DELIVERY / ARRIVED.

const asObject = (value, builder) =>
    value && typeof value === "object" ? value : builder(value);

export const createPurchaseOrder = (payload, token) => {
    const point = payload?.delivery || payload?.deliveryAddress || null;
    return apiRequest("/purchases", {
        method: "POST",
        token,
        body: JSON.stringify({
            ...payload,
            ...(point ? { delivery: point, deliveryAddress: point } : {}),
        }),
    });
};

export const getMyPurchaseOrders = (token) =>
    apiRequest("/purchases/my", { token });

export const getPurchaseOrder = (id, token) =>
    apiRequest(`/purchases/${id}`, { token });

export const getPurchaseOffers = (id, token) =>
    apiRequest(`/purchases/${id}/offers`, { token });

export const acceptPurchaseOffer = (id, offerId, token) =>
    apiRequest(`/purchases/${id}/offers/${offerId}/accept`, {
        method: "POST",
        token,
    });

export const approvePurchaseAmount = (id, amountOrPayload, token) => {
    const payload = asObject(amountOrPayload, (amount) => ({ amount }));
    return apiRequest(`/purchases/${id}/approve-amount`, {
        method: "POST",
        token,
        body: JSON.stringify(payload),
    });
};

export const rejectPurchaseEstimate = (id, noteOrPayload, token) => {
    // Accepts (id, token), (id, note, token) or (id, { note }, token).
    let note = "";
    let authToken = token;
    if (token === undefined && typeof noteOrPayload === "string" && noteOrPayload.length > 40) {
        authToken = noteOrPayload;
    } else if (typeof noteOrPayload === "string") {
        note = noteOrPayload;
    } else if (noteOrPayload && typeof noteOrPayload === "object") {
        note = noteOrPayload.note || "";
    }
    return apiRequest(`/purchases/${id}/reject-estimate`, {
        method: "POST",
        token: authToken,
        body: JSON.stringify({ note }),
    });
};

export const regeneratePurchaseOtp = (id, stageOrToken, token) => {
    // Supports (id, token) and (id, stage, token); stage defaults to
    // "DELIVERY" (the only stage the backend accepts).
    const stage = token !== undefined ? stageOrToken : "DELIVERY";
    const authToken = token !== undefined ? token : stageOrToken;
    return apiRequest(`/purchases/${id}/otp`, {
        method: "POST",
        token: authToken,
        body: JSON.stringify({ stage: stage || "DELIVERY" }),
    });
};

export const cancelPurchaseOrder = (id, reasonOrPayload, token) => {
    const payload = asObject(reasonOrPayload ?? "", (reason) => ({
        reason: typeof reason === "string" ? reason : "",
    }));
    return apiRequest(`/purchases/${id}/cancel`, {
        method: "PATCH",
        token,
        body: JSON.stringify(payload),
    });
};

export const confirmPurchasePayment = (id, amountOrPayload, token) => {
    const payload = asObject(amountOrPayload, (amount) => ({ amount }));
    return apiRequest(`/purchases/${id}/confirm-payment`, {
        method: "POST",
        token,
        body: JSON.stringify(payload),
    });
};

export const ratePurchasePartner = (id, payloadOrRating, commentOrToken, maybeToken) => {
    // Supports (id, { rating, comment }, token) and
    // (id, rating, comment, token).
    let payload;
    let token;
    if (payloadOrRating && typeof payloadOrRating === "object") {
        payload = payloadOrRating;
        token = commentOrToken;
    } else {
        payload = { rating: payloadOrRating, comment: commentOrToken || "" };
        token = maybeToken;
    }
    return apiRequest(`/purchases/${id}/rate`, {
        method: "POST",
        token,
        body: JSON.stringify(payload),
    });
};

export const decideSubstitution = (id, payloadOrSubId, approvedOrToken, maybeToken) => {
    // Supports (id, { substitutionId, approved }, token) and
    // (id, substitutionId, approved, token).
    let payload;
    let token;
    if (payloadOrSubId && typeof payloadOrSubId === "object") {
        payload = payloadOrSubId;
        token = approvedOrToken;
    } else {
        payload = { substitutionId: payloadOrSubId, approved: approvedOrToken };
        token = maybeToken;
    }
    return apiRequest(`/purchases/${id}/substitution-decision`, {
        method: "POST",
        token,
        body: JSON.stringify(payload),
    });
};

export const raisePurchaseDispute = (id, reasonOrPayload, token) => {
    const payload = asObject(reasonOrPayload, (reason) => ({ reason }));
    return apiRequest(`/purchases/${id}/dispute`, {
        method: "POST",
        token,
        body: JSON.stringify(payload),
    });
};

// ------------------------------------------------------------------
// Partner (driver) wrappers — imported by the partner UI.
// ------------------------------------------------------------------

export const getAvailablePurchaseRequests = (token) =>
    apiRequest("/purchases/available", { token });

export const submitPurchaseOffer = (id, feeOrPayload, token) => {
    const payload = asObject(feeOrPayload, (deliveryFee) => ({ deliveryFee }));
    return apiRequest(`/purchases/${id}/offers`, {
        method: "POST",
        token,
        body: JSON.stringify(payload),
    });
};

export const withdrawPurchaseOffer = (id, token) =>
    apiRequest(`/purchases/${id}/offers/mine`, {
        method: "DELETE",
        token,
    });

export const getDriverPurchaseTasks = (token) =>
    apiRequest("/purchases/driver/my", { token });

export const getDriverPurchaseDetails = (id, token) =>
    apiRequest(`/purchases/driver/${id}`, { token });

export const startShopping = (id, token) =>
    apiRequest(`/purchases/${id}/start-shopping`, {
        method: "PATCH",
        token,
    });

export const updateShoppingLocation = (id, payload, token) =>
    apiRequest(`/purchases/${id}/shopping-location`, {
        method: "PATCH",
        token,
        body: JSON.stringify(payload),
    });

export const submitCostEstimate = (id, payloadOrAmount, noteOrToken, maybeToken) => {
    // Supports (id, { amount, note }, token) and (id, amount, note, token).
    let payload;
    let token;
    if (payloadOrAmount && typeof payloadOrAmount === "object") {
        payload = payloadOrAmount;
        token = noteOrToken;
    } else {
        payload = { amount: payloadOrAmount, note: noteOrToken || "" };
        token = maybeToken;
    }
    return apiRequest(`/purchases/${id}/cost-estimate`, {
        method: "POST",
        token,
        body: JSON.stringify(payload),
    });
};

export const requestSubstitution = (id, descriptionOrPayload, token) => {
    const payload = asObject(descriptionOrPayload, (description) => ({ description }));
    return apiRequest(`/purchases/${id}/substitution-request`, {
        method: "POST",
        token,
        body: JSON.stringify(payload),
    });
};

export const markPurchased = (id, payload, token) =>
    apiRequest(`/purchases/${id}/purchased`, {
        method: "POST",
        token,
        body: JSON.stringify(payload),
    });

export const markOutForDelivery = (id, token) =>
    apiRequest(`/purchases/${id}/out-for-delivery`, {
        method: "PATCH",
        token,
    });

export const markArrived = (id, token) =>
    apiRequest(`/purchases/${id}/arrived`, {
        method: "PATCH",
        token,
    });

export const deliverPurchaseOrder = (id, payload, token) =>
    apiRequest(`/purchases/${id}/deliver`, {
        method: "POST",
        token,
        body: JSON.stringify(payload),
    });
