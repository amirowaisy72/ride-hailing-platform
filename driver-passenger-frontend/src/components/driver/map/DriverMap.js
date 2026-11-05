"use client";

import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Navigation, RotateCw } from "lucide-react";
import { apiRequest } from "@/lib/api";
import { useTheme } from "@/components/theme/ThemeProvider";
import { flagSvg, hailingPersonSvg } from "@/components/mapMarkerArt";
import {
    createVehicleElement, updateVehicleElement, setVehicleNight, isNightTime,
} from "@/components/driver/vehicleMarker";
import {
    bearingDegrees, buildRoute, distanceMeters, fetchOsrmRoute, navigationState,
    projectOnRoute, remainingCoordinates, shortestAngleDelta,
} from "@/components/driver/map/navMath";

maplibregl.setWorkerUrl("/maplibre-worker.mjs");

const ROUTE_SOURCE = "dm-route";
const PLACES_SOURCE = "safar-local-places";

// Same corridor LocalAddress dataset as the passenger map, converted to
// clustered GeoJSON points. Rendered muted and semi-transparent so the
// points stay background reference data, never competing with the live
// vehicle or ride-request markers.
function addressGeoJSON(addresses) {
    return {
        type: "FeatureCollection",
        features: (addresses || [])
            .filter((a) =>
                a.name?.trim() &&
                Number.isFinite(Number(a.latitude)) &&
                Number.isFinite(Number(a.longitude))
            )
            .map((a) => ({
                type: "Feature",
                geometry: {
                    type: "Point",
                    coordinates: [Number(a.longitude), Number(a.latitude)],
                },
                properties: { name: a.name },
            })),
    };
}
const OFF_ROUTE_METERS = 70;
const REROUTE_COOLDOWN_MS = 8000;
const FOLLOW_RESUME_MS = 10000;
const GLIDE_MS = 900;

const MARKER_STYLES = `
.dm-target{position:relative;display:flex;flex-direction:column;align-items:center;pointer-events:none}
.dm-target-label{margin-bottom:6px;padding:5px 12px;border-radius:9999px;background:#111;color:#fff;font:800 14px/1.1 system-ui,sans-serif;white-space:nowrap;box-shadow:0 4px 14px rgba(0,0,0,.35)}
.dark .dm-target-label{background:#fff;color:#111}
.dm-target-pin{position:relative;width:46px;height:46px;border-radius:50%;border:4px solid #fff;display:grid;place-items:center;box-shadow:0 8px 18px rgba(0,0,0,.4)}
.dm-target-pin--pickup{background:#087F5B}
.dm-target-pin--destination{background:#16181D}
.dm-target-pin::after{content:"";position:absolute;left:50%;top:calc(100% - 4px);transform:translateX(-50%);border:7px solid transparent;border-top:10px solid currentColor}
.dm-target-pin--pickup::after{color:#087F5B}
.dm-target-pin--destination::after{color:#16181D}
.dm-ride{position:relative;display:flex;flex-direction:column;align-items:center;border:0;background:none;padding:0;cursor:pointer;font-family:system-ui,sans-serif}
.dm-ride-pill{position:relative;display:flex;align-items:center;gap:6px;min-height:44px;padding:0 14px;border-radius:9999px;background:#087F5B;color:#fff;border:3px solid #fff;font-weight:900;font-size:16px;line-height:1;white-space:nowrap;box-shadow:0 8px 18px rgba(0,0,0,.38);transition:transform .15s ease,background .15s ease}
.dm-ride-pill svg{width:18px;height:18px}
.dm-ride-tail{width:0;height:0;margin-top:-2px;border:7px solid transparent;border-top:10px solid #fff}
.dm-ride-pulse{position:absolute;left:50%;top:22px;width:64px;height:64px;margin:-32px 0 0 -32px;border-radius:50%;background:rgba(8,127,91,.35);animation:dm-pulse 2s ease-out infinite;pointer-events:none}
.dm-ride.is-selected .dm-ride-pill{background:#111;transform:scale(1.14)}
.dark .dm-ride.is-selected .dm-ride-pill{background:#fff;color:#111;border-color:#087F5B}
.dm-ride:focus-visible .dm-ride-pill{outline:3px solid #fff;outline-offset:2px}
@keyframes dm-pulse{0%{transform:scale(.5);opacity:.9}100%{transform:scale(1.5);opacity:0}}
@media (prefers-reduced-motion: reduce){.dm-ride-pulse{animation:none;opacity:.35}}
.maplibregl-ctrl-attrib{font-size:10px}
`;

const getPoint = (point) => {
    if (!point) return null;
    const lng = Array.isArray(point.coordinates) ? Number(point.coordinates[0]) : Number(point.longitude);
    const lat = Array.isArray(point.coordinates) ? Number(point.coordinates[1]) : Number(point.latitude);
    return Number.isFinite(lng) && Number.isFinite(lat) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? [lng, lat] : null;
};

const lineFeature = (coordinates) => ({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates } });
const EMPTY_LINE = lineFeature([]);

function styleUrlForTheme(theme) {
    return theme === "dark"
        ? "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json"
        : "https://tiles.openfreemap.org/styles/liberty";
}

function softenDarkBackground(map, theme) {
    if (theme !== "dark") return;
    for (const layer of map.getStyle().layers || []) {
        if (layer.type === "background") map.setPaintProperty(layer.id, "background-color", "#292C32");
    }
}

function addRouteLayers(map, theme, data) {
    if (map.getSource(ROUTE_SOURCE)) return;
    const dark = theme === "dark";
    map.addSource(ROUTE_SOURCE, { type: "geojson", data });
    const beforeId = (map.getStyle().layers || []).find((layer) => layer.type === "symbol")?.id;
    const round = { "line-join": "round", "line-cap": "round" };
    if (dark) {
        map.addLayer({ id: "dm-route-glow", type: "line", source: ROUTE_SOURCE, layout: round, paint: { "line-color": "#34D399", "line-width": 18, "line-blur": 10, "line-opacity": 0.3 } }, beforeId);
    }
    map.addLayer({ id: "dm-route-casing", type: "line", source: ROUTE_SOURCE, layout: round, paint: { "line-color": dark ? "#0B0D10" : "#FFFFFF", "line-width": ["interpolate", ["linear"], ["zoom"], 12, 8, 17, 16], "line-opacity": 0.95 } }, beforeId);
    map.addLayer({ id: "dm-route-line", type: "line", source: ROUTE_SOURCE, layout: round, paint: { "line-color": dark ? "#34D399" : "#087F5B", "line-width": ["interpolate", ["linear"], ["zoom"], 12, 4.5, 17, 10] } }, beforeId);
}

function targetElement(kind) {
    const element = document.createElement("div");
    element.className = "dm-target";
    const label = kind === "destination" ? "Drop-off" : "Pickup";
    const glyph = kind === "destination" ? flagSvg("#FFFFFF", 22) : hailingPersonSvg("#FFFFFF", 24);
    element.innerHTML = `<span class="dm-target-label">${label}</span><span class="dm-target-pin dm-target-pin--${kind}">${glyph}</span>`;
    element.setAttribute("aria-label", label);
    return element;
}

const PERSON_ICON = hailingPersonSvg("#FFFFFF", 18);

function rideElement(ride, selected, onSelect) {
    const element = document.createElement("button");
    element.type = "button";
    element.className = `dm-ride${selected ? " is-selected" : ""}`;
    element.setAttribute("aria-label", `Ride from ${ride.label || "passenger"}${ride.fare ? `, fare ${ride.fare}` : ""}. Tap to see details`);
    element.innerHTML = `${selected ? "" : `<span class="dm-ride-pulse"></span>`}<span class="dm-ride-pill">${PERSON_ICON}${ride.fare || "Ride"}</span><span class="dm-ride-tail"></span>`;
    element.addEventListener("click", (event) => {
        event.stopPropagation();
        onSelect?.(ride.id);
    });
    return element;
}

/**
 * The driver's map. Shows the live vehicle, nearby ride requests and, during
 * a ride, a route line with turn-by-turn progress. Data in/out is the same as
 * before: `driverLocation`, `destination`, `onRouteUpdate`.
 *
 * rideRequests: [{ id, point, fare, label }] — tapping calls onRideSelect(id).
 * routeProvider(from, to, signal) → OSRM-shaped route; defaults to OSRM.
 */
export default function DriverMap({
    driverLocation = null,
    vehicleType = null,
    vehicleColor = null,
    destination = null,
    targetKind = "pickup",
    navigationMode = false,
    rideRequests = [],
    selectedRideId = null,
    onRideSelect = null,
    onRouteUpdate = null,
    locateRequest = 0,
    token = null,
    sheetRatio = 0.3,
    routeProvider = fetchOsrmRoute,
    center = [69.3451, 30.3753],
}) {
    const { resolvedTheme } = useTheme();
    const nodeRef = useRef(null);
    const mapRef = useRef(null);
    const vehicleRef = useRef(null);
    const targetRef = useRef(null);
    const rideMarkersRef = useRef([]);
    const routeRef = useRef(null);
    const remainingRef = useRef(EMPTY_LINE);
    const driverPointRef = useRef(null);
    const shownPointRef = useRef(null);
    const headingRef = useRef(0);
    const animRef = useRef(0);
    const followRef = useRef(true);
    const resumeTimerRef = useRef(0);
    const offRouteRef = useRef({ count: 0, lastReroute: 0 });
    const emitKeyRef = useRef("");
    const framedKeyRef = useRef("");
    const themeRef = useRef(resolvedTheme);
    const appliedThemeRef = useRef(null);
    const navRef = useRef(navigationMode);
    const sheetRef = useRef(sheetRatio);
    const toManeuverRef = useRef(Infinity);
    const routeUpdateRef = useRef(onRouteUpdate);
    const selectRef = useRef(onRideSelect);
    const [mapReady, setMapReady] = useState(false);
    const [styleEpoch, setStyleEpoch] = useState(0);
    const [following, setFollowing] = useState(true);
    const [rerouteTick, setRerouteTick] = useState(0);
    const [routeError, setRouteError] = useState(false);
    // Keep latest props in refs for map callbacks. This runs after every
    // render (no dep array) so callbacks always see fresh values without
    // assigning refs during render.
    useEffect(() => {
        themeRef.current = resolvedTheme;
        navRef.current = navigationMode;
        sheetRef.current = sheetRatio;
        routeUpdateRef.current = onRouteUpdate;
        selectRef.current = onRideSelect;
    });

    // Adjusting state when a prop changes (React's documented pattern):
    // entering/leaving navigation re-enables following before paint.
    const [prevNavigationMode, setPrevNavigationMode] = useState(navigationMode);
    if (prevNavigationMode !== navigationMode) {
        setPrevNavigationMode(navigationMode);
        setFollowing(true);
    }

    // Same pattern for locate requests (a counter prop): remember the
    // request before paint so the camera effect below only moves the map.
    const [prevLocateRequest, setPrevLocateRequest] = useState(locateRequest);
    if (prevLocateRequest !== locateRequest) {
        setPrevLocateRequest(locateRequest);
        setFollowing(true);
    }

    // Keep the follow flag in sync with state. Refs may only be written
    // in effects and handlers, never during render.
    useEffect(() => {
        followRef.current = following;
    }, [following]);

    const destinationPoint = getPoint(destination);
    const destinationKey = destinationPoint ? destinationPoint.map((v) => v.toFixed(5)).join(",") : "";
    const driverPoint = getPoint(driverLocation);
    const hasDriver = Boolean(driverPoint);

    function setFollow(value) {
        followRef.current = value;
        setFollowing(value);
    }

    function padding() {
        const map = mapRef.current;
        const height = map ? map.getContainer().clientHeight : 700;
        const bottom = Math.max(40, Math.min(Math.round(height * sheetRef.current), height - 220));
        return { top: navRef.current ? 210 : 120, bottom: bottom + 16, left: 0, right: 0 };
    }

    function zoomFor(toManeuver) {
        if (!navRef.current) return 15.5;
        if (toManeuver < 200) return 17.4;
        if (toManeuver < 700) return 16.8;
        return 16.2;
    }

    function moveCamera(point, { duration = GLIDE_MS } = {}) {
        const map = mapRef.current;
        if (!map || !point) return;
        map.easeTo({
            center: point,
            zoom: zoomFor(toManeuverRef.current),
            bearing: navRef.current ? headingRef.current : 0,
            pitch: navRef.current ? 52 : 0,
            padding: padding(),
            duration,
            essential: true,
        });
    }

    function pauseFollow() {
        if (!followRef.current) return;
        setFollow(false);
        window.clearTimeout(resumeTimerRef.current);
        if (navRef.current) {
            resumeTimerRef.current = window.setTimeout(() => {
                setFollow(true);
                moveCamera(shownPointRef.current || driverPointRef.current, { duration: 600 });
            }, FOLLOW_RESUME_MS);
        }
    }

    function recenter() {
        window.clearTimeout(resumeTimerRef.current);
        setFollow(true);
        moveCamera(shownPointRef.current || driverPointRef.current, { duration: 600 });
    }

    function emit(info) {
        routeUpdateRef.current?.(info);
    }

    function applyProgress(point) {
        const route = routeRef.current;
        const map = mapRef.current;
        if (!route) return;
        const projection = projectOnRoute(route, point);
        route.hint = projection.index;
        remainingRef.current = lineFeature(remainingCoordinates(route, projection));
        map?.getSource(ROUTE_SOURCE)?.setData(remainingRef.current);
        const state = navigationState(route, projection.progress);
        toManeuverRef.current = state.toManeuver;
        const key = `${Math.round(state.remaining / 10)}|${Math.round(state.toManeuver / 10)}|${state.kind}`;
        if (key !== emitKeyRef.current) {
            emitKeyRef.current = key;
            const km = Number((state.remaining / 1000).toFixed(1));
            const minutes = Math.max(1, Math.ceil(state.remainingSeconds / 60));
            emit({
                status: "ok",
                distanceKm: km,
                durationMinutes: minutes,
                remainingMeters: Math.round(state.remaining),
                nextStep: `${state.text}${state.road ? ` ${state.road}` : ""}`,
                text: state.text,
                road: state.road,
                maneuver: state.kind,
                stepDistanceMeters: Math.round(state.toManeuver),
                arrived: state.arrived,
                nextLegDistanceKm: km,
                nextLegDurationMinutes: minutes,
                estimateOnly: true,
            });
        }
        const off = offRouteRef.current;
        if (projection.deviation > OFF_ROUTE_METERS && !state.arrived) {
            off.count += 1;
            if (off.count >= 2 && Date.now() - off.lastReroute > REROUTE_COOLDOWN_MS) {
                off.lastReroute = Date.now();
                off.count = 0;
                emit({ status: "rerouting" });
                setRerouteTick((tick) => tick + 1);
            }
        } else {
            off.count = 0;
        }
    }

    // Create the map once; theme changes restyle it in place.
    useEffect(() => {
        if (!nodeRef.current || mapRef.current) return undefined;
        appliedThemeRef.current = themeRef.current;
        const map = new maplibregl.Map({
            container: nodeRef.current,
            style: styleUrlForTheme(themeRef.current),
            center,
            zoom: 15,
            attributionControl: false,
            maxPitch: 60,
        });
        mapRef.current = map;
        map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-left");
        map.on("load", () => {
            softenDarkBackground(map, appliedThemeRef.current);
            setMapReady(true);
        });
        const onUserMove = (event) => { if (event.originalEvent) pauseFollow(); };
        map.on("dragstart", onUserMove);
        map.on("zoomstart", onUserMove);
        map.on("rotatestart", onUserMove);
        map.on("pitchstart", onUserMove);
        map.on("error", (event) => console.warn("Map resource issue", event?.error?.message));
        const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => map.resize()) : null;
        observer?.observe(nodeRef.current);
        return () => {
            observer?.disconnect();
            cancelAnimationFrame(animRef.current);
            window.clearTimeout(resumeTimerRef.current);
            vehicleRef.current?.remove();
            targetRef.current?.remove();
            rideMarkersRef.current.forEach((marker) => marker.remove());
            vehicleRef.current = targetRef.current = null;
            rideMarkersRef.current = [];
            map.remove();
            mapRef.current = null;
            setMapReady(false);
        };
        // Mount-only
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        const map = mapRef.current;
        if (!map || !mapReady || appliedThemeRef.current === resolvedTheme) return undefined;
        appliedThemeRef.current = resolvedTheme;
        map.setStyle(styleUrlForTheme(resolvedTheme));
        const onStyleLoad = () => {
            if (mapRef.current !== map) return;
            softenDarkBackground(map, resolvedTheme);
            setStyleEpoch((epoch) => epoch + 1);
        };
        map.once("style.load", onStyleLoad);
        return () => { map.off("style.load", onStyleLoad); };
    }, [resolvedTheme, mapReady]);

    // Route layers live in the style, so they are (re)added after every style swap.
    useEffect(() => {
        const map = mapRef.current;
        if (!map || !mapReady) return;
        addRouteLayers(map, themeRef.current, remainingRef.current);
    }, [mapReady, styleEpoch]);

    // Corridor location points (LocalAddress dataset, same as the
    // passenger map): muted clustered dots, background only. Like the
    // route layers they are (re)added after every style swap, and the
    // data reloads for the visible bounds whenever the map moves.
    useEffect(() => {
        const map = mapRef.current;
        if (!map || !mapReady || !token) return undefined;
        const dark = themeRef.current === "dark";
        const placesMuted = dark ? "#4F7263" : "#86A696";
        // Keep the points under the route lines when a route is drawn.
        const beforeId = ["dm-route-glow", "dm-route-casing", "dm-route-line"].find((id) => map.getLayer(id));
        if (!map.getSource(PLACES_SOURCE)) {
            map.addSource(PLACES_SOURCE, {
                type: "geojson",
                data: addressGeoJSON([]),
                cluster: true,
                clusterMaxZoom: 15,
                clusterRadius: 50,
            });
            map.addLayer({
                id: "safar-local-cluster-halo",
                type: "circle",
                source: PLACES_SOURCE,
                filter: ["has", "point_count"],
                paint: {
                    "circle-color": placesMuted,
                    "circle-opacity": dark ? 0.13 : 0.16,
                    "circle-radius": ["step", ["get", "point_count"], 16, 10, 20, 50, 25],
                },
            }, beforeId);
            map.addLayer({
                id: "safar-local-clusters",
                type: "circle",
                source: PLACES_SOURCE,
                filter: ["has", "point_count"],
                paint: {
                    "circle-color": placesMuted,
                    "circle-opacity": 0.55,
                    "circle-radius": ["step", ["get", "point_count"], 12, 10, 15, 50, 19],
                    "circle-stroke-color": "#FFFFFF",
                    "circle-stroke-opacity": 0.65,
                    "circle-stroke-width": 1.5,
                },
            }, beforeId);
            map.addLayer({
                id: "safar-local-cluster-count",
                type: "symbol",
                source: PLACES_SOURCE,
                filter: ["has", "point_count"],
                layout: {
                    "text-field": ["get", "point_count_abbreviated"],
                    "text-font": ["Open Sans Semibold"],
                    "text-size": 11,
                },
                paint: { "text-color": "#FFFFFF", "text-opacity": 0.95 },
            }, beforeId);
            map.addLayer({
                id: "safar-local-dots",
                type: "circle",
                source: PLACES_SOURCE,
                filter: ["!", ["has", "point_count"]],
                minzoom: 15,
                paint: {
                    "circle-radius": ["interpolate", ["linear"], ["zoom"], 15, 4.5, 18, 5.5],
                    "circle-color": placesMuted,
                    "circle-opacity": 0.8,
                    "circle-stroke-width": 1.5,
                    "circle-stroke-color": "#FFFFFF",
                    "circle-stroke-opacity": 0.85,
                },
            }, beforeId);
            map.addLayer({
                id: "safar-local-labels",
                type: "symbol",
                source: PLACES_SOURCE,
                filter: ["!", ["has", "point_count"]],
                minzoom: 16,
                layout: {
                    "text-field": [
                        "case",
                        [">", ["length", ["get", "name"]], 22],
                        ["concat", ["slice", ["get", "name"], 0, 22], "…"],
                        ["get", "name"]
                    ],
                    "text-size": ["interpolate", ["linear"], ["zoom"], 16, 10, 18, 11],
                    "text-font": ["Open Sans Semibold"],
                    "text-variable-anchor": ["top", "bottom", "left", "right"],
                    "text-radial-offset": 1.5,
                    "text-justify": "auto",
                    "text-max-width": 16,
                    "text-padding": 12,
                    "text-optional": true,
                    "text-letter-spacing": 0.02,
                    "text-allow-overlap": false,
                    "text-ignore-placement": false,
                    "symbol-sort-key": 1,
                },
                paint: {
                    "text-color": dark ? "#D7E0DA" : "#3D4A44",
                    "text-opacity": 0.9,
                    "text-halo-color": dark ? "#16181D" : "#FFFFFF",
                    "text-halo-width": 2,
                    "text-halo-blur": 0.5,
                },
            }, beforeId);
        }
        let cancelled = false;
        async function loadVisiblePlaces() {
            if (cancelled || map.getZoom() < 14) return;
            const bounds = map.getBounds();
            const params = new URLSearchParams({
                west: String(bounds.getWest()),
                south: String(bounds.getSouth()),
                east: String(bounds.getEast()),
                north: String(bounds.getNorth()),
            });
            try {
                const data = await apiRequest(`/service-areas/local-addresses/map?${params}`, { token });
                if (!cancelled && map.getSource(PLACES_SOURCE)) {
                    map.getSource(PLACES_SOURCE).setData(addressGeoJSON(data.addresses || []));
                }
            } catch (error) {
                console.warn("Local map labels:", error.message);
            }
        }
        const handleClusterClick = (event) => {
            const feature = event.features?.[0];
            if (!feature) return;
            const fallback = () => {
                map.easeTo({
                    center: feature.geometry.coordinates,
                    zoom: Math.min(map.getZoom() + 2, 20),
                    duration: 500,
                });
            };
            const source = map.getSource(PLACES_SOURCE);
            const clusterId = feature.properties?.cluster_id;
            if (source && typeof source.getClusterExpansionZoom === "function" && clusterId != null) {
                source.getClusterExpansionZoom(clusterId, (error, zoom) => {
                    if (error || !Number.isFinite(zoom)) {
                        fallback();
                        return;
                    }
                    map.easeTo({ center: feature.geometry.coordinates, zoom: Math.min(zoom, 20), duration: 500 });
                });
            } else {
                fallback();
            }
        };
        const handleClusterEnter = () => { map.getCanvas().style.cursor = "pointer"; };
        const handleClusterLeave = () => { map.getCanvas().style.cursor = ""; };
        loadVisiblePlaces();
        map.on("moveend", loadVisiblePlaces);
        map.on("click", "safar-local-clusters", handleClusterClick);
        map.on("mouseenter", "safar-local-clusters", handleClusterEnter);
        map.on("mouseleave", "safar-local-clusters", handleClusterLeave);
        return () => {
            cancelled = true;
            map.off("moveend", loadVisiblePlaces);
            map.off("click", "safar-local-clusters", handleClusterClick);
            map.off("mouseenter", "safar-local-clusters", handleClusterEnter);
            map.off("mouseleave", "safar-local-clusters", handleClusterLeave);
        };
    }, [mapReady, styleEpoch, token]);

    // Fetch the road route to the current target; refetch when the target changes or the driver leaves the line.
    useEffect(() => {
        const map = mapRef.current;
        if (!mapReady || !map) return undefined;
        const from = driverPointRef.current;
        if (!navigationMode || !destinationPoint || !from) {
            routeRef.current = null;
            remainingRef.current = EMPTY_LINE;
            map.getSource(ROUTE_SOURCE)?.setData(EMPTY_LINE);
            emitKeyRef.current = "";
            toManeuverRef.current = Infinity;
            setRouteError(false);
            if (!navigationMode) emit(null);
            return undefined;
        }
        if (distanceMeters(from, destinationPoint) < 25) {
            routeRef.current = null;
            remainingRef.current = EMPTY_LINE;
            map.getSource(ROUTE_SOURCE)?.setData(EMPTY_LINE);
            emit({ status: "ok", distanceKm: 0, durationMinutes: 0, remainingMeters: 0, nextStep: "You have arrived", text: "You have arrived", road: "", maneuver: "arrive", stepDistanceMeters: 0, arrived: true, estimateOnly: true });
            return undefined;
        }
        const controller = new AbortController();
        let abandoned = false;
        setRouteError(false);
        if (!routeRef.current) emit({ status: "loading" });
        (async () => {
            try {
                const osrm = await routeProvider(from, destinationPoint, controller.signal);
                if (abandoned) return;
                routeRef.current = buildRoute(osrm);
                emitKeyRef.current = "";
                offRouteRef.current.count = 0;
                applyProgress(driverPointRef.current || from);
            } catch (error) {
                if (abandoned || error?.name === "AbortError") return;
                setRouteError(true);
                emit({ status: "error" });
            }
        })();
        return () => { abandoned = true; controller.abort(); };
        // The route is requested per target / reroute, never per GPS fix.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [mapReady, navigationMode, destinationKey, hasDriver, rerouteTick]);

    // Live position: glide the vehicle, turn it, advance route progress, follow with the camera.
    useEffect(() => {
        const map = mapRef.current;
        if (!map || !mapReady) return;
        if (!driverPoint) {
            vehicleRef.current?.remove();
            vehicleRef.current = null;
            driverPointRef.current = null;
            return;
        }
        const previous = driverPointRef.current;
        driverPointRef.current = driverPoint;
        const night = isNightTime(themeRef.current);
        if (!vehicleRef.current) {
            vehicleRef.current = new maplibregl.Marker({
                element: createVehicleElement(vehicleType, vehicleColor, night),
                rotationAlignment: "map",
                pitchAlignment: "map",
            }).setLngLat(driverPoint).addTo(map);
            shownPointRef.current = driverPoint;
        } else {
            const from = shownPointRef.current || driverPoint;
            const jump = distanceMeters(from, driverPoint) > 2000;
            const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
            cancelAnimationFrame(animRef.current);
            if (jump || reduce) {
                vehicleRef.current.setLngLat(driverPoint);
                shownPointRef.current = driverPoint;
            } else {
                const startedAt = performance.now();
                const step = (time) => {
                    const t = Math.min(1, (time - startedAt) / GLIDE_MS);
                    const eased = t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2;
                    const next = [from[0] + (driverPoint[0] - from[0]) * eased, from[1] + (driverPoint[1] - from[1]) * eased];
                    vehicleRef.current?.setLngLat(next);
                    shownPointRef.current = next;
                    if (t < 1) animRef.current = requestAnimationFrame(step);
                };
                animRef.current = requestAnimationFrame(step);
            }
        }
        if (previous && distanceMeters(previous, driverPoint) > 3) {
            const target = bearingDegrees(previous, driverPoint);
            if (target != null) {
                headingRef.current = (headingRef.current + shortestAngleDelta(headingRef.current, target) * 0.65 + 360) % 360;
                vehicleRef.current?.setRotation(headingRef.current);
            }
        }
        applyProgress(driverPoint);
        if (navRef.current) {
            if (followRef.current) moveCamera(driverPoint);
        } else if (!previous) {
            moveCamera(driverPoint, { duration: 0 });
        } else {
            const pixel = map.project(driverPoint);
            const { clientWidth: w, clientHeight: h } = map.getContainer();
            const pad = padding();
            if (pixel.x < 40 || pixel.x > w - 40 || pixel.y < pad.top || pixel.y > h - pad.bottom) moveCamera(driverPoint);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [mapReady, driverPoint?.[0], driverPoint?.[1]]);

    useEffect(() => {
        const element = vehicleRef.current?.getElement();
        if (element) updateVehicleElement(element, vehicleType, vehicleColor, isNightTime(resolvedTheme));
    }, [vehicleType, vehicleColor, resolvedTheme, mapReady, hasDriver]);

    useEffect(() => {
        const apply = () => setVehicleNight(vehicleRef.current?.getElement(), isNightTime(resolvedTheme));
        apply();
        const timer = window.setInterval(apply, 60000);
        return () => window.clearInterval(timer);
    }, [resolvedTheme, mapReady]);

    // Entering or leaving navigation resets the camera to the right view.
    // (Following is already re-enabled in the render-phase adjustment above.)
    useEffect(() => {
        if (!mapReady) return;
        const point = shownPointRef.current || driverPointRef.current;
        if (point) moveCamera(point, { duration: 700 });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [mapReady, navigationMode]);

    useEffect(() => {
        if (!mapReady || !locateRequest) return;
        moveCamera(shownPointRef.current || driverPointRef.current, { duration: 600 });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [locateRequest]);

    useEffect(() => {
        if (!mapReady || !followRef.current) return;
        moveCamera(shownPointRef.current || driverPointRef.current, { duration: 400 });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sheetRatio]);

    // Target (pickup or drop-off) marker.
    useEffect(() => {
        const map = mapRef.current;
        if (!map || !mapReady) return undefined;
        targetRef.current?.remove();
        targetRef.current = null;
        if (destinationPoint && navigationMode) {
            targetRef.current = new maplibregl.Marker({ element: targetElement(targetKind), anchor: "bottom" })
                .setLngLat(destinationPoint).addTo(map);
        }
        return () => { targetRef.current?.remove(); targetRef.current = null; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [mapReady, destinationKey, targetKind, navigationMode]);

    // Nearby ride requests, with the fare on each pin.
    const ridesKey = JSON.stringify(rideRequests.map((r) => [r.id, r.fare, getPoint(r.point)]));
    useEffect(() => {
        const map = mapRef.current;
        if (!map || !mapReady) return undefined;
        rideMarkersRef.current.forEach((marker) => marker.remove());
        rideMarkersRef.current = [];
        for (const ride of rideRequests) {
            const point = getPoint(ride.point);
            if (!point) continue;
            const element = rideElement(ride, ride.id === selectedRideId, (id) => selectRef.current?.(id));
            rideMarkersRef.current.push(new maplibregl.Marker({ element, anchor: "bottom" }).setLngLat(point).addTo(map));
        }
        return () => { rideMarkersRef.current.forEach((marker) => marker.remove()); rideMarkersRef.current = []; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [mapReady, ridesKey, selectedRideId]);

    // When new requests arrive while idle, frame the driver and the requests together once.
    useEffect(() => {
        const map = mapRef.current;
        if (!map || !mapReady || navigationMode || !rideRequests.length) {
            if (!rideRequests.length) framedKeyRef.current = "";
            return;
        }
        const you = driverPointRef.current;
        const key = rideRequests.map((r) => r.id).sort().join("|");
        if (!you || framedKeyRef.current === key) return;
        framedKeyRef.current = key;
        const points = [you, ...rideRequests.map((r) => getPoint(r.point)).filter(Boolean)];
        const bounds = points.reduce((box, p) => box.extend(p), new maplibregl.LngLatBounds(you, you));
        const pad = padding();
        map.fitBounds(bounds, { padding: { top: pad.top + 40, bottom: pad.bottom + 20, left: 56, right: 56 }, maxZoom: 16, duration: 800 });
    }, [mapReady, navigationMode, hasDriver, ridesKey, rideRequests]);

    const showBackToNav = navigationMode && !following;

    return (
        <div className="relative h-full w-full">
            <style>{MARKER_STYLES}</style>
            <div ref={nodeRef} className="h-full w-full" />
            {showBackToNav && (
                <button
                    type="button"
                    onClick={recenter}
                    style={{ bottom: `calc(${Math.round(sheetRatio * 100)}% + 16px)` }}
                    className="absolute left-1/2 z-20 flex min-h-14 -translate-x-1/2 items-center gap-2 rounded-full bg-pd-accent px-6 text-lg font-extrabold text-pd-accent-ink shadow-[0_8px_24px_rgba(0,0,0,0.35)]"
                >
                    <Navigation size={22} aria-hidden /> Back to navigation
                </button>
            )}
            {routeError && navigationMode && (
                <div role="alert" className="absolute left-1/2 top-[calc(max(16px,env(safe-area-inset-top))+150px)] z-20 flex w-[min(92vw,420px)] -translate-x-1/2 items-center gap-3 rounded-2xl bg-pd-surface p-3 text-pd-text shadow-[0_8px_24px_rgba(0,0,0,0.3)]">
                    <p className="min-w-0 flex-1 text-base font-bold">Directions are not loading. Check your internet.</p>
                    <button
                        type="button"
                        onClick={() => setRerouteTick((tick) => tick + 1)}
                        className="flex min-h-12 shrink-0 items-center gap-2 rounded-xl bg-pd-ink px-4 text-base font-extrabold text-pd-ink-text"
                    >
                        <RotateCw size={18} aria-hidden /> Try again
                    </button>
                </div>
            )}
        </div>
    );
}
