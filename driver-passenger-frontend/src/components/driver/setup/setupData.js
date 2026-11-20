import { apiRequest } from "@/lib/api";

export const DRIVER_STATUS_CACHE_KEY = "safar-driver-status";
export const DRIVER_SETUP_DETAILS_CACHE_KEY = "safar-driver-setup-details";

export const getDriverStatusKey = (token) =>
    token ? [DRIVER_STATUS_CACHE_KEY, token] : null;

export const getDriverSetupDetailsKey = (token) =>
    token ? [DRIVER_SETUP_DETAILS_CACHE_KEY, token] : null;

export const fetchDriverStatus = ([, token]) =>
    apiRequest("/drivers/me/status", { token });

export const fetchDriverSetupDetails = async ([, token]) => {
    const [vehicleData, serviceData] = await Promise.all([
        apiRequest("/drivers/me/vehicles", { token }),
        apiRequest("/drivers/me/services", { token }),
    ]);

    return { vehicleData, serviceData };
};

// Retroactive photo check (Safar To-Do #16): the vehicle photo
// (number plate clearly readable) and the profile photo are required
// of EVERY driver, including drivers approved before the rule existed.
// These helpers are shared by the approved-driver gate; the documents
// page keeps its own copy so the new-driver flow is untouched.
export const RETROACTIVE_PHOTO_TYPES = ["VEHICLE_PHOTO", "PROFILE_PHOTO"];

export const fetchMyDocuments = async (token) => {
    const result = await apiRequest("/drivers/me/documents", { token });
    return Array.isArray(result?.documents) ? result.documents : [];
};

export function validateDocumentImage(file) {
    if (!file) return "Please choose a file first.";
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
        return "Only JPG, PNG and WebP images are supported.";
    }
    if (file.size > 10 * 1024 * 1024) {
        return "Maximum file size is 10 MB.";
    }
    return "";
}

// Neither photo takes an expiry date — same as the documents page.
export async function uploadDriverDocument(token, type, file) {
    const formData = new FormData();
    formData.append("documentType", type);
    formData.append("document", file);
    const result = await apiRequest("/drivers/me/documents", {
        method: "POST",
        token,
        body: formData,
    });
    return result.document;
}

// Newest live row per document type (rows are deduplicated
// server-side, but take the newest by createdAt so any legacy
// duplicate can never resurrect an old status).
export function latestDocumentByType(rows) {
    const latestByType = new Map();
    [...(rows || [])]
        .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
        .forEach((row) => {
            if (row?.documentType && !latestByType.has(row.documentType)) {
                latestByType.set(row.documentType, row);
            }
        });
    return latestByType;
}
