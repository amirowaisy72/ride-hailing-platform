const SavedPlace = require("../models/SavedPlace");

// ---------------------------------------------------------------------------
// "Near <saved place>" fallback (Amir review A4 — location-name
// reliability).
//
// When every reverse-geocoding provider fails for the caller's current
// coordinates, a raw "lat, lng" string is the worst possible label. If the
// caller has a SavedPlace (HOME / WORK / FAVORITE) within ~2 km, the point
// is almost certainly "at or near" that place, so the reverse-geocode
// endpoint answers 200 with:
//
//   { name: "Near <place name>", latitude, longitude, source: "saved-place" }
//
// The returned coordinates are the REQUESTED point (not the place's own
// coordinates) so downstream pickup/drop-off logic keeps the exact GPS
// fix; only the human-readable name is borrowed from the saved place.
//
// findNearestSavedPlace() is a pure function over plain place records so
// it is unit-testable without a database; nearestSavedPlaceLocation() is
// the thin DB-backed wrapper the controller calls.
// ---------------------------------------------------------------------------

const NEARBY_RADIUS_KM = 2;

function haversineKm(lat1, lon1, lat2, lon2) {
    const rad = Math.PI / 180;
    const dLat = (lat2 - lat1) * rad;
    const dLon = (lon2 - lon1) * rad;

    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1 * rad) *
            Math.cos(lat2 * rad) *
            Math.sin(dLon / 2) ** 2;

    return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Pick the closest place within radiusKm of (latitude, longitude).
// Returns { place, distanceKm } or null when nothing is near (or the
// inputs are unusable). Places with invalid coordinates are skipped.
function findNearestSavedPlace(places, latitude, longitude, radiusKm = NEARBY_RADIUS_KM) {
    const lat = Number(latitude);
    const lon = Number(longitude);

    if (
        !Array.isArray(places) ||
        !Number.isFinite(lat) ||
        !Number.isFinite(lon) ||
        Math.abs(lat) > 90 ||
        Math.abs(lon) > 180
    ) {
        return null;
    }

    let nearest = null;

    for (const place of places) {
        const placeLat = Number(place?.latitude);
        const placeLon = Number(place?.longitude);

        if (
            !Number.isFinite(placeLat) ||
            !Number.isFinite(placeLon) ||
            Math.abs(placeLat) > 90 ||
            Math.abs(placeLon) > 180 ||
            typeof place?.name !== "string" ||
            !place.name.trim()
        ) {
            continue;
        }

        const distanceKm = haversineKm(lat, lon, placeLat, placeLon);

        if (distanceKm <= radiusKm && (!nearest || distanceKm < nearest.distanceKm)) {
            nearest = { place, distanceKm };
        }
    }

    return nearest;
}

function savedPlaceLocation(place, latitude, longitude) {
    return {
        name: `Near ${place.name}`,
        latitude: Number(latitude),
        longitude: Number(longitude),
        source: "saved-place",
    };
}

// DB-backed lookup for one user. Returns the "Near <place>" location
// object, or null when the user has no saved place within the radius.
async function nearestSavedPlaceLocation(userId, latitude, longitude) {
    if (!userId) {
        return null;
    }

    const places = await SavedPlace.find({ userId }).lean();
    const nearest = findNearestSavedPlace(places, latitude, longitude);

    if (!nearest) {
        return null;
    }

    return savedPlaceLocation(nearest.place, latitude, longitude);
}

module.exports = {
    NEARBY_RADIUS_KM,
    haversineKm,
    findNearestSavedPlace,
    savedPlaceLocation,
    nearestSavedPlaceLocation,
};
