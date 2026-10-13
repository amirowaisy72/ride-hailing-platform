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
    const city = normalize(place.address?.city || place.address?.town || place.address?.village || place.city) || segments.slice(1).find((part) => strip(part) !== strip(primary) && !/^\d{4,}$/.test(part)) || "";
    // Display a concise label, but preserve the complete original address.
    const label = [primary, city].filter(Boolean).join(", ");
    return { ...place, name: label, display_name: full, shortName: primary, city, subtitle: [city, ...segments.slice(1).filter((part) => strip(part) !== strip(city)).slice(0, 1)].filter(Boolean).join(", ") };
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
    // Supplement sparse results with local context, without inventing POIs.
    // Keep requests sequential to avoid unnecessary pressure on the geocoder.
    if (results.length < 5 && !/\bkhanpur\b/i.test(q) && q.length >= 4 &&
        Number.isFinite(userLocation?.latitude) && Number.isFinite(userLocation?.longitude) &&
        Math.abs(userLocation.latitude - 28.65) < 0.5 && Math.abs(userLocation.longitude - 70.66) < 0.5) {
        try {
            const local = await queryProvider(`${q}, Khanpur`, token, userLocation);
            results = [...results, ...local];
        } catch { /* Keep initial results when locality search fails. */ }
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

// Approximate straight-line distance for suggestion display (not driving distance).
export function placeDistanceKm(from, to) {
    const a = Number(from?.latitude), b = Number(from?.longitude);
    const c = Number(to?.latitude), d = Number(to?.longitude);
    if (![a, b, c, d].every(Number.isFinite)) return null;
    const rad = Math.PI / 180;
    const h = Math.sin((c - a) * rad / 2) ** 2 + Math.cos(a * rad) * Math.cos(c * rad) * Math.sin((d - b) * rad / 2) ** 2;
    return 12742 * Math.asin(Math.min(1, Math.sqrt(h)));
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
