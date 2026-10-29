// Phase 6 — shared presentation helpers for Safar Rentals listings
// and bookings (serialized through the backend masking serializer:
// `id` is the listing id, photos are grouped, pricing keys are
// lowercase per-unit).

export function vehicleIdOf(vehicle) {
    return vehicle?.id || vehicle?._id;
}

export function vehicleTitle(vehicle) {
    return [vehicle?.brand, vehicle?.model, vehicle?.year].filter(Boolean).join(" ") || "Rental vehicle";
}

export function vehiclePhoto(vehicle) {
    const photos = vehicle?.photos || {};
    return photos.exterior?.[0] || photos.interior?.[0] || photos.condition?.[0] || null;
}

export function vehiclePhotos(vehicle) {
    const photos = vehicle?.photos || {};
    return [...(photos.exterior || []), ...(photos.interior || []), ...(photos.condition || [])];
}
