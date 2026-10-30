import { apiRequest } from "@/lib/api";

// Phase 3 — client wrappers for the Phase 2 multi-service driver APIs
// and the Rental Partner foundation APIs. Response shapes mirror the
// backend controllers exactly (driverServiceController.js,
// rentalPartnerController.js).

export const getMyServices = (token) =>
    apiRequest("/drivers/me/services", { token });

export const applyForService = (service, payload, token) =>
    apiRequest(`/drivers/me/services/${service}/apply`, {
        method: "POST",
        token,
        body: JSON.stringify(payload || {}),
    });

export const updateServiceTransportMode = (service, transportMode, token) =>
    apiRequest(`/drivers/me/services/${service}/transport-mode`, {
        method: "PATCH",
        token,
        body: JSON.stringify({ transportMode }),
    });

export const updateServiceAvailability = (service, enabled, token) =>
    apiRequest(`/drivers/me/services/${service}/availability`, {
        method: "PATCH",
        token,
        body: JSON.stringify({ enabled }),
    });

export const getMyRentalPartner = (token) =>
    apiRequest("/rental-partners/me", { token });

export const applyForRentalPartner = (payload, token) =>
    apiRequest("/rental-partners/apply", {
        method: "POST",
        token,
        body: JSON.stringify(payload || {}),
    });

// T-20: partner-side chauffeur declaration. Without a licence number
// on file an admin can never approve the chauffeur (the approval
// endpoint validates it), so this form is the link that makes the
// whole With-Driver verification flow usable. PATCH
// /rental-partners/me/chauffeur — body: { chauffeurName,
// chauffeurLicenceNumber, chauffeurLicenceExpiry }.
export const updateMyChauffeurDetails = (payload, token) =>
    apiRequest("/rental-partners/me/chauffeur", {
        method: "PATCH",
        token,
        body: JSON.stringify(payload || {}),
    });
