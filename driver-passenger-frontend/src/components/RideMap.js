"use client";

import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

maplibregl.setWorkerUrl("/maplibre-worker.mjs");

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

export default function RideMap({
    center = [69.3451, 30.3753], userLocation = null, locateRequest = 0,
    destination = null, stops = [], onPickupChange = null,
    driverLocation = null, followDriver = false, navigationMode = false,
    nearbyDriverCells = [],
    onRouteUpdate = null,
}) {
    const node = useRef(null);
    const mapRef = useRef(null);
    const pickupRef = useRef(null);
    const driverRef = useRef(null);
    const destinationRef = useRef(null);
    const stopRefs = useRef([]);
    const nearbyRefs = useRef([]);
    const dragHandler = useRef(onPickupChange);
    const [mapReady, setMapReady] = useState(false);
    const [error, setError] = useState("");
    const [routing, setRouting] = useState(false);
    const [routeInfo, setRouteInfo] = useState(null);
    const lastRoutingRef = useRef({ key: "", time: 0 });
    const lastDriverPointRef = useRef(null);
    dragHandler.current = onPickupChange;

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
        map.addControl(new maplibregl.NavigationControl({ showCompass: true }), "bottom-right");
        const ready = () => setMapReady(true);
        map.on("load", ready);
        map.on("error", (event) => console.warn("Map resource issue", event?.error?.message));
        const observer = typeof ResizeObserver !== "undefined"
            ? new ResizeObserver(() => map.resize()) : null;
        if (observer) observer.observe(node.current);
        return () => {
            observer?.disconnect();
            map.off("load", ready);
            pickupRef.current?.remove();
            driverRef.current?.remove();
            destinationRef.current?.remove();
            stopRefs.current.forEach((marker) => marker.remove());
            nearbyRefs.current.forEach((marker) => marker.remove());
            pickupRef.current = driverRef.current = destinationRef.current = null;
            stopRefs.current = [];
            setMapReady(false);
            map.remove();
            mapRef.current = null;
        };
    }, []);

    // The marker is anchored to the true geographic coordinate, not the centre of a scrollable sheet.
    useEffect(() => {
        const map = mapRef.current;
        const point = getPoint(userLocation);
        if (!map || !point) return;
        if (!pickupRef.current) {
            pickupRef.current = new maplibregl.Marker({ color: "#087F5B", draggable: Boolean(onPickupChange) })
                .setLngLat(point).addTo(map);
            pickupRef.current.on("dragend", () => {
                const position = pickupRef.current.getLngLat();
                dragHandler.current?.({ longitude: position.lng, latitude: position.lat });
            });
        } else {
            pickupRef.current.setLngLat(point);
            pickupRef.current.setDraggable(Boolean(onPickupChange));
        }
        // Explicit Locate requests always center the marker, even if coordinates did not change.
        if (!followDriver) {
            map.resize();
            const visibleHeight = map.getContainer().clientHeight;
            const bookingOffset = navigationMode ? 0 : Math.round(Math.min(visibleHeight * 0.32, 300));
            map.flyTo({ center: point, zoom: Math.max(map.getZoom(), 15), duration: 550, essential: true, offset: [0, -bookingOffset] });
        }
    }, [mapReady, userLocation?.latitude, userLocation?.longitude, locateRequest, Boolean(onPickupChange), followDriver]);

    useEffect(() => {
        const map = mapRef.current;
        const point = getPoint(driverLocation);
        if (!map) return;
        if (!point) { driverRef.current?.remove(); driverRef.current = null; return; }
        if (!driverRef.current) {
            const markerNode = document.createElement("div");
            markerNode.innerHTML = '<div style="width:40px;height:40px;border:3px solid white;border-radius:50%;display:grid;place-items:center;background:#047857;color:white;box-shadow:0 2px 15px #0006;font-size:22px">➤</div>';
            driverRef.current = new maplibregl.Marker({ element: markerNode }).setLngLat(point).addTo(map);
        } else driverRef.current.setLngLat(point);
        if (followDriver) {
            const previous = lastDriverPointRef.current;
            let bearing = map.getBearing();
            if (previous) {
                const deltaLng = (point[0] - previous[0]) * Math.cos(point[1] * Math.PI / 180);
                const deltaLat = point[1] - previous[1];
                if (Math.hypot(deltaLng, deltaLat) > 0.00008) {
                    bearing = (Math.atan2(deltaLng, deltaLat) * 180 / Math.PI + 360) % 360;
                }
            }
            lastDriverPointRef.current = point;
            // Place moving driver toward lower half so upcoming roads remain visible.
            map.easeTo({
                center: point, zoom: navigationMode ? 16.5 : 15,
                bearing: navigationMode ? bearing : 0, pitch: navigationMode ? 45 : 0,
                offset: navigationMode ? [0, 105] : [0, 0], duration: 750
            });
        }
    }, [mapReady, driverLocation?.latitude, driverLocation?.longitude, driverLocation?.coordinates?.[0], driverLocation?.coordinates?.[1], followDriver, navigationMode]);

    useEffect(() => {
        const map = mapRef.current;
        if (!map) return;
        destinationRef.current?.remove();
        stopRefs.current.forEach((marker) => marker.remove());
        stopRefs.current = [];
        const end = getPoint(destination);
        if (end) destinationRef.current = new maplibregl.Marker({ color: "#DC2626" }).setLngLat(end).addTo(map);
        (Array.isArray(stops) ? stops : []).forEach((stop, index) => {
            const point = getPoint(stop);
            if (!point) return;
            const el = document.createElement("div");
            el.textContent = String(index + 1);
            el.style.cssText = "display:grid;place-items:center;width:30px;height:30px;border-radius:50%;background:#047857;color:#fff;font-weight:800;border:3px solid #fff;box-shadow:0 2px 8px #0005";
            stopRefs.current.push(new maplibregl.Marker({ element: el }).setLngLat(point).addTo(map));
        });
        return () => { destinationRef.current?.remove(); destinationRef.current = null; stopRefs.current.forEach((m) => m.remove()); stopRefs.current = []; };
    }, [mapReady, destination?.latitude, destination?.longitude, destination?.coordinates?.[0], destination?.coordinates?.[1], JSON.stringify(stops)]);

    // Privacy-protected anonymous grid markers; these are NOT drivers' exact positions.
    useEffect(() => {
        const map = mapRef.current;
        if (!map || !mapReady) return;
        nearbyRefs.current.forEach((marker) => marker.remove());
        nearbyRefs.current = [];
        (Array.isArray(nearbyDriverCells) ? nearbyDriverCells : []).forEach((cell) => {
            if (!Number.isFinite(cell.latitude) || !Number.isFinite(cell.longitude)) return;
            const element = document.createElement("div");
            const count = Math.max(1, Number(cell.count) || 1);
            element.innerHTML = `<span aria-hidden="true" style="font-size:20px;line-height:1">🚗</span><span style="position:absolute;right:-7px;bottom:-7px;border-radius:999px;background:#065f46;color:white;border:2px solid white;font-size:10px;padding:1px 4px">${count}</span>`;
            element.title = "Available drivers in this approximate area";
            element.setAttribute("aria-label", element.title);
            element.style.cssText = "position:relative;display:grid;place-items:center;width:39px;height:39px;border-radius:50%;border:3px solid #fff;background:#d1fae5;color:#065f46;font-weight:800;font-size:12px;box-shadow:0 2px 12px #0004";
            nearbyRefs.current.push(new maplibregl.Marker({ element })
                .setLngLat([cell.longitude, cell.latitude]).addTo(map));
        });
        return () => { nearbyRefs.current.forEach((marker) => marker.remove()); nearbyRefs.current = []; };
    }, [mapReady, JSON.stringify(nearbyDriverCells)]);

    // Road geometry from OSRM demo server is development-only; replace with production routing backend.
    useEffect(() => {
        const map = mapRef.current;
        if (!mapReady || !map) return;
        const starting = navigationMode && getPoint(driverLocation) ? getPoint(driverLocation) : getPoint(userLocation);
        const targets = [starting, ...(Array.isArray(stops) ? stops.map(getPoint) : []), getPoint(destination)].filter(Boolean);
        // Round only the route-request origin (~55 m) to limit requests to public OSRM.
        // The actual moving marker always keeps full GPS precision.
        const requestTargets = targets.map((p, index) => index === 0 && navigationMode
            ? [Math.round(p[0] * 2000) / 2000, Math.round(p[1] * 2000) / 2000]
            : p);
        const sourceId = "actual-road-route";
        const layerId = "actual-road-route-layer";
        let controller = new AbortController();
        let abandoned = false;

        async function drawRoute() {
            if (targets.length < 2) {
                if (map.getLayer(layerId)) map.removeLayer(layerId);
                if (map.getSource(sourceId)) map.removeSource(sourceId);
                setRouteInfo(null);
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
                if (map.getSource(sourceId)) map.getSource(sourceId).setData(data);
                else {
                    map.addSource(sourceId, { type: "geojson", data });
                    map.addLayer({ id: layerId, type: "line", source: sourceId, layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": "#1683e2", "line-width": 6, "line-opacity": 0.9 } });
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
                const info = {
                    distanceKm: Number((route.distance / 1000).toFixed(1)),
                    durationMinutes: Math.max(1, Math.ceil(route.duration / 60)),
                    nextStep: `${action}${direction ? ` ${direction}` : ""} ${road === "ahead" ? "" : `onto ${road}`}`.trim(),
                    stepDistanceMeters: Math.round(approachMeters),
                    estimateOnly: true,
                };
                setRouteInfo(info);
                onRouteUpdate?.(info);
                if (!followDriver && !navigationMode) {
                    const bounds = route.geometry.coordinates.reduce((box, coord) => box.extend(coord), new maplibregl.LngLatBounds(targets[0], targets[0]));
                    // Keep the pickup marker in the visible map region above the booking sheet.
                    // Only auto-fit the route when no booking panel is covering the map.
                    const mapHeight = map.getContainer().clientHeight;
                    map.fitBounds(bounds, { padding: { top: 90, bottom: Math.min(Math.round(mapHeight * 0.62), 650), left: 35, right: 35 }, maxZoom: 15, duration: 500 });
                    const pickupPoint = getPoint(userLocation);
                    if (pickupPoint) map.easeTo({ center: pickupPoint, zoom: Math.max(14, map.getZoom()), offset: [0, -Math.min(Math.round(mapHeight * 0.32), 300)], duration: 500 });
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
        // Trigger a new routing request after meaningful GPS movement (~55 m).
        Math.round((navigationMode && getPoint(driverLocation) ? getPoint(driverLocation)[0] : (getPoint(userLocation)?.[0] || 0)) * 2000),
        Math.round((navigationMode && getPoint(driverLocation) ? getPoint(driverLocation)[1] : (getPoint(userLocation)?.[1] || 0)) * 2000),
        JSON.stringify(stops)]);

    return (
        <div className="relative h-full w-full">
            <div ref={node} className="h-full w-full" />
            {navigationMode && routeInfo && (
                <div className="pointer-events-none absolute left-3 right-3 top-20 z-10 rounded-2xl bg-emerald-700 px-4 py-3 text-white shadow-xl">
                    <p className="text-xs font-semibold opacity-85">ROAD NAVIGATION · ESTIMATE</p>
                    <p className="mt-1 text-lg font-bold">{routeInfo.nextStep}</p>
                    <p className="text-sm">{routeInfo.stepDistanceMeters > 0 ? `${routeInfo.stepDistanceMeters} m to maneuver · ` : ""}{routeInfo.distanceKm} km · approx. {routeInfo.durationMinutes} min</p>
                </div>
            )}
            {routing && <div className="absolute bottom-28 left-3 rounded-xl bg-white/90 px-3 py-2 text-xs shadow">Loading road route…</div>}
            {error && <div role="status" className="absolute bottom-28 left-3 right-3 rounded-xl bg-white px-3 py-2 text-xs text-amber-700 shadow">{error}</div>}
        </div>
    );
}
