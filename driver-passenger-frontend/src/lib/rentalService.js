import { apiRequest } from "@/lib/api";

// Phase 6 — client wrappers for the Safar Rentals REST API
// (backend Phase 5, routes/rentalRoutes.js). Signatures are
// (args..., token) with the token LAST.
//
// Verified backend notes:
//  - Listings/bookings are serialized masked: exact pickup address
//    + contact only appear on a booking whose status is CONFIRMED
//    or later (vehicle.contactUnlocked === true).
//  - Billing units are HOURLY | DAILY | WEEKLY | MONTHLY; listing
//    pricing keys are the lowercase hourly/daily/weekly/monthly.
//  - POST /rentals/bookings/:id/pickup-otp returns
//    { success, bookingRef, otp } and only works while CONFIRMED.
//  - Partner booking routes live under /rentals/partner/bookings/*;
//    partner vehicle routes under /rentals/vehicles/*.
//  - PATCH /rentals/vehicles/:id/active expects { isActive: boolean }
//    (verified in rentalVehicleController.setRentalVehicleActive).

const asObject = (value, builder) =>
    value && typeof value === "object" ? value : builder(value);

// ------------------------------------------------------------------
// Passenger: search + listings
// ------------------------------------------------------------------

export const searchRentalVehicles = (params = {}, token) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params || {})) {
        if (value !== undefined && value !== null && value !== "") {
            query.set(key, String(value));
        }
    }
    const qs = query.toString();
    return apiRequest(`/rentals/search${qs ? `?${qs}` : ""}`, { token });
};

export const getRentalVehicle = (vehicleId, token) =>
    apiRequest(`/rentals/vehicles/${vehicleId}`, { token });

// ------------------------------------------------------------------
// Passenger: bookings
// ------------------------------------------------------------------

export const createRentalBooking = (payload, token) =>
    apiRequest("/rentals/bookings", {
        method: "POST",
        token,
        body: JSON.stringify(payload),
    });

export const getMyRentalBookings = (token) =>
    apiRequest("/rentals/bookings/mine", { token });

export const getRentalBooking = (id, token) =>
    apiRequest(`/rentals/bookings/${id}`, { token });

export const getRentalFeeInstructions = (id, token) =>
    apiRequest(`/rentals/bookings/${id}/fee-instructions`, { token });

export const submitRentalFeePayment = (id, payload, token) =>
    apiRequest(`/rentals/bookings/${id}/fee-payment`, {
        method: "POST",
        token,
        body: JSON.stringify(payload),
    });

export const getRentalPickupOtp = (id, token) =>
    apiRequest(`/rentals/bookings/${id}/pickup-otp`, {
        method: "POST",
        token,
    });

export const confirmRentalReturn = (id, token) =>
    apiRequest(`/rentals/bookings/${id}/confirm-return`, {
        method: "POST",
        token,
    });

export const cancelRentalBooking = (id, reasonOrPayload, token) => {
    const payload = asObject(reasonOrPayload ?? "", (reason) => ({
        reason: typeof reason === "string" ? reason : "",
    }));
    return apiRequest(`/rentals/bookings/${id}/cancel`, {
        method: "PATCH",
        token,
        body: JSON.stringify(payload),
    });
};

export const rateRentalBooking = (id, payloadOrRating, commentOrToken, maybeToken) => {
    // Supports (id, { rating, comment }, token) and
    // (id, rating, comment, token). Backend handler is
    // rateRentalPartner on POST /rentals/bookings/:id/rate.
    let payload;
    let token;
    if (payloadOrRating && typeof payloadOrRating === "object") {
        payload = payloadOrRating;
        token = commentOrToken;
    } else {
        payload = { rating: payloadOrRating, comment: commentOrToken || "" };
        token = maybeToken;
    }
    return apiRequest(`/rentals/bookings/${id}/rate`, {
        method: "POST",
        token,
        body: JSON.stringify(payload),
    });
};

export const raiseRentalDispute = (id, reasonOrPayload, token) => {
    const payload = asObject(reasonOrPayload, (reason) => ({ reason }));
    return apiRequest(`/rentals/bookings/${id}/dispute`, {
        method: "POST",
        token,
        body: JSON.stringify(payload),
    });
};

// ------------------------------------------------------------------
// Partner: bookings (imported by the partner UI)
// ------------------------------------------------------------------

export const getPartnerRentalBookings = (token) =>
    apiRequest("/rentals/partner/bookings", { token });

export const getPartnerRentalBooking = (id, token) =>
    apiRequest(`/rentals/partner/bookings/${id}`, { token });

export const acceptRentalBooking = (id, token) =>
    apiRequest(`/rentals/partner/bookings/${id}/accept`, {
        method: "POST",
        token,
    });

export const rejectRentalBooking = (id, reasonOrPayload, token) => {
    const payload = asObject(reasonOrPayload ?? "", (reason) => ({
        reason: typeof reason === "string" ? reason : "",
    }));
    return apiRequest(`/rentals/partner/bookings/${id}/reject`, {
        method: "POST",
        token,
        body: JSON.stringify(payload),
    });
};

export const verifyRentalPickup = (id, payload, token) =>
    apiRequest(`/rentals/partner/bookings/${id}/verify-pickup`, {
        method: "POST",
        token,
        body: JSON.stringify(payload),
    });

export const startRental = (id, token) =>
    apiRequest(`/rentals/partner/bookings/${id}/start`, {
        method: "POST",
        token,
    });

export const submitRentalReturn = (id, payload, token) =>
    apiRequest(`/rentals/partner/bookings/${id}/return`, {
        method: "POST",
        token,
        body: JSON.stringify(payload),
    });

// ------------------------------------------------------------------
// Partner: vehicle listings + agreement
// ------------------------------------------------------------------

export const getMyRentalVehicles = (token) =>
    apiRequest("/rentals/vehicles/mine", { token });

export const createRentalVehicle = (payload, token) =>
    apiRequest("/rentals/vehicles", {
        method: "POST",
        token,
        body: JSON.stringify(payload),
    });

export const updateRentalVehicle = (id, payload, token) =>
    apiRequest(`/rentals/vehicles/${id}`, {
        method: "PATCH",
        token,
        body: JSON.stringify(payload),
    });

export const setRentalVehicleActive = (id, isActive, token) =>
    apiRequest(`/rentals/vehicles/${id}/active`, {
        method: "PATCH",
        token,
        body: JSON.stringify({ isActive: Boolean(isActive) }),
    });

export const setRentalVehicleBlockedDates = (id, blockedDates, token) =>
    apiRequest(`/rentals/vehicles/${id}/blocked-dates`, {
        method: "PATCH",
        token,
        body: JSON.stringify({ blockedDates }),
    });

export const deleteRentalVehicle = (id, token) =>
    apiRequest(`/rentals/vehicles/${id}`, {
        method: "DELETE",
        token,
    });

export const getRentalAgreement = (token) =>
    apiRequest("/rentals/agreement", { token });

export const acceptRentalAgreement = (token) =>
    apiRequest("/rentals/agreement/accept", {
        method: "POST",
        token,
    });
