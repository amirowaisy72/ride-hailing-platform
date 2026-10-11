import { apiRequest } from "@/lib/api";

// Keep route and reverse-geocoding endpoints compatible with the existing backend.
const memo = new Map();
const MAX_CACHE = 80;
const CACHE_MS = 90_000;
const normalize = (value) => String(value || "").trim().replace(/\s+/g, " ");
const strip = (value) => value.toLocaleLowerCase("en").normalize("NFKC");

function decorate(place) {
    const full = normalize(place.display_name || place.displayName || place.name);
    const segments = full.split(",").map(normalize).filter(Boolean);
    const primary = normalize(place.name) || segments[0] || "Selected place";
    const city = segments.slice(1).find((part) => strip(part) !== strip(primary)) || "";
    // Display a concise label, but preserve the complete original address.
    const label = [primary, city].filter(Boolean).join(", ");
    return { ...place, name: label, display_name: full, shortName: primary, subtitle: segments.slice(1, 3).join(", ") };
}

async function queryProvider(q, token, userLocation) {
    const params = new URLSearchParams({ q });
    if (Number.isFinite(userLocation?.latitude) && Number.isFinite(userLocation?.longitude)) {
        params.set("latitude", String(userLocation.latitude));
        params.set("longitude", String(userLocation.longitude));
    }
    const data = await apiRequest(`/locations/search?${params}`, { token });
    return Array.isArray(data.locations) ? data.locations : [];
}

export async function searchLocations(query, token, userLocation) {
    const q = normalize(query);
    if (q.length < 3) return [];
    const key = `${strip(q)}|${Number(userLocation?.latitude || 0).toFixed(2)}|${Number(userLocation?.longitude || 0).toFixed(2)}`;
    const cached = memo.get(key);
    if (cached && Date.now() - cached.at < CACHE_MS) return cached.items;

    let results = await queryProvider(q, token, userLocation);
    // For sparse POI coverage, retry only after an empty result, not on every keystroke.
    // This improves local disambiguation but cannot invent missing map-provider entries.
    if (!results.length && !/\bkhanpur\b/i.test(q) && q.length >= 5) {
        try { results = await queryProvider(`${q}, Khanpur`, token, userLocation); } catch { /* Retain initial empty results. */ }
    }
    const seen = new Set();
    const items = results.filter((place) => {
        const lat = Number(place.latitude ?? place.lat);
        const lng = Number(place.longitude ?? place.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
        const id = `${lat.toFixed(6)}:${lng.toFixed(6)}`;
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
    }).map((place) => ({ ...decorate(place), latitude: Number(place.latitude ?? place.lat), longitude: Number(place.longitude ?? place.lon) }));
    if (memo.size >= MAX_CACHE) memo.delete(memo.keys().next().value);
    memo.set(key, { at: Date.now(), items });
    return items;
}

export async function reverseGeocode(latitude, longitude, token) {
    const params = new URLSearchParams({ latitude: String(latitude), longitude: String(longitude) });
    const data = await apiRequest(`/locations/reverse?${params}`, { token });
    return data.location;
}

export async function calculateRoute(pickup, destination, token) {
    const data = await apiRequest("/locations/route", {
        method: "POST", token, body: JSON.stringify({ pickup, destination }),
    });
    return data.route;
}
