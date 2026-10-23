import { apiRequest } from "@/lib/api";

function pointInRing(lng, lat, ring) {
    let inside = false;

    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i];
        const [xj, yj] = ring[j];

        if (
            (yi > lat) !== (yj > lat) &&
            lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi
        ) {
            inside = !inside;
        }
    }

    return inside;
}

function insideActiveArea(place, areas) {
    const lat = Number(place.latitude);
    const lng = Number(place.longitude);

    return areas.some(({ polygon }) => {
        const rings = polygon?.coordinates;
        if (!rings?.[0]?.length) return false;

        return pointInRing(lng, lat, rings[0]) &&
            !rings.slice(1).some((ring) => pointInRing(lng, lat, ring));
    });
}

let localPlacesCache = null;
let localStreetsCache = null;

async function getLocalStreets(query) {
    try {
        if (!localStreetsCache) {
            const response = await fetch("/khanpur-streets.geojson");
            if (!response.ok) return [];

            const data = await response.json();
            localStreetsCache = data.features || [];
        }

        return localStreetsCache
            .filter((feature) =>
                feature.geometry?.type === "LineString" &&
                feature.properties?.name?.toLowerCase()
                    .includes(query.toLowerCase())
            )
            .slice(0, 15)
            .map((feature) => {
                const coordinates = feature.geometry.coordinates;
                const middle = coordinates[Math.floor(coordinates.length / 2)];

                return {
                    name: feature.properties.name,
                    display_name: `${feature.properties.name}, Khanpur`,
                    latitude: middle[1],
                    longitude: middle[0],
                };
            });
    } catch {
        return [];
    }
}

async function getLocalPlaces(query) {
    try {
        if (!localPlacesCache) {
            const response = await fetch("/khanpur-ryk-merged.geojson");
            if (!response.ok) return [];

            const data = await response.json();
            localPlacesCache = Array.isArray(data.features)
                ? data.features
                : [];
        }

        const q = query.toLowerCase();

        return localPlacesCache
            .filter((feature) =>
                feature.geometry?.type === "Point" &&
                [
                    feature.properties?.name,
                    feature.properties?.street,
                    feature.properties?.mohalla,
                    feature.properties?.colony,
                    feature.properties?.landmark,
                    feature.properties?.["addr:street"],
                    feature.properties?.["addr:suburb"],
                    feature.properties?.aliases,
                ]
                    .flat()
                    .filter(Boolean)
                    .some((value) =>
                        String(value).toLowerCase().includes(q)
                    )
            )
            .map((feature) => ({
                name: feature.properties.name,
                display_name: [
                    feature.properties.name,
                    feature.properties["addr:street"] || feature.properties.street,
                    feature.properties["addr:suburb"] || feature.properties.mohalla || feature.properties.colony,
                    feature.properties.city || "Khanpur"
                ].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(", "),
                latitude: feature.geometry.coordinates[1],
                longitude: feature.geometry.coordinates[0],
            }));
    } catch {
        return [];
    }
}

// Keep route and reverse-geocoding endpoints compatible with the existing backend.
const memo = new Map();
const MAX_CACHE = 80;
const CACHE_MS = 90_000;
const normalize = (value) => String(value || "").trim().replace(/\s+/g, " ");
const strip = (value) => value.toLocaleLowerCase("en").normalize("NFKC");

function decorate(place) {
    const full = normalize(place.display_name || place.displayName || place.name);

    const parts = full.split(",")
        .map(normalize)
        .filter((part) =>
            /[a-zA-Z]/.test(part) &&
            !/[\u0600-\u06FF]/.test(part) &&
            !/^\d+$/.test(part)
        );

    const primary = parts[0] || "";
    const city = parts.slice(1).find((part) =>
        !/^(pakistan|punjab|\d{4,})$/i.test(part) &&
        strip(part) !== strip(primary)
    ) || "";

    const label = [primary, city].filter(Boolean).join(", ");

    return {
        ...place,
        name: label,
        display_name: label,
        shortName: primary,
        city,
        subtitle: city || "Nearby place",
    };
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

async function searchCustomAddresses(query) {
    try {
        const response = await fetch("/khanpur-custom-addresses.geojson");
        if (!response.ok) return [];

        const data = await response.json();
        const q = query.toLowerCase().trim();

        return (data.features || [])
            .filter((feature) => {
                const p = feature.properties || {};
                return [
                    p.name,
                    p.street,
                    p.mohalla,
                    p.colony,
                    p.landmark,
                    p.aliases,
                    p["addr:street"],
                    p["addr:suburb"],
                ]
                    .flat()
                    .filter(Boolean)
                    .some((v) => String(v).toLowerCase().includes(q));
            })
            .filter((feature) =>
                feature.geometry?.type === "Point" &&
                feature.geometry.coordinates?.length >= 2
            )
            .map((feature) => {
                const p = feature.properties || {};
                return {
                    name: p.name || p.landmark || p.street || p.mohalla,
                    display_name: [
                        p.name,
                        p.street,
                        p.mohalla,
                        p.colony,
                        "Khanpur",
                    ].filter(Boolean).join(", "),
                    latitude: Number(feature.geometry.coordinates[1]),
                    longitude: Number(feature.geometry.coordinates[0]),
                };
            });
    } catch {
        return [];
    }
}

export async function searchLocations(query, token, userLocation) {
    const q = normalize(query);
    if (q.length < 3) return [];
    const key = `${strip(q)}|${Number(userLocation?.latitude || 0).toFixed(2)}|${Number(userLocation?.longitude || 0).toFixed(2)}`;
    const cached = memo.get(key);
    if (cached && Date.now() - cached.at < CACHE_MS) return cached.items;

    const [providerResults, localResults, streetResults] = await Promise.all([
        queryProvider(q, token, userLocation),
        getLocalPlaces(q),
        getLocalStreets(q),
    ]);

    const customAddresses = await searchCustomAddresses(q);

    try {
        const data = await apiRequest(
            `/service-areas/local-addresses/search?q=${encodeURIComponent(q)}`,
            { token }
        );

        customAddresses.unshift(...(data.locations || []).map((p) => ({
            ...p,
            display_name: [
                p.name, p.street, p.mohalla, p.city
            ].filter(Boolean).join(", "),
        })));
    } catch (error) {
        console.error("Custom address search failed:", error);
    }
    let results = [...customAddresses, ...localResults, ...streetResults, ...providerResults];
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
    const areaData = await apiRequest("/service-areas/active", { token });

    const activeAreas = Array.isArray(areaData.areas)
        ? areaData.areas
        : [];

    results = results.filter((place) =>
        insideActiveArea({
            latitude: place.latitude ?? place.lat,
            longitude: place.longitude ?? place.lon,
        }, activeAreas)
    );

    const seen = new Set();
    const items = results.filter((place) => {
        const lat = Number(place.latitude ?? place.lat);
        const lng = Number(place.longitude ?? place.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
        const id = `${lat.toFixed(6)}:${lng.toFixed(6)}`;
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
    }).map((place) => ({
        ...decorate(place),
        latitude: Number(place.latitude ?? place.lat),
        longitude: Number(place.longitude ?? place.lon),
    })).filter((place) =>
        place.shortName &&
        !/^(pakistan|punjab)$/i.test(place.shortName)
    ).slice(0, 8);
    const userLat = Number(userLocation?.latitude);
    const userLng = Number(userLocation?.longitude);

    if (Number.isFinite(userLat) && Number.isFinite(userLng)) {
        const origin = { latitude: userLat, longitude: userLng };

        if (placeDistanceKm(origin, { latitude: 28.64739, longitude: 70.65694 }) <= 20) {
            items.sort((a, b) =>
                (placeDistanceKm(origin, a) ?? Infinity) -
                (placeDistanceKm(origin, b) ?? Infinity)
            );
        }
    }

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
