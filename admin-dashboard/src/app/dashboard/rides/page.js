
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
    Activity, CarFront, ChevronLeft, ChevronRight,
    Clock3, Map as MapIcon, RefreshCw, Route, Wallet, X,
} from "lucide-react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

maplibregl.setWorkerUrl("/maplibre-worker.mjs");

import AdminShell from "@/components/AdminShell";
import { authenticatedAdminRequest } from "@/lib/adminSession";

const filters = [
    { id: "ALL", label: "All Rides" },
    { id: "ACTIVE", label: "Active" },
    { id: "TRIP_COMPLETED", label: "Completed" },
    { id: "CANCELLED", label: "Cancelled" },
];

const statusNames = {
    REQUESTED: "Requested",
    SEARCHING: "Searching",
    BIDDING: "Bidding",
    DRIVER_SELECTED: "Driver Selected",
    DRIVER_EN_ROUTE: "Driver En Route",
    DRIVER_ARRIVED: "Driver Arrived",
    TRIP_STARTED: "Trip In Progress",
    TRIP_COMPLETED: "Completed",
    CANCELLED: "Cancelled",
    EXPIRED: "Expired",
    REASSIGNING: "Reassigning",
};

const money = (value) =>
    value == null
        ? "—"
        : `PKR ${Number(value).toLocaleString("en-PK")}`;

const formatDate = (date) =>
    date
        ? new Date(date).toLocaleString("en-PK", {
            dateStyle: "medium",
            timeStyle: "short",
        })
        : "—";

// GeoJSON Point -> MapLibre [lng, lat]. Null when not saved.
const pointOf = (place) =>
    place?.coordinates?.length === 2
        ? [place.coordinates[0], place.coordinates[1]]
        : null;

function StatusBadge({ status }) {
    const color =
        status === "TRIP_COMPLETED"
            ? "bg-emerald-50 text-emerald-700"
            : status === "CANCELLED" || status === "EXPIRED"
                ? "bg-red-50 text-red-600"
                : "bg-amber-50 text-amber-700";

    return (
        <span className={`inline-block rounded-lg px-3 py-1.5 text-xs font-bold ${color}`}>
            {statusNames[status] || status}
        </span>
    );
}

export default function RidesManagementPage() {
    const [rides, setRides] = useState([]);
    const [filter, setFilter] = useState("ALL");
    const [page, setPage] = useState(1);
    const [pagination, setPagination] = useState({});
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [mapRide, setMapRide] = useState(null);
    const [routeInfo, setRouteInfo] = useState(null);
    const mapContainerRef = useRef(null);
    const mapRef = useRef(null);

    const loadRides = useCallback(async () => {
        setLoading(true);
        setError("");

        try {
            const params = new URLSearchParams({
                page: String(page),
                status: filter,
            });

            const data = await authenticatedAdminRequest(
                `/admin/operations/rides?${params.toString()}`
            );

            setRides(data.rides || []);
            setPagination(data.pagination || {});
        } catch (err) {
            setRides([]);
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, [filter, page]);

    useEffect(() => {
        loadRides();
    }, [loadRides]);

    useEffect(() => {
        if (!mapRide) return undefined;
        const onKey = (event) => {
            if (event.key === "Escape") setMapRide(null);
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [mapRide]);

    // Full-page ride map: same MapLibre + openfreemap style and same
    // OSRM road route as the main app's RideMap. Falls back to a
    // straight pickup-to-destination line if OSRM is unreachable.
    useEffect(() => {
        if (!mapRide) {
            if (mapRef.current) {
                mapRef.current.remove();
                mapRef.current = null;
            }
            return undefined;
        }
        const container = mapContainerRef.current;
        if (!container) return undefined;
        const pickup = pointOf(mapRide.pickup);
        const destination = pointOf(mapRide.destination);
        if (!pickup || !destination) return undefined;
        const stops = (mapRide.stops || []).map(pointOf).filter(Boolean);
        const waypoints = [pickup, ...stops, destination];

        const map = new maplibregl.Map({
            container,
            style: "https://tiles.openfreemap.org/styles/liberty",
            center: pickup,
            zoom: 12,
        });
        mapRef.current = map;
        map.addControl(new maplibregl.NavigationControl(), "top-right");

        const markers = [];
        let cancelled = false;
        map.on("load", async () => {
            if (cancelled) return;
            map.resize();
            const addMarker = (point, color, label) => {
                markers.push(
                    new maplibregl.Marker({ color })
                        .setLngLat(point)
                        .setPopup(
                            new maplibregl.Popup({ offset: 25 }).setText(label)
                        )
                        .addTo(map)
                );
            };
            addMarker(pickup, "#087F5B", "Pickup");
            stops.forEach((stop, index) =>
                addMarker(stop, "#f59e0b", `Stop ${index + 1}`)
            );
            addMarker(destination, "#111111", "Destination");

            const bounds = waypoints.reduce(
                (box, point) => box.extend(point),
                new maplibregl.LngLatBounds(waypoints[0], waypoints[0])
            );
            const drawLine = (coords) => {
                if (cancelled || map.getSource("ride-route")) return;
                map.addSource("ride-route", {
                    type: "geojson",
                    data: {
                        type: "Feature",
                        properties: {},
                        geometry: { type: "LineString", coordinates: coords },
                    },
                });
                map.addLayer({
                    id: "ride-route-casing",
                    type: "line",
                    source: "ride-route",
                    layout: { "line-join": "round", "line-cap": "round" },
                    paint: {
                        "line-color": "#ffffff",
                        "line-width": 10,
                        "line-opacity": 0.95,
                    },
                });
                map.addLayer({
                    id: "ride-route-line",
                    type: "line",
                    source: "ride-route",
                    layout: { "line-join": "round", "line-cap": "round" },
                    paint: {
                        "line-color": "#111111",
                        "line-width": 5.5,
                        "line-opacity": 0.92,
                    },
                });
                map.fitBounds(bounds, { padding: 60 });
            };
            try {
                const coords = waypoints
                    .map((point) => `${point[0]},${point[1]}`)
                    .join(";");
                const response = await fetch(
                    `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson`
                );
                if (!response.ok) throw new Error("OSRM unavailable");
                const result = await response.json();
                const route = result.routes?.[0];
                if (!route?.geometry?.coordinates?.length) {
                    throw new Error("No route");
                }
                if (cancelled) return;
                setRouteInfo({
                    distanceKm: Number((route.distance / 1000).toFixed(1)),
                    durationMinutes: Math.max(
                        1,
                        Math.ceil(route.duration / 60)
                    ),
                });
                drawLine(route.geometry.coordinates);
            } catch {
                drawLine(waypoints);
            }
        });

        return () => {
            cancelled = true;
            markers.forEach((marker) => marker.remove());
            map.remove();
            mapRef.current = null;
        };
    }, [mapRide]);

    function changeFilter(nextFilter) {
        setFilter(nextFilter);
        setPage(1);
    }

    return (
        <AdminShell title="Ride Management">
            <div className="space-y-6">
                <section className="flex flex-wrap items-start justify-between gap-4 rounded-[24px] bg-white p-6 shadow-sm">
                    <div>
                        <p className="text-xs font-bold uppercase tracking-wider text-[#087F5B]">
                            Ride Operations
                        </p>
                        <h2 className="mt-2 text-2xl font-extrabold">
                            Ride Management
                        </h2>
                        <p className="mt-2 text-sm text-slate-500">
                            Monitor trip requests, active rides, completed
                            journeys and settlement statuses.
                        </p>
                    </div>

                    <button
                        type="button"
                        onClick={loadRides}
                        disabled={loading}
                        className="flex items-center gap-2 rounded-xl border px-4 py-3 text-sm font-bold disabled:opacity-50"
                    >
                        <RefreshCw
                            size={17}
                            className={loading ? "animate-spin" : ""}
                        />
                        Refresh
                    </button>
                </section>

                <section className="rounded-[24px] bg-white p-5 shadow-sm">
                    <div className="flex items-center gap-3">
                        <div className="rounded-xl bg-emerald-50 p-3 text-[#087F5B]">
                            <Route size={24} />
                        </div>

                        <div>
                            <p className="text-sm text-slate-500">
                                Matching Rides
                            </p>
                            <p className="text-3xl font-extrabold">
                                {loading ? "—" : pagination.total ?? 0}
                            </p>
                        </div>
                    </div>
                </section>

                <section className="overflow-hidden rounded-[24px] bg-white shadow-sm">
                    <div className="flex flex-wrap gap-2 border-b p-5">
                        {filters.map((item) => (
                            <button
                                key={item.id}
                                type="button"
                                onClick={() => changeFilter(item.id)}
                                className={`rounded-xl px-4 py-3 text-xs font-bold ${filter === item.id
                                        ? "bg-[#087F5B] text-white"
                                        : "bg-slate-100 text-slate-600"
                                    }`}
                            >
                                {item.label}
                            </button>
                        ))}
                    </div>

                    {error && (
                        <p
                            role="alert"
                            className="m-5 rounded-xl bg-red-50 p-4 text-sm text-red-600"
                        >
                            {error}
                        </p>
                    )}

                    {loading ? (
                        <p className="p-10 text-center text-sm text-slate-500">
                            Loading rides...
                        </p>
                    ) : !error && rides.length === 0 ? (
                        <div className="p-10 text-center">
                            <CarFront
                                size={36}
                                className="mx-auto text-[#087F5B]"
                            />
                            <p className="mt-3 font-bold">
                                No rides found
                            </p>
                            <p className="mt-2 text-sm text-slate-500">
                                Ride records will appear here.
                            </p>
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full min-w-[1200px] text-left text-sm">
                                <thead className="bg-slate-50 text-xs text-slate-500">
                                    <tr>
                                        <th className="px-5 py-4">Ride</th>
                                        <th className="px-5 py-4">Passenger</th>
                                        <th className="px-5 py-4">Vehicle</th>
                                        <th className="px-5 py-4">Status</th>
                                        <th className="px-5 py-4">Requested Fare</th>
                                        <th className="px-5 py-4">Final Fare</th>
                                        <th className="px-5 py-4">Settlement</th>
                                        <th className="px-5 py-4">Booked</th>
                                        <th className="px-5 py-4">Map</th>
                                    </tr>
                                </thead>

                                <tbody>
                                    {rides.map((ride) => (
                                        <tr
                                            key={ride._id}
                                            className="border-t border-slate-100"
                                        >
                                            <td className="px-5 py-4">
                                                <p className="font-mono text-xs font-bold">
                                                    {String(ride._id).slice(-10)}
                                                </p>
                                                <p className="mt-1 text-xs text-slate-400">
                                                    {ride.distance != null
                                                        ? `${ride.distance} km`
                                                        : "Distance unavailable"}
                                                </p>
                                            </td>

                                            <td className="px-5 py-4">
                                                {ride.passenger?.name ? (
                                                    <>
                                                        <p className="font-bold">
                                                            {ride.passenger.name}
                                                        </p>
                                                        {ride.passenger.phone ? (
                                                            <a
                                                                href={`tel:${ride.passenger.phone}`}
                                                                className="mt-1 block text-xs text-[#087F5B]"
                                                            >
                                                                {ride.passenger.phone}
                                                            </a>
                                                        ) : null}
                                                    </>
                                                ) : (
                                                    "—"
                                                )}
                                            </td>

                                            <td className="px-5 py-4">
                                                {ride.vehicleType?.replaceAll("_", " ") || "—"}
                                            </td>

                                            <td className="px-5 py-4">
                                                <StatusBadge status={ride.status} />
                                            </td>

                                            <td className="px-5 py-4">
                                                {money(ride.requestedPrice)}
                                            </td>

                                            <td className="px-5 py-4 font-semibold">
                                                {money(ride.finalPrice)}
                                            </td>

                                            <td className="px-5 py-4">
                                                <span className="flex items-center gap-1 text-xs font-semibold text-slate-600">
                                                    <Wallet size={14} />
                                                    {ride.settlementStatus || "Not Recorded"}
                                                </span>
                                            </td>

                                            <td className="px-5 py-4 text-xs text-slate-500">
                                                {formatDate(ride.createdAt)}
                                            </td>

                                            <td className="px-5 py-4">
                                                {pointOf(ride.pickup) &&
                                                pointOf(ride.destination) ? (
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            setRouteInfo(null);
                                                            setMapRide(ride);
                                                        }}
                                                        className="flex items-center gap-1 rounded-xl border px-3 py-2 text-xs font-bold"
                                                    >
                                                        <MapIcon size={15} />
                                                        Map
                                                    </button>
                                                ) : (
                                                    "—"
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}

                    {pagination.pages > 1 && (
                        <div className="flex items-center justify-between gap-3 border-t p-5">
                            <button
                                type="button"
                                disabled={loading || page <= 1}
                                onClick={() => setPage((p) => p - 1)}
                                className="flex items-center gap-1 rounded-xl border px-4 py-2 text-sm disabled:opacity-40"
                            >
                                <ChevronLeft size={17} />
                                Previous
                            </button>

                            <span className="text-sm text-slate-500">
                                Page {page} / {pagination.pages}
                            </span>

                            <button
                                type="button"
                                disabled={loading || page >= pagination.pages}
                                onClick={() => setPage((p) => p + 1)}
                                className="flex items-center gap-1 rounded-xl border px-4 py-2 text-sm disabled:opacity-40"
                            >
                                Next
                                <ChevronRight size={17} />
                            </button>
                        </div>
                    )}
                </section>

                <p className="text-xs text-slate-500">
                    Ride statuses are loaded from the backend on refresh.
                    Automatic live updates and administrative interventions
                    will be added in a later phase.
                </p>
            </div>

            {mapRide && (
                <div className="fixed inset-0 z-[120] flex flex-col bg-[#0E241F]">
                    <div className="flex flex-wrap items-center justify-between gap-3 p-4">
                        <div>
                            <p className="font-bold text-white">
                                Ride {String(mapRide._id).slice(-10)}
                                {mapRide.passenger?.name
                                    ? ` · ${mapRide.passenger.name}`
                                    : ""}
                            </p>
                            <p className="text-sm text-white/70">
                                {statusNames[mapRide.status] || mapRide.status}
                                {routeInfo
                                    ? ` · ${routeInfo.distanceKm} km · ${routeInfo.durationMinutes} min`
                                    : ""}
                            </p>
                            <p className="mt-1 text-xs font-bold text-emerald-300">
                                Pickup to destination — press Esc to close
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={() => setMapRide(null)}
                            aria-label="Close fullscreen map"
                            className="flex items-center gap-2 rounded-xl border border-white/25 px-4 py-2.5 text-sm font-bold text-white"
                        >
                            <X size={16} />
                            Close
                        </button>
                    </div>
                    {pointOf(mapRide.pickup) &&
                    pointOf(mapRide.destination) ? (
                        <div ref={mapContainerRef} className="min-h-0 flex-1" />
                    ) : (
                        <p className="p-10 text-center text-sm text-white/70">
                            No location is saved for this ride.
                        </p>
                    )}
                </div>
            )}
        </AdminShell>
    );
}
