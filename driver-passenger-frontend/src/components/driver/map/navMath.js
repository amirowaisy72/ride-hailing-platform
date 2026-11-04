// Pure helpers for the driver's turn-by-turn navigation. The routing
// service and its response shape (OSRM) are unchanged; this only turns a
// route into live progress, remaining distance/time and the next instruction.

const EARTH = 6371000;
const toRad = (deg) => (deg * Math.PI) / 180;

export function distanceMeters(a, b) {
    const dLat = toRad(b[1] - a[1]);
    const dLng = toRad(b[0] - a[0]);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLng / 2) ** 2;
    return 2 * EARTH * Math.asin(Math.sqrt(h));
}

export function bearingDegrees(from, to) {
    const dx = (to[0] - from[0]) * Math.cos(toRad(to[1]));
    const dy = to[1] - from[1];
    if (Math.hypot(dx, dy) < 1e-9) return null;
    return (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360;
}

export function shortestAngleDelta(from, to) {
    return ((to - from + 540) % 360) - 180;
}

export function formatDistance(meters) {
    if (!Number.isFinite(meters)) return "";
    if (meters < 30) return "Now";
    if (meters < 1000) return `${meters < 100 ? Math.round(meters / 10) * 10 : Math.round(meters / 50) * 50} m`;
    return `${(meters / 1000).toFixed(meters < 10000 ? 1 : 0)} km`;
}

export async function fetchOsrmRoute(from, to, signal) {
    const url = `https://router.project-osrm.org/route/v1/driving/${from[0]},${from[1]};${to[0]},${to[1]}?overview=full&geometries=geojson&steps=true`;
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error("Road route temporarily unavailable");
    const result = await response.json();
    const route = result.routes?.[0];
    if (!route?.geometry?.coordinates?.length) throw new Error("No road route found");
    return route;
}

/** Index the OSRM route for fast progress lookups. */
export function buildRoute(osrmRoute) {
    const coords = osrmRoute.geometry.coordinates;
    const cumulative = [0];
    for (let i = 1; i < coords.length; i += 1) {
        cumulative.push(cumulative[i - 1] + distanceMeters(coords[i - 1], coords[i]));
    }
    const total = cumulative[cumulative.length - 1] || 1;
    const stepsRaw = osrmRoute.legs?.flatMap((leg) => leg.steps || []) || [];
    const scale = osrmRoute.distance ? total / osrmRoute.distance : 1;
    let offset = 0;
    const steps = stepsRaw.map((step) => {
        const startDist = offset;
        offset += (Number(step.distance) || 0) * scale;
        return { startDist, endDist: offset, name: String(step.name || "").trim(), maneuver: step.maneuver || {} };
    });
    return { coords, cumulative, total, duration: osrmRoute.duration || total / 8, steps, hint: 0 };
}

function projectToSegment(point, a, b) {
    const cos = Math.cos(toRad(point[1]));
    const ax = a[0] * cos, ay = a[1], bx = b[0] * cos, by = b[1], px = point[0] * cos, py = point[1];
    const dx = bx - ax, dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
    const snapped = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    return { t, snapped, deviation: distanceMeters(point, snapped) };
}

function scan(route, point, from, to) {
    let best = null;
    for (let i = from; i < to; i += 1) {
        const hit = projectToSegment(point, route.coords[i], route.coords[i + 1]);
        if (!best || hit.deviation < best.deviation) best = { ...hit, index: i };
    }
    return best;
}

/** Where the driver is along the route, and how far off the line. */
export function projectOnRoute(route, point) {
    const last = route.coords.length - 1;
    if (last < 1) return { progress: 0, deviation: 0, index: 0, snapped: route.coords[0] };
    const from = Math.max(0, route.hint - 4);
    let best = scan(route, point, from, Math.min(last, route.hint + 80));
    if (!best || best.deviation > 60) best = scan(route, point, 0, last);
    const segment = route.cumulative[best.index + 1] - route.cumulative[best.index];
    return {
        progress: route.cumulative[best.index] + segment * best.t,
        deviation: best.deviation,
        index: best.index,
        snapped: best.snapped,
    };
}

export function remainingCoordinates(route, projection) {
    return [projection.snapped, ...route.coords.slice(projection.index + 1)];
}

const TURN_TEXT = {
    left: ["Turn left", "left"],
    right: ["Turn right", "right"],
    "slight left": ["Bear left", "slight-left"],
    "slight right": ["Bear right", "slight-right"],
    "sharp left": ["Sharp left", "sharp-left"],
    "sharp right": ["Sharp right", "sharp-right"],
    straight: ["Go straight", "straight"],
    uturn: ["Make a U-turn", "uturn"],
};

export function describeManeuver(step) {
    if (!step) return { text: "Continue", kind: "straight", road: "" };
    const { type, modifier } = step.maneuver;
    const road = step.name;
    if (type === "arrive") return { text: "Arrive at your stop", kind: "arrive", road: "" };
    if (["roundabout", "rotary", "roundabout turn"].includes(type)) {
        return { text: "Enter the roundabout", kind: "roundabout", road: road ? `to ${road}` : "" };
    }
    if (type === "fork") {
        const left = String(modifier || "").includes("left");
        return { text: left ? "Keep left" : "Keep right", kind: left ? "slight-left" : "slight-right", road: road ? `toward ${road}` : "" };
    }
    const mapped = TURN_TEXT[modifier] || ["Continue", "straight"];
    return { text: mapped[0], kind: mapped[1], road: road ? (mapped[1] === "straight" ? `on ${road}` : `onto ${road}`) : "" };
}

/** Remaining distance/time and the next instruction for a given progress. */
export function navigationState(route, progress) {
    const remaining = Math.max(0, route.total - progress);
    const remainingSeconds = route.duration * (remaining / route.total);
    const next = route.steps.findIndex((step, index) => index > 0 && step.startDist > progress + 1);
    const target = next === -1 ? route.steps[route.steps.length - 1] : route.steps[next];
    const toManeuver = next === -1 ? remaining : Math.max(0, route.steps[next].startDist - progress);
    const arrived = remaining < 25;
    const described = arrived ? { text: "You have arrived", kind: "arrive", road: "" } : describeManeuver(target);
    return { remaining, remainingSeconds, toManeuver, arrived, ...described };
}
