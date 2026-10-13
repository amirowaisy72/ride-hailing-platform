"use client";
import { useEffect, useRef, useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Car, UserRound } from "lucide-react";
import { getVehicle } from "@/lib/rideDisplay";
maplibregl.setWorkerUrl("/maplibre-worker.mjs");

const DARK = "#111111";

const LIME = "#C1F11D";

const ROUTE_SOURCE = "actual-road-route";

const ROUTE_LAYER = "actual-road-route-layer";

const ROUTE_CASING_LAYER = "actual-road-route-casing";

const DEFAULT_OFFSET_RATIO = 0.32;

const DEFAULT_PADDING_RATIO = 0.62;

const TRACKING_PADDING_RATIO = 0.42;

const MAP_STYLES = `
.rx-map-pickup{position:relative;width:42px;height:42px;display:grid;place-items:center;cursor:grab}
.rx-map-pickup-pin{position:relative;z-index:2;width:30px;height:30px;border-radius:50%;background:${DARK};border:3px solid #fff;box-shadow:0 4px 14px rgba(17,17,17,.35);display:grid;place-items:center}
.rx-map-pickup-dot{width:10px;height:10px;border-radius:50%;background:${LIME}}
.rx-map-pickup-pin svg{display:block}
.rx-map-radar{display:none;position:absolute;z-index:1;left:50%;top:50%;width:220px;height:220px;margin:-110px 0 0 -110px;border-radius:50%;background:radial-gradient(circle,rgba(193,241,29,.45) 0%,rgba(193,241,29,.18) 55%,rgba(193,241,29,0) 70%);border:2px solid rgba(140,180,0,.45);pointer-events:none;animation:rx-map-radar 2.8s cubic-bezier(0,0,.2,1) infinite}
.rx-map-searching .rx-map-radar{display:block}
.rx-map-radar-delay{animation-delay:1.4s}
.rx-map-dest{width:26px;height:26px;border-radius:8px;background:#E5484D;border:3px solid #fff;box-shadow:0 4px 14px rgba(17,17,17,.3);display:grid;place-items:center}
.rx-map-dest::after{content:"";width:8px;height:8px;border-radius:2px;background:#fff}
.rx-map-stop{width:28px;height:28px;border-radius:50%;background:#fff;border:3px solid ${DARK};color:${DARK};font:800 12px/1 system-ui,sans-serif;display:grid;place-items:center;box-shadow:0 3px 10px rgba(17,17,17,.25)}
.rx-map-driver{position:relative;width:46px;height:46px}
.rx-map-driver-pulse{position:absolute;inset:-8px;border-radius:50%;background:rgba(193,241,29,.4);animation:rx-map-pulse 2.2s ease-out infinite}
.rx-map-driver-heading{position:absolute;inset:-11px;opacity:0;transition:transform .6s ease,opacity .3s ease}
.rx-map-driver-heading.is-visible{opacity:1}
.rx-map-driver-heading::before{content:"";position:absolute;left:50%;top:0;margin-left:-7px;border-left:7px solid transparent;border-right:7px solid transparent;border-bottom:10px solid ${DARK}}
.rx-map-driver-body{position:absolute;inset:0;border-radius:50%;background:${DARK};border:3px solid #fff;display:grid;place-items:center;box-shadow:0 6px 18px rgba(17,17,17,.4)}
.rx-map-cell{position:relative;width:38px;height:38px;display:grid;place-items:center}
/* Pending passenger requests are distinct from nearby driver grid cells. */
.rx-map-request{width:36px;height:36px;border:3px solid #fff;border-radius:50%;background:#111111;color:#C1F11D;display:grid;place-items:center;box-shadow:0 4px 15px #0005}
.rx-map-request svg{width:19px;height:19px}
.rx-map-cell-halo{position:absolute;inset:-12px;border-radius:50%;border:1.5px dashed rgba(17,17,17,.35);background:rgba(193,241,29,.2)}
.rx-map-cell-body{position:relative;width:36px;height:36px;border-radius:50%;background:#fff;border:2px solid ${DARK};display:grid;place-items:center;box-shadow:0 3px 10px rgba(17,17,17,.25)}
.rx-map-cell-count{position:absolute;right:-7px;bottom:-7px;min-width:19px;height:19px;padding:0 4px;border-radius:10px;background:${DARK};color:${LIME};font:800 10px/15px system-ui,sans-serif;text-align:center;border:2px solid #fff}
@keyframes rx-map-radar{0%{transform:scale(.12);opacity:.95}100%{transform:scale(1);opacity:0}}
@keyframes rx-map-pulse{0%{transform:scale(.7);opacity:.9}100%{transform:scale(1.5);opacity:0}}
@keyframes rx-map-fade{from{opacity:0;transform:scale(.6)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion: reduce){.rx-map-radar,.rx-map-driver-pulse,.rx-map-cell{animation:none!important}.rx-map-radar{opacity:.35;transform:scale(.6)}}
`;
const getPoint = (point) => {
    if (!point) return null;
    const longitude = Array.isArray(point.coordinates) ? Number(point.coordinates[0]) : Number(point.longitude);
    const latitude = Array.isArray(point.coordinates) ? Number(point.coordinates[1]) : Number(point.latitude);
    return Number.isFinite(longitude) && Number.isFinite(latitude) && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180
        ? [longitude, latitude] : null;
};
const geoLine = (coordinates) => ({
    type: "Feature", properties: {}, geometry: { type: "LineString", coordinates },
});

function samePoint(a, b) {
    return Boolean(a && b) && Math.abs(a[0] - b[0]) < 0.00005 && Math.abs(a[1] - b[1]) < 0.00005;
}

function bearingBetween(from, to) {
    const deltaLng = (to[0] - from[0]) * Math.cos(to[1] * Math.PI / 180);
    const deltaLat = to[1] - from[1];
    if (Math.hypot(deltaLng, deltaLat) <= 0.00008) return null;
    return (Math.atan2(deltaLng, deltaLat) * 180 / Math.PI + 360) % 360;
}
const iconCache = new Map();

function vehicleIconMarkup(type, color, size) {
    const key = `${type}|${color}|${size}`;
    if (!iconCache.has(key)) {
        const Icon = getVehicle(type)?.Icon || Car;
        iconCache.set(key, renderToStaticMarkup(<Icon size={size} color={color} strokeWidth={2.25} aria-hidden="true" />));
    }
    return iconCache.get(key);
}

function createPickupElement() {
    const element = document.createElement("div");
    element.className = "rx-map-pickup";
    element.setAttribute("aria-label", "Pickup location");
    element.innerHTML = '<span class="rx-map-radar"></span><span class="rx-map-radar rx-map-radar-delay"></span><span class="rx-map-pickup-pin"><span class="rx-map-pickup-dot"></span></span>';
    return element;
}

function createDestinationElement() {
    const element = document.createElement("div");
    element.className = "rx-map-dest";
    element.setAttribute("aria-label", "Destination");
    return element;
}

function createStopElement(index) {
    const element = document.createElement("div");
    element.className = "rx-map-stop";
    element.textContent = String(index + 1);
    element.setAttribute("aria-label", `Stop ${index + 1}`);
    return element;
}

function createDriverElement(type) {
    const element = document.createElement("div");
    element.className = "rx-map-driver";
    element.setAttribute("aria-label", "Driver live location");
    element.innerHTML = `<span class="rx-map-driver-pulse"></span><span class="rx-map-driver-heading"></span><span class="rx-map-driver-body">${vehicleIconMarkup(type, LIME, 20)}</span>`;
    return element;
}
// Privacy-protected anonymous grid cells; these are NOT drivers' exact positions.

function createRequestElement() {
    const el = document.createElement("div");
    el.className = "rx-map-request";
    el.title = "Passenger waiting for driver";
    el.setAttribute("aria-label", el.title);
    el.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="3"/><path d="M5 21v-2a7 7 0 0 1 14 0v2"/></svg>';
    return el;
}

function createCellElement(cell, fallbackType) {
    const element = document.createElement("div");
    const count = Math.max(1, Number(cell.count) || 1);
    element.className = "rx-map-cell";
    element.title = `${count} available driver${count > 1 ? "s" : ""} in this approximate area`;
    element.setAttribute("aria-label", element.title);
    element.innerHTML = `<span class="rx-map-cell-halo"></span><span class="rx-map-cell-body">${vehicleIconMarkup(cell.vehicleType || fallbackType, DARK, 18)}</span>${count > 1 ? `<span class="rx-map-cell-count">${count}</span>` : ""}`;
    return element;
}

function bottomInsetPx(height, sheetRatio, fallbackRatio) {
    const ratio = Number.isFinite(sheetRatio) ? sheetRatio : fallbackRatio;
    return Math.max(40, Math.min(Math.round(height * ratio), height - 170));
}

function pickupOffsetPx(height, sheetRatio) {
    return Number.isFinite(sheetRatio)
        ? Math.round((height * sheetRatio) / 2)
        : Math.round(Math.min(height * DEFAULT_OFFSET_RATIO, 300));
}

export default function RideMap({
    center = [69.3451, 30.3753], userLocation = null, locateRequest = 0,
    destination = null, stops = [], onPickupChange = null,
    driverLocation = null, followDriver = false, navigationMode = false,
    nearbyDriverCells = [],
    rideRequestPoints = [],
    onRouteUpdate = null,
    // Optional props below are additive; existing callers keep their previous behaviour.
    passengerView = false,
    searching = false,
    vehicleType = null,
    onMapClick = null,
    sheetRatio = null,
    showNavigationControl = true,
}) {
    const node = useRef(null);
    const mapRef = useRef(null);
    const pickupRef = useRef(null);
    const driverRef = useRef(null);
    const destinationRef = useRef(null);
    const stopRefs = useRef([]);
    const nearbyRefs = useRef([]);
    const rideRequestRefs = useRef([]);
    const dragHandler = useRef(onPickupChange);
    const routeUpdateRef = useRef(onRouteUpdate);
    const clickRef = useRef(onMapClick);
    const sheetRatioRef = useRef(sheetRatio);
    const routeBoundsRef = useRef(null);
    const framedKeyRef = useRef("");
    const locateSeenRef = useRef(locateRequest);
    const driverAnimRef = useRef(0);
    const driverShownRef = useRef(null);
    const lastDriverPointRef = useRef(null);
    const [mapReady, setMapReady] = useState(false);
    const [error, setError] = useState("");
    const [routing, setRouting] = useState(false);
    const [routeInfo, setRouteInfo] = useState(null);
    dragHandler.current = onPickupChange;
    routeUpdateRef.current = onRouteUpdate;
    clickRef.current = onMapClick;
    sheetRatioRef.current = sheetRatio;
    useEffect(() => {
        if (!node.current || mapRef.current) return;
        const map = new maplibregl.Map({
            container: node.current,
            style: "https://tiles.openfreemap.org/styles/liberty",
            center,
            zoom: 12,
            attributionControl: true,
        });
        mapRef.current = map;
        if (showNavigationControl) {
            map.addControl(new maplibregl.NavigationControl({ showCompass: true }), "bottom-right");
        }
        const ready = () => setMapReady(true);
        const handleClick = (event) => clickRef.current?.({ latitude: event.lngLat.lat, longitude: event.lngLat.lng });
        map.on("load", ready);
        map.on("click", handleClick);
        map.on("error", (event) => console.warn("Map resource issue", event?.error?.message));
        const observer = typeof ResizeObserver !== "undefined"
            ? new ResizeObserver(() => map.resize()) : null;
        if (observer) observer.observe(node.current);
        return () => {
            observer?.disconnect();
            cancelAnimationFrame(driverAnimRef.current);
            map.off("load", ready);
            map.off("click", handleClick);
            pickupRef.current?.remove();
            driverRef.current?.remove();
            destinationRef.current?.remove();
            stopRefs.current.forEach((marker) => marker.remove());
            nearbyRefs.current.forEach((marker) => marker.remove());
            rideRequestRefs.current.forEach((marker) => marker.remove());
            pickupRef.current = driverRef.current = destinationRef.current = null;
            stopRefs.current = [];
            nearbyRefs.current = [];
            setMapReady(false);
            map.remove();
            mapRef.current = null;
        };
    }, []);
    useEffect(() => {
        const map = mapRef.current;
        if (!map || !mapReady) return;
        map.getCanvas().style.cursor = onMapClick ? "crosshair" : "";
    }, [mapReady, Boolean(onMapClick)]);
    function fitRoute(bounds) {
        const map = mapRef.current;
        if (!map || !bounds) return;
        const height = map.getContainer().clientHeight;
        const bottom = bottomInsetPx(height, sheetRatioRef.current, DEFAULT_PADDING_RATIO);
        map.fitBounds(bounds, { padding: { top: 100, bottom: bottom + 24, left: 40, right: 40 }, maxZoom: 15, duration: 600 });
    }
    // Passenger tracking camera: frame once per phase, then only re-frame when a point leaves the visible area.
    function frameTargets(points, key, force) {
        const map = mapRef.current;
        const valid = points.filter(Boolean);
        if (!map || !valid.length) return;
        const container = map.getContainer();
        const width = container.clientWidth;
        const height = container.clientHeight;
        const bottom = bottomInsetPx(height, sheetRatioRef.current, TRACKING_PADDING_RATIO);
        if (!force && framedKeyRef.current === key) {
            const inView = valid.every((point) => {
                const pixel = map.project(point);
                return pixel.x > 28 && pixel.x < width - 28 && pixel.y > 110 && pixel.y < height - bottom;
            });
            if (inView) return;
        }
        framedKeyRef.current = key;
        if (valid.length === 1 || (valid.length === 2 && samePoint(valid[0], valid[1]))) {
            map.easeTo({ center: valid[0], zoom: 16, offset: [0, -Math.round(bottom / 2) + 40], duration: 700 });
            return;
        }
        const bounds = valid.reduce((box, point) => box.extend(point), new maplibregl.LngLatBounds(valid[0], valid[0]));
        map.fitBounds(bounds, { padding: { top: 120, bottom: bottom + 24, left: 60, right: 60 }, maxZoom: 16.5, duration: 800 });
    }
    // The marker is anchored to the true geographic coordinate, not the centre of a scrollable sheet.
    useEffect(() => {
        const map = mapRef.current;
        const point = getPoint(userLocation);
        if (!map || !point) return;
        if (driverLocation && !passengerView) {
            pickupRef.current?.remove();
            pickupRef.current = null;
            return;
        }
        if (!pickupRef.current) {
            pickupRef.current = new maplibregl.Marker({ element: createPickupElement(), draggable: Boolean(onPickupChange) })
                .setLngLat(point).addTo(map);
            pickupRef.current.on("dragend", () => {
                const position = pickupRef.current.getLngLat();
                dragHandler.current?.({ longitude: position.lng, latitude: position.lat });
            });
        } else {
            pickupRef.current.setLngLat(point);
            pickupRef.current.setDraggable(Boolean(onPickupChange));
        }
        const watchingDriver = passengerView && navigationMode;
        // Explicit Locate requests always center the marker, even if coordinates did not change.
        if (!followDriver && !watchingDriver) {
            map.resize();
            const visibleHeight = map.getContainer().clientHeight;
            const bookingOffset = navigationMode ? 0 : pickupOffsetPx(visibleHeight, sheetRatioRef.current);
            map.flyTo({ center: point, zoom: Math.max(map.getZoom(), 15), duration: 550, essential: true, offset: [0, -bookingOffset] });
        }
    }, [mapReady, userLocation?.latitude, userLocation?.longitude, userLocation?.coordinates?.[0], userLocation?.coordinates?.[1], locateRequest, Boolean(onPickupChange), followDriver]);
    useEffect(() => {
        pickupRef.current?.getElement().classList.toggle("rx-map-searching", Boolean(searching));
    }, [mapReady, searching, userLocation?.latitude, userLocation?.longitude, userLocation?.coordinates?.[0]]);
    useEffect(() => {
        framedKeyRef.current = "";
    }, [navigationMode]);
    useEffect(() => {
        const map = mapRef.current;
        const point = getPoint(driverLocation);
        const forceFrame = locateSeenRef.current !== locateRequest;
        locateSeenRef.current = locateRequest;
        if (!map) return;
        const targetPoint = getPoint(destination);
        const phaseKey = targetPoint ? targetPoint.map((value) => value.toFixed(5)).join(",") : "none";
        if (!point) {
            cancelAnimationFrame(driverAnimRef.current);
            driverRef.current?.remove();
            driverRef.current = null;
            driverShownRef.current = null;
            lastDriverPointRef.current = null;
            if (passengerView && navigationMode && mapReady) {
                frameTargets([getPoint(userLocation), targetPoint], `nodriver:${phaseKey}`, forceFrame);
            }
            return;
        }
        if (!driverRef.current) {
            driverRef.current = new maplibregl.Marker({ element: createDriverElement(vehicleType) }).setLngLat(point).addTo(map);
            driverShownRef.current = point;
        } else {
            // Glide between real GPS fixes so the vehicle moves smoothly instead of jumping.
            const from = driverShownRef.current || point;
            const jump = Math.hypot(point[0] - from[0], point[1] - from[1]) > 0.02;
            const reduceMotion = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
            cancelAnimationFrame(driverAnimRef.current);
            if (jump || reduceMotion) {
                driverRef.current.setLngLat(point);
                driverShownRef.current = point;
            } else {
                const startedAt = performance.now();
                const duration = 900;
                const step = (time) => {
                    const t = Math.min(1, (time - startedAt) / duration);
                    const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
                    const next = [from[0] + (point[0] - from[0]) * eased, from[1] + (point[1] - from[1]) * eased];
                    driverRef.current?.setLngLat(next);
                    driverShownRef.current = next;
                    if (t < 1) driverAnimRef.current = requestAnimationFrame(step);
                };
                driverAnimRef.current = requestAnimationFrame(step);
            }
        }
        const previous = lastDriverPointRef.current;
        const movedBearing = previous ? bearingBetween(previous, point) : null;
        lastDriverPointRef.current = point;
        if (movedBearing != null) {
            const heading = driverRef.current?.getElement().querySelector(".rx-map-driver-heading");
            if (heading) {
                heading.style.transform = `rotate(${movedBearing - map.getBearing()}deg)`;
                heading.classList.add("is-visible");
            }
        }
        if (passengerView) {
            if (navigationMode && mapReady) frameTargets([point, targetPoint], `driver:${phaseKey}`, forceFrame);
        } else {
            const bearing = movedBearing != null ? movedBearing : map.getBearing();
            // Place moving driver toward lower half so upcoming roads remain visible.
            map.easeTo({
                center: point, zoom: navigationMode ? 16.5 : 15,
                bearing: navigationMode ? bearing : 0, pitch: navigationMode ? 45 : 0,
                offset: navigationMode ? [0, -Math.round(bottomInsetPx(map.getContainer().clientHeight, sheetRatioRef.current, 0.12) * 0.55)] : [0, -Math.round(
                    bottomInsetPx(
                        map.getContainer().clientHeight,
                        sheetRatioRef.current,
                        0.49
                    ) / 2
                )], duration: 750
            });
        }
    }, [mapReady, driverLocation?.latitude, driverLocation?.longitude, driverLocation?.coordinates?.[0], driverLocation?.coordinates?.[1], followDriver, navigationMode, locateRequest, destination?.latitude, destination?.longitude, destination?.coordinates?.[0], destination?.coordinates?.[1]]);
    useEffect(() => {
        const body = driverRef.current?.getElement().querySelector(".rx-map-driver-body");
        if (body) body.innerHTML = vehicleIconMarkup(vehicleType, LIME, 20);
    }, [vehicleType]);
    useEffect(() => {
        const map = mapRef.current;
        if (!map) return;
        destinationRef.current?.remove();
        stopRefs.current.forEach((marker) => marker.remove());
        stopRefs.current = [];
        const end = getPoint(destination);
        const pickupPoint = getPoint(userLocation);
        // During pickup tracking the destination prop is the pickup itself; the pickup marker already covers it.
        if (end && !samePoint(end, pickupPoint)) {
            destinationRef.current = new maplibregl.Marker({ element: createDestinationElement() }).setLngLat(end).addTo(map);
        }
        (Array.isArray(stops) ? stops : []).forEach((stop, index) => {
            const point = getPoint(stop);
            if (!point) return;
            stopRefs.current.push(new maplibregl.Marker({ element: createStopElement(index) }).setLngLat(point).addTo(map));
        });
        return () => { destinationRef.current?.remove(); destinationRef.current = null; stopRefs.current.forEach((m) => m.remove()); stopRefs.current = []; };
    }, [mapReady, destination?.latitude, destination?.longitude, destination?.coordinates?.[0], destination?.coordinates?.[1], userLocation?.latitude, userLocation?.longitude, JSON.stringify(stops)]);
    useEffect(() => {
        const map = mapRef.current;
        if (!map || !mapReady) return;
        nearbyRefs.current.forEach((marker) => marker.remove());
        nearbyRefs.current = [];
        (Array.isArray(nearbyDriverCells) ? nearbyDriverCells : []).forEach((cell) => {
            if (!Number.isFinite(cell.latitude) || !Number.isFinite(cell.longitude)) return;
            nearbyRefs.current.push(new maplibregl.Marker({ element: createCellElement(cell, vehicleType) })
                .setLngLat([cell.longitude, cell.latitude]).addTo(map));
        });
        return () => { nearbyRefs.current.forEach((marker) => marker.remove()); nearbyRefs.current = []; };
    }, [mapReady, JSON.stringify(nearbyDriverCells), vehicleType]);
    // Pending passenger pickups (driver discovery only); do not expose passenger identity.
    useEffect(() => {
        const map = mapRef.current;
        if (!map || !mapReady) return;
        rideRequestRefs.current.forEach((marker) => marker.remove());
        rideRequestRefs.current = [];
        (Array.isArray(rideRequestPoints) ? rideRequestPoints : []).forEach(({ point }) => {
            const coordinates = getPoint(point);
            if (!coordinates) return;
            rideRequestRefs.current.push(new maplibregl.Marker({ element: createRequestElement() }).setLngLat(coordinates).addTo(map));
        });
        return () => { rideRequestRefs.current.forEach((marker) => marker.remove()); rideRequestRefs.current = []; };
    }, [mapReady, JSON.stringify(rideRequestPoints)]);
    // Re-frame when the bottom sheet grows or shrinks, without requesting a new route.
    useEffect(() => {
        const map = mapRef.current;
        if (!map || !mapReady) return;
        if (!navigationMode && !followDriver && routeBoundsRef.current) {
            fitRoute(routeBoundsRef.current);
        } else if (passengerView && navigationMode) {
            const targetPoint = getPoint(destination);
            frameTargets([driverShownRef.current || getPoint(userLocation), targetPoint], framedKeyRef.current, true);
        }
    }, [sheetRatio]);
    // Road geometry from OSRM demo server is development-only; replace with production routing backend.
    useEffect(() => {
        const map = mapRef.current;
        if (!mapReady || !map) return;
        const starting = navigationMode && getPoint(driverLocation) ? getPoint(driverLocation) : getPoint(userLocation);
        const targets = [starting, ...(Array.isArray(stops) ? stops.map(getPoint) : []), getPoint(destination)].filter(Boolean);
        // Round only the route-request origin (\~55 m) to limit requests to public OSRM.
        // The actual moving marker always keeps full GPS precision.
        const requestTargets = targets.map((p, index) => index === 0 && navigationMode
            ? [Math.round(p[0] * 2000) / 2000, Math.round(p[1] * 2000) / 2000]
            : p);
        const controller = new AbortController();
        let abandoned = false;
        function clearRoute() {
            if (map.getLayer(ROUTE_LAYER)) map.removeLayer(ROUTE_LAYER);
            if (map.getLayer(ROUTE_CASING_LAYER)) map.removeLayer(ROUTE_CASING_LAYER);
            if (map.getSource(ROUTE_SOURCE)) map.removeSource(ROUTE_SOURCE);
            routeBoundsRef.current = null;
            setRouteInfo(null);
        }
        async function drawRoute() {
            if (targets.length < 2 || (targets.length === 2 && samePoint(targets[0], targets[1]))) {
                clearRoute();
                return;
            }
            setRouting(true);
            try {
                const coordinates = requestTargets.map((p) => `${p[0]},${p[1]}`).join(";");
                const url = `https://router.project-osrm.org/route/v1/driving/${coordinates}?overview=full&geometries=geojson&steps=true`;
                const response = await fetch(url, { signal: controller.signal });
                if (!response.ok) throw new Error("Road route temporarily unavailable");
                const result = await response.json();
                const route = result.routes?.[0];
                if (!route?.geometry?.coordinates?.length) throw new Error("No road route found");
                if (abandoned) return;
                const data = geoLine(route.geometry.coordinates);
                if (map.getSource(ROUTE_SOURCE)) map.getSource(ROUTE_SOURCE).setData(data);
                else {
                    map.addSource(ROUTE_SOURCE, { type: "geojson", data });
                    map.addLayer({ id: ROUTE_CASING_LAYER, type: "line", source: ROUTE_SOURCE, layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": "#ffffff", "line-width": 10, "line-opacity": 0.95 } });
                    map.addLayer({ id: ROUTE_LAYER, type: "line", source: ROUTE_SOURCE, layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": DARK, "line-width": 5.5, "line-opacity": 0.92 } });
                }
                const steps = route.legs?.[0]?.steps || [];
                // First upcoming turn, not distance for the whole next road segment.
                const index = steps.findIndex((step) => !["depart", "arrive"].includes(step.maneuver?.type));
                const next = index >= 0 ? steps[index] : steps[0];
                const approachMeters = index > 0 ? steps.slice(0, index).reduce((sum, step) => sum + (Number(step.distance) || 0), 0) : 0;
                const maneuver = next?.maneuver || {};
                const direction = String(maneuver.modifier || "").replaceAll("-", " ");
                const action = maneuver.type === "turn" ? "Turn" : maneuver.type === "roundabout" ? "Enter roundabout" : "Continue";
                const road = String(next?.name || "ahead").trim();
                const firstLeg = route.legs?.[0];
                const info = {
                    distanceKm: Number((route.distance / 1000).toFixed(1)),
                    durationMinutes: Math.max(1, Math.ceil(route.duration / 60)),
                    nextStep: `${action}${direction ? ` ${direction}` : ""} ${road === "ahead" ? "" : `onto ${road}`}`.trim(),
                    stepDistanceMeters: Math.round(approachMeters),
                    nextLegDistanceKm: firstLeg ? Number((firstLeg.distance / 1000).toFixed(1)) : null,
                    nextLegDurationMinutes: firstLeg ? Math.max(1, Math.ceil(firstLeg.duration / 60)) : null,
                    estimateOnly: true,
                };
                setRouteInfo(info);
                routeUpdateRef.current?.(info);
                if (!followDriver && !navigationMode) {
                    const bounds = route.geometry.coordinates.reduce((box, coord) => box.extend(coord), new maplibregl.LngLatBounds(targets[0], targets[0]));
                    routeBoundsRef.current = bounds;
                    fitRoute(bounds);
                }
                setError("");
            } catch (e) {
                if (!abandoned && e.name !== "AbortError") { setError("Road navigation unavailable. Check routing connection."); setRouteInfo(null); }
            } finally { if (!abandoned) setRouting(false); }
        }
        drawRoute();
        return () => { abandoned = true; controller.abort(); };
    }, [mapReady, navigationMode, destination?.latitude, destination?.longitude,
        destination?.coordinates?.[0], destination?.coordinates?.[1],
        // Trigger a new routing request after meaningful GPS movement (\~55 m).
        Math.round((navigationMode && getPoint(driverLocation) ? getPoint(driverLocation)[0] : (getPoint(userLocation)?.[0] || 0)) * 2000),
        Math.round((navigationMode && getPoint(driverLocation) ? getPoint(driverLocation)[1] : (getPoint(userLocation)?.[1] || 0)) * 2000),
        JSON.stringify(stops)]);
    const statusPillClass = passengerView
        ? "pointer-events-none absolute left-1/2 top-[calc(max(16px,env(safe-area-inset-top))+128px)] z-10 -translate-x-1/2 rounded-full bg-white/95 px-3.5 py-1.5 text-xs font-semibold text-[#374151] shadow-md"
        : "absolute bottom-28 left-3 rounded-xl bg-white/90 px-3 py-2 text-xs shadow";
    return (
        <div className="relative h-full w-full">
            <style>{MAP_STYLES}</style>
            <div ref={node} className="h-full w-full" />
            {routing && !error && <div className={statusPillClass}>Loading road route…</div>}
            {error && <div role="status" className={`${statusPillClass} text-amber-700`}>{error}</div>}
        </div>
    );
}
