const getRoute = async (pickup, destination) => {
    const values = [
        pickup?.latitude,
        pickup?.longitude,
        destination?.latitude,
        destination?.longitude,
    ];

    if (
        values.some(
            (value) =>
                typeof value !== "number" ||
                !Number.isFinite(value)
        ) ||
        Math.abs(pickup.latitude) > 90 ||
        Math.abs(destination.latitude) > 90 ||
        Math.abs(pickup.longitude) > 180 ||
        Math.abs(destination.longitude) > 180
    ) {
        throw new Error("Invalid coordinates");
    }

    const coordinates =
        `${pickup.longitude},${pickup.latitude};` +
        `${destination.longitude},${destination.latitude}`;

    const url =
        `https://router.project-osrm.org/route/v1/driving/${coordinates}` +
        `?overview=full&geometries=geojson`;

    const response = await fetch(url, {
        signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
        throw new Error("Routing provider unavailable");
    }

    const data = await response.json();

    if (data.code !== "Ok" || !data.routes?.length) {
        throw new Error("No route found");
    }

    const route = data.routes[0];

    return {
        distanceKm: Number((route.distance / 1000).toFixed(2)),
        durationMinutes: Math.ceil(route.duration / 60),
        geometry: route.geometry,
    };
};

const searchAddress = async (query, latitude, longitude) => {
    if (typeof query !== "string" || query.trim().length < 3) {
        throw new Error("Invalid search query");
    }

    const url = new URL("https://nominatim.openstreetmap.org/search");

    url.searchParams.set("q", query.trim());
    url.searchParams.set("format", "json");
    url.searchParams.set("addressdetails", "1");
    url.searchParams.set("countrycodes", "pk");
    url.searchParams.set("limit", "15");

    if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
        const radius = 0.12;

        url.searchParams.set("viewbox", [
            longitude - radius,
            latitude + radius,
            longitude + radius,
            latitude - radius,
        ].join(","));

        url.searchParams.set("bounded", "1");
    }

    const response = await fetch(url, {
        headers: {
            "User-Agent": "RideHailingPlatform/1.0 (development; contact: amirowaisy72@.com)",
            "Accept": "application/json",
        },
        signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
        console.error(
            "[NOMINATIM SEARCH]",
            "HTTP", response.status,
            "Response:", (await response.text()).slice(0, 300)
        );
        throw new Error("Address search unavailable");
    }

    const results = await response.json();

    return results.map((place) => ({
        name: place.display_name,
        latitude: Number(place.lat),
        longitude: Number(place.lon),
    }));
};

const reverseGeocode = async (latitude, longitude) => {
    const lat = Number(latitude);
    const lon = Number(longitude);

    if (
        !Number.isFinite(lat) ||
        !Number.isFinite(lon) ||
        Math.abs(lat) > 90 ||
        Math.abs(lon) > 180
    ) {
        throw new Error("Invalid coordinates");
    }

    const url = new URL("https://nominatim.openstreetmap.org/reverse");

    url.searchParams.set("lat", lat);
    url.searchParams.set("lon", lon);
    url.searchParams.set("format", "json");
    url.searchParams.set("addressdetails", "1");

    const response = await fetch(url, {
        headers: {
            "User-Agent": "RideHailingPlatform/1.0 (development; contact: amirowaisy72@.com)",
            "Accept": "application/json",
        },
        signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
        throw new Error("Reverse geocoding unavailable");
    }

    const place = await response.json();

    if (place.error) {
        throw new Error("Address not found");
    }

    return {
        name: place.display_name,
        latitude: lat,
        longitude: lon,
    };
};

module.exports = { getRoute, searchAddress, reverseGeocode };