
"use client";

import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { X } from "lucide-react";

maplibregl.setWorkerUrl("/maplibre-worker.mjs");

import AdminShell from "@/components/AdminShell";
import { useAdminDialog } from "@/components/AdminDialog";
import { authenticatedAdminRequest } from "@/lib/adminSession";

const START_CENTER = [69.3451, 30.3753];

const emptyGeometry = {
    type: "FeatureCollection",
    features: [],
};

export default function CitiesPage() {
    const { confirmDialog } = useAdminDialog();
    const [mapContainer, setMapContainer] = useState(null);
    const containerRef = useRef(null);
    const mapRef = useRef(null);
    const pointsRef = useRef([]);

    const [areas, setAreas] = useState([]);
    const [fullscreenArea, setFullscreenArea] = useState(null);
    const fullscreenContainerRef = useRef(null);
    // Editing an existing area: the area being edited (null = creating
    // a new one). Its name/city/polygon are loaded into the same form
    // and drawing map used for creating areas.
    const [editingArea, setEditingArea] = useState(null);
    const [points, setPoints] = useState([]);
    const [name, setName] = useState("");
    const [city, setCity] = useState("");
    const [cityResults, setCityResults] = useState([]);
    const [citySearching, setCitySearching] = useState(false);
    const [drawing, setDrawing] = useState(false);
    const drawingRef = useRef(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [message, setMessage] = useState("");

    const [addressName, setAddressName] = useState("");
    const [addressStreet, setAddressStreet] = useState("");
    const [addressMohalla, setAddressMohalla] = useState("");
    const [addressLandmark, setAddressLandmark] = useState("");
    const [addressLat, setAddressLat] = useState("");
    const [addressLng, setAddressLng] = useState("");
    const [addressBusy, setAddressBusy] = useState(false);
    const [googleMapsLink, setGoogleMapsLink] = useState("");
    const [resolvingMapsLink, setResolvingMapsLink] = useState(false);
    const [localAddresses, setLocalAddresses] = useState([]);
    const [addressPage, setAddressPage] = useState(1);
    const addressesPerPage = 5;

    async function loadLocalAddresses() {
        try {
            const data = await authenticatedAdminRequest(
                "/admin/service-areas/local-addresses"
            );
            setLocalAddresses(data.addresses || []);
        } catch (err) {
            console.error("Unable to load addresses:", err);
        }
    }

    useEffect(() => {
        loadLocalAddresses();
    }, []);

    async function saveLocalAddress() {
        if (addressBusy) return;

        setAddressBusy(true);
        setError("");
        setMessage("");

        try {
            const data = await authenticatedAdminRequest(
                "/admin/service-areas/local-addresses",
                {
                    method: "POST",
                    body: JSON.stringify({
                        name: addressName.trim(),
                        city: city.trim() || "Khanpur",
                        street: addressStreet.trim(),
                        mohalla: addressMohalla.trim(),
                        landmark: addressLandmark.trim(),
                        latitude: addressLat.trim(),
                        longitude: addressLng.trim(),
                    }),
                }
            );

            if (!data.success) throw new Error("Address save failed");

            setMessage("Local address saved successfully");
            await loadLocalAddresses();
            setAddressName("");
            setAddressStreet("");
            setAddressMohalla("");
            setAddressLandmark("");
            setAddressLat("");
            setAddressLng("");
        } catch (err) {
            setError(err.message);
        } finally {
            setAddressBusy(false);
        }
    }

    useEffect(() => {
        if (city.trim().length < 3) {
            setCityResults([]);
            return;
        }

        let cancelled = false;

        const timer = setTimeout(async () => {
            setCitySearching(true);

            try {
                const params = new URLSearchParams({
                    q: city.trim(),
                    format: "json",
                    countrycodes: "pk",
                    limit: "6",
                    addressdetails: "1",
                });

                const response = await fetch(
                    `https://nominatim.openstreetmap.org/search?${params}`
                );

                if (!response.ok) throw new Error("Location search failed");

                const results = await response.json();

                if (!cancelled) setCityResults(results);
            } catch {
                if (!cancelled) setCityResults([]);
            } finally {
                if (!cancelled) setCitySearching(false);
            }
        }, 700);

        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [city]);

    function selectCity(place) {
        const longitude = Number(place.lon);
        const latitude = Number(place.lat);

        if (!Number.isFinite(longitude) ||
            !Number.isFinite(latitude)) return;

        setCity(place.address?.city ||
            place.address?.town ||
            place.address?.village ||
            place.name);

        setCityResults([]);

        mapRef.current?.flyTo({
            center: [longitude, latitude],
            zoom: 12,
        });
    }

    async function loadAreas() {
        try {
            const data = await authenticatedAdminRequest(
                "/admin/service-areas"
            );
            setAreas(data.areas || []);
        } catch (err) {
            setError(err.message);
        }
    }

    useEffect(() => {
        loadAreas();
    }, []);

    useEffect(() => {
        console.log("CITY MAP DEBUG:", {
            container: Boolean(containerRef.current),
            existingMap: Boolean(mapRef.current),
            width: containerRef.current?.clientWidth,
            height: containerRef.current?.clientHeight,
        });

        if (!mapContainer || mapRef.current) return;

        containerRef.current = mapContainer;

        maplibregl.setWorkerUrl("/maplibre-worker.mjs");

        const map = new maplibregl.Map({
            container: containerRef.current,
            style: "https://tiles.openfreemap.org/styles/liberty",
            center: START_CENTER,
            zoom: 5,
        });

        mapRef.current = map;

        map.on("load", () => {
            map.resize();
        });

        const observer = new ResizeObserver(() => {
            map.resize();
        });

        observer.observe(containerRef.current);

        map.addControl(
            new maplibregl.NavigationControl(),
            "top-right"
        );

        map.on("load", () => {
            map.addSource("new-boundary", {
                type: "geojson",
                data: emptyGeometry,
            });

            map.addLayer({
                id: "new-boundary-fill",
                type: "fill",
                source: "new-boundary",
                paint: {
                    "fill-color": "#087F5B",
                    "fill-opacity": 0.18,
                },
            });

            map.addLayer({
                id: "new-boundary-line",
                type: "line",
                source: "new-boundary",
                paint: {
                    "line-color": "#087F5B",
                    "line-width": 3,
                },
            });

            map.addSource("saved-areas", {
                type: "geojson",
                data: emptyGeometry,
            });

            map.addLayer({
                id: "saved-areas-fill",
                type: "fill",
                source: "saved-areas",
                paint: {
                    "fill-color": [
                        "case",
                        ["get", "active"],
                        "#087F5B",
                        "#dc2626",
                    ],
                    "fill-opacity": 0.12,
                },
            });

            map.addLayer({
                id: "saved-areas-line",
                type: "line",
                source: "saved-areas",
                paint: {
                    "line-color": [
                        "case",
                        ["get", "active"],
                        "#087F5B",
                        "#dc2626",
                    ],
                    "line-width": 2,
                },
            });

            updateMapPoints(map, pointsRef.current);
        });

        let addressMarker = null;

        map.on("click", (event) => {
            if (!drawingRef.current) {
                setAddressLat(event.lngLat.lat.toFixed(7));
                setAddressLng(event.lngLat.lng.toFixed(7));

                addressMarker?.remove();
                addressMarker = new maplibregl.Marker({
                    color: "#087F5B",
                })
                    .setLngLat(event.lngLat)
                    .addTo(map);

                return;
            }

            const coordinate = [
                event.lngLat.lng,
                event.lngLat.lat,
            ];

            pointsRef.current = [...pointsRef.current, coordinate];
            setPoints([...pointsRef.current]);
            updateMapPoints(map, pointsRef.current);
        });

        return () => {
            observer.disconnect();
            addressMarker?.remove();
            map.remove();
            mapRef.current = null;
        };
    }, [mapContainer]);

    useEffect(() => {
        const map = mapRef.current;
        if (!map?.getSource("saved-areas")) return;

        map.getSource("saved-areas").setData({
            type: "FeatureCollection",
            features: areas
                .filter((area) => area.polygon?.coordinates?.length)
                .map((area) => ({
                    type: "Feature",
                    geometry: area.polygon,
                    properties: {
                        name: area.name,
                        active: Boolean(area.active),
                    },
                })),
        });
    }, [areas]);

    function updateMapPoints(map, coordinates) {
        if (!map.getSource("new-boundary")) return;

        const closed =
            coordinates.length >= 3
                ? [...coordinates, coordinates[0]]
                : coordinates;

        map.getSource("new-boundary").setData({
            type: "FeatureCollection",
            features:
                coordinates.length >= 3
                    ? [{
                        type: "Feature",
                        properties: {},
                        geometry: {
                            type: "Polygon",
                            coordinates: [closed],
                        },
                    }]
                    : [],
        });
    }

    function resetDrawing() {
        pointsRef.current = [];
        setPoints([]);
        updateMapPoints(mapRef.current, []);
    }

    // Load an existing area into the editor: name/city into the form,
    // its polygon ring (without the closing repeat point) as the
    // editable points, drawing mode on, map fitted to the boundary.
    function startEdit(area) {
        const ring = area.polygon?.coordinates?.[0] || [];
        const openRing = ring.length > 1 ? ring.slice(0, -1) : ring;

        setEditingArea(area);
        setName(area.name || "");
        setCity(area.city || "");
        setError("");
        setMessage("");
        pointsRef.current = [...openRing];
        setPoints([...openRing]);
        drawingRef.current = true;
        setDrawing(true);
        updateMapPoints(mapRef.current, openRing);

        if (mapRef.current && openRing.length) {
            const bounds = openRing.reduce(
                (result, point) => result.extend(point),
                new maplibregl.LngLatBounds(openRing[0], openRing[0])
            );
            mapRef.current.fitBounds(bounds, { padding: 60, maxZoom: 13 });
        }

        window.scrollTo({ top: 0, behavior: "smooth" });
    }

    function cancelEdit() {
        setEditingArea(null);
        setName("");
        setCity("");
        setError("");
        setMessage("");
        setDrawing(false);
        drawingRef.current = false;
        resetDrawing();
    }

    function removeLastPoint() {
        const next = pointsRef.current.slice(0, -1);
        pointsRef.current = next;
        setPoints([...next]);
        updateMapPoints(mapRef.current, next);
    }

    async function saveArea() {
        if (busy) return;

        if (!city.trim() || !name.trim() || points.length < 3) {
            setError("Enter city/name and draw at least 3 boundary points.");
            return;
        }

        setBusy(true);
        setError("");
        setMessage("");

        try {
            const coordinates = [[...points, points[0]]];

            if (editingArea) {
                // Update the existing area (name, city and polygon).
                await authenticatedAdminRequest(
                    `/admin/service-areas/${editingArea._id}`,
                    {
                        method: "PATCH",
                        body: JSON.stringify({
                            name: name.trim(),
                            city: city.trim(),
                            coordinates,
                        }),
                    }
                );

                setMessage("Service area updated.");
            } else {
                await authenticatedAdminRequest("/admin/service-areas", {
                    method: "POST",
                    body: JSON.stringify({
                        name: name.trim(),
                        city: city.trim(),
                        coordinates,
                    }),
                });

                setMessage("City service area created. Activate it below.");
            }

            setEditingArea(null);
            setName("");
            setCity("");
            setDrawing(false);
            drawingRef.current = false;
            resetDrawing();
            await loadAreas();
        } catch (err) {
            setError(err.message);
        } finally {
            setBusy(false);
        }
    }

    async function toggleArea(area) {
        if (busy) return;

        setBusy(true);
        setError("");
        setMessage("");

        try {
            await authenticatedAdminRequest(
                `/admin/service-areas/${area._id}/status`,
                {
                    method: "PATCH",
                    body: JSON.stringify({
                        active: !area.active,
                    }),
                }
            );

            setMessage("Service area status updated.");
            await loadAreas();
        } catch (err) {
            setError(err.message);
        } finally {
            setBusy(false);
        }
    }

    // Fullscreen boundary view: View opens the chosen area on a
    // full-screen map with its boundary drawn bold — a white halo
    // under a thick coloured outline, plus a translucent fill — and
    // the map fitted to the boundary. The small editor map above is
    // untouched. Esc or Close exits; the map is destroyed on close.
    useEffect(() => {
        if (!fullscreenArea) return;

        const coords = fullscreenArea.polygon?.coordinates?.[0] || [];
        if (!coords.length || !fullscreenContainerRef.current) return;

        const onKey = (event) => {
            if (event.key === "Escape") setFullscreenArea(null);
        };
        window.addEventListener("keydown", onKey);

        const map = new maplibregl.Map({
            container: fullscreenContainerRef.current,
            style: "https://tiles.openfreemap.org/styles/liberty",
            center: START_CENTER,
            zoom: 5,
        });

        map.addControl(new maplibregl.NavigationControl(), "top-right");

        map.on("load", () => {
            map.addSource("area-boundary", {
                type: "geojson",
                data: {
                    type: "Feature",
                    geometry: fullscreenArea.polygon,
                    properties: {},
                },
            });

            map.addLayer({
                id: "area-boundary-fill",
                type: "fill",
                source: "area-boundary",
                paint: {
                    "fill-color": fullscreenArea.active
                        ? "#087F5B"
                        : "#dc2626",
                    "fill-opacity": 0.18,
                },
            });

            map.addLayer({
                id: "area-boundary-halo",
                type: "line",
                source: "area-boundary",
                paint: {
                    "line-color": "#ffffff",
                    "line-width": 8,
                    "line-opacity": 0.9,
                },
            });

            map.addLayer({
                id: "area-boundary-line",
                type: "line",
                source: "area-boundary",
                paint: {
                    "line-color": fullscreenArea.active
                        ? "#087F5B"
                        : "#dc2626",
                    "line-width": 3.5,
                },
            });

            const bounds = coords.reduce(
                (result, point) => result.extend(point),
                new maplibregl.LngLatBounds(coords[0], coords[0])
            );
            map.fitBounds(bounds, { padding: 60, maxZoom: 13 });
        });

        return () => {
            window.removeEventListener("keydown", onKey);
            map.remove();
        };
    }, [fullscreenArea]);

    return (
        <AdminShell title="Cities & Service Areas">
            <div className="space-y-5">
                <section className="rounded-2xl bg-white p-5 shadow-sm">
                    <h2 className="mb-2 text-lg font-bold">Add Local Address</h2>

                    <div className="mb-4">
                        <label className="mb-2 block text-sm font-semibold text-slate-700">
                            Google Maps Link
                        </label>
                        <input
                            type="url"
                            value={googleMapsLink}
                            onChange={(e) => setGoogleMapsLink(e.target.value)}
                            placeholder="Paste Google Maps location link"
                            className="w-full rounded-xl border border-slate-200 p-3 text-sm"
                        />
                        <button
                            type="button"
                            disabled={resolvingMapsLink || !googleMapsLink.trim()}
                            onClick={async () => {
                                setResolvingMapsLink(true);
                                setError("");
                                try {
                                    const data = await authenticatedAdminRequest(
                                        "/admin/service-areas/local-addresses/resolve-link",
                                        {
                                            method: "POST",
                                            body: JSON.stringify({ url: googleMapsLink.trim() }),
                                        }
                                    );
                                    setAddressLat(String(data.latitude));
                                    setAddressLng(String(data.longitude));

                                    if (data.name) {
                                        setAddressName(data.name);
                                    }
                                    mapRef.current?.flyTo({
                                        center: [data.longitude, data.latitude],
                                        zoom: 16,
                                    });
                                } catch (err) {
                                    setError(err.message);
                                } finally {
                                    setResolvingMapsLink(false);
                                }
                            }}
                            className="mt-2 rounded-xl bg-[#087F5B] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                        >
                            {resolvingMapsLink ? "Finding location..." : "Get Location from Link"}
                        </button>
                    </div>
                    <p className="mb-4 text-sm text-slate-500">
                        Click on the map to select a location. The latitude and longitude will be filled automatically. Make sure Boundary Drawing Mode is turned off.
                    </p>

                    <div className="grid gap-3 md:grid-cols-2">
                        {[
                            ["Location Name", addressName, setAddressName],
                            ["Street", addressStreet, setAddressStreet],
                            ["Mohalla", addressMohalla, setAddressMohalla],
                            ["Nearby Landmark", addressLandmark, setAddressLandmark],
                            ["Latitude", addressLat, setAddressLat],
                            ["Longitude", addressLng, setAddressLng],
                        ].map(([placeholder, value, setter]) => (
                            <input
                                key={placeholder}
                                value={value}
                                onChange={(e) => setter(e.target.value)}
                                placeholder={placeholder}
                                className="w-full rounded-xl border border-slate-200 p-3 text-sm"
                            />
                        ))}
                    </div>

                    <button
                        type="button"
                        onClick={saveLocalAddress}
                        disabled={addressBusy || !addressName.trim() || !addressLat.trim() || !addressLng.trim()}
                        className="mt-4 rounded-xl bg-[#087F5B] px-6 py-3 font-semibold text-white disabled:opacity-50"
                    >
                        {addressBusy ? "Saving..." : "Save Local Address"}
                    </button>

                    {error && (
                        <p role="alert" className="mt-3 rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-600">
                            {error}
                        </p>
                    )}

                    <div className="mt-6 space-y-2">
                        <h3 className="text-sm font-bold text-slate-700">
                            Saved Local Addresses ({localAddresses.length})
                        </h3>

                        <div className="flex items-center justify-between gap-3 py-3">
                            <button
                                type="button"
                                disabled={addressPage <= 1}
                                onClick={() => setAddressPage((p) => Math.max(1, p - 1))}
                                className="rounded-lg border px-4 py-2 text-sm font-semibold disabled:opacity-40"
                            >
                                Previous
                            </button>

                            <span className="text-sm text-slate-600">
                                Page {Math.min(addressPage, Math.max(1, Math.ceil(localAddresses.length / addressesPerPage)))}
                                {" / "}
                                {Math.max(1, Math.ceil(localAddresses.length / addressesPerPage))}
                            </span>

                            <button
                                type="button"
                                disabled={addressPage >= Math.ceil(localAddresses.length / addressesPerPage)}
                                onClick={() => setAddressPage((p) => p + 1)}
                                className="rounded-lg border px-4 py-2 text-sm font-semibold disabled:opacity-40"
                            >
                                Next
                            </button>
                        </div>

                        {localAddresses.slice(
                            (Math.min(addressPage, Math.max(1, Math.ceil(localAddresses.length / addressesPerPage))) - 1) * addressesPerPage,
                            Math.min(addressPage, Math.max(1, Math.ceil(localAddresses.length / addressesPerPage))) * addressesPerPage
                        ).map((address) => (
                            <div
                                key={address._id}
                                className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 p-3"
                            >
                                <div>
                                    <p className="text-sm font-semibold">
                                        {address.name}
                                    </p>
                                    <p className="text-xs text-slate-500">
                                        {[address.street, address.mohalla, address.city]
                                            .filter(Boolean).join(", ")}
                                        <span className="block text-[11px] text-slate-400">
                                            {Number(address.latitude).toFixed(6)},
                                            {" "}
                                            {Number(address.longitude).toFixed(6)}
                                        </span>
                                    </p>
                                </div>

                                <button
                                    type="button"
                                    onClick={() => mapRef.current?.flyTo({
                                        center: [address.longitude, address.latitude],
                                        zoom: 16,
                                    })}
                                    className="rounded-lg bg-emerald-50 px-3 py-2 text-xs font-semibold text-[#087F5B]"
                                >
                                    View
                                </button>

                                <button
                                    type="button"
                                    onClick={async () => {
                                        if (!(await confirmDialog(`Delete ${address.name}?`, { danger: true }))) return;
                                        try {
                                            await authenticatedAdminRequest(
                                                `/admin/service-areas/local-addresses/${address._id}`,
                                                { method: "DELETE" }
                                            );
                                            await loadLocalAddresses();
                                        } catch (err) {
                                            setError(err.message);
                                        }
                                    }}
                                    className="rounded-lg bg-red-50 px-3 py-2 text-xs font-semibold text-red-600"
                                >
                                    Delete
                                </button>
                            </div>
                        ))}
                    </div>
                </section>
                <section className="rounded-2xl bg-white p-5 shadow-sm">
                    <h2 className="text-xl font-extrabold">
                        City & Service Area Management
                    </h2>
                    <p className="mt-2 text-sm text-slate-500">
                        Draw actual geographic service boundaries on the map.
                        Only active areas accept ride requests.
                    </p>
                </section>

                {message && (
                    <p role="status" className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-700">
                        {message}
                    </p>
                )}

                <section className="rounded-2xl bg-white p-4 shadow-sm">
                    <div className="grid gap-3 sm:grid-cols-2">
                        <div className="relative">
                            <input
                                value={city}
                                onChange={(e) => setCity(e.target.value)}
                                placeholder="Search city e.g. Khanpur"
                                className="w-full rounded-xl border p-3"
                            />

                            {citySearching && (
                                <p className="mt-1 text-xs text-slate-500">
                                    Searching locations...
                                </p>
                            )}

                            {cityResults.length > 0 && (
                                <div className="absolute inset-x-0 top-full z-50 mt-1 max-h-60 overflow-y-auto rounded-xl border bg-white shadow-xl">
                                    {cityResults.map((place) => (
                                        <button
                                            type="button"
                                            key={place.place_id}
                                            onClick={() => selectCity(place)}
                                            className="block w-full border-b p-3 text-left text-sm hover:bg-emerald-50"
                                        >
                                            {place.display_name}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                        <input
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="Area name (e.g. Lahore Central)"
                            className="rounded-xl border p-3"
                        />
                    </div>

                    <div className="my-4 flex flex-wrap gap-2">
                        <button
                            type="button"
                            onClick={() => {
                                drawingRef.current = !drawingRef.current;
                                setDrawing(drawingRef.current);
                            }}
                            className="rounded-xl bg-[#087F5B] px-4 py-3 text-sm font-bold text-white"
                        >
                            {drawing ? "Finish Drawing" : "Start Drawing"}
                        </button>

                        <button
                            type="button"
                            onClick={removeLastPoint}
                            disabled={points.length === 0}
                            className="rounded-xl border px-4 py-3 text-sm font-bold disabled:opacity-40"
                        >
                            Remove Last Point
                        </button>

                        <button
                            type="button"
                            onClick={resetDrawing}
                            className="rounded-xl border px-4 py-3 text-sm font-bold"
                        >
                            Clear Points
                        </button>

                        <button
                            type="button"
                            disabled={busy || points.length < 3}
                            onClick={saveArea}
                            className="rounded-xl bg-slate-900 px-4 py-3 text-sm font-bold text-white disabled:opacity-50"
                        >
                            {editingArea ? "Save Changes" : "Save Service Area"}
                        </button>

                        {editingArea && (
                            <button
                                type="button"
                                onClick={cancelEdit}
                                className="rounded-xl border border-red-200 px-4 py-3 text-sm font-bold text-red-600"
                            >
                                Cancel Edit
                            </button>
                        )}
                    </div>

                    {editingArea && (
                        <p className="mb-3 rounded-xl bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
                            Editing: {editingArea.city} — {editingArea.name}.
                            Click the map to add boundary points and expand
                            the area, or Clear Points and redraw it. Save
                            Changes to update it.
                        </p>
                    )}

                    <p className="mb-3 text-xs text-slate-500">
                        {drawing
                            ? "Click the map to place boundary points in order."
                            : "Use zoom controls, then Start Drawing."}
                        {" "}Points: {points.length}
                    </p>

                    <div
                        ref={setMapContainer}
                        style={{
                            width: "100%",
                            height: "440px",
                            minHeight: "440px",
                            position: "relative",
                            overflow: "hidden",
                        }}
                        className="rounded-xl"
                    />
                </section>

                <section className="space-y-3">
                    <h3 className="text-lg font-extrabold">
                        Configured Service Areas
                    </h3>

                    {areas.length === 0 && (
                        <p className="rounded-xl bg-white p-5 text-sm text-slate-500">
                            No service areas configured.
                        </p>
                    )}

                    {areas.map((area) => (
                        <div
                            key={area._id}
                            className="flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-white p-5 shadow-sm"
                        >
                            <div>
                                <p className="font-bold">{area.city}</p>
                                <p className="text-sm text-slate-500">{area.name}</p>
                                <p className={`mt-1 text-xs font-bold ${area.active ? "text-emerald-700" : "text-red-600"
                                    }`}>
                                    {area.active ? "ACTIVE" : "INACTIVE"}
                                </p>
                            </div>

                            <div className="flex gap-2">
                                <button
                                    type="button"
                                    onClick={() => setFullscreenArea(area)}
                                    className="rounded-xl border px-4 py-2 text-sm font-semibold"
                                >
                                    View
                                </button>
                                <button
                                    type="button"
                                    disabled={busy}
                                    onClick={() => startEdit(area)}
                                    className="rounded-xl border border-emerald-600 px-4 py-2 text-sm font-semibold text-emerald-700 disabled:opacity-50"
                                >
                                    Edit
                                </button>
                                <button
                                    type="button"
                                    disabled={busy}
                                    onClick={() => toggleArea(area)}
                                    className="rounded-xl bg-[#087F5B] px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
                                >
                                    {area.active ? "Deactivate" : "Activate"}
                                </button>
                            </div>
                        </div>
                    ))}
                </section>
            </div>

            {fullscreenArea && (
                <div className="fixed inset-0 z-[120] flex flex-col bg-[#0E241F]">
                    <div className="flex flex-wrap items-center justify-between gap-3 p-4">
                        <div>
                            <p className="font-bold text-white">
                                {fullscreenArea.city}
                            </p>
                            <p className="text-sm text-white/70">
                                {fullscreenArea.name}
                            </p>
                            <p
                                className={`mt-1 text-xs font-bold ${fullscreenArea.active
                                    ? "text-emerald-300"
                                    : "text-red-300"
                                    }`}
                            >
                                {fullscreenArea.active
                                    ? "ACTIVE"
                                    : "INACTIVE"}
                                {" · "}Boundary view — press Esc to close
                            </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                            <button
                                type="button"
                                onClick={() => {
                                    const area = fullscreenArea;
                                    setFullscreenArea(null);
                                    startEdit(area);
                                }}
                                className="rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white"
                            >
                                Edit Area
                            </button>
                            <button
                                type="button"
                                onClick={() => setFullscreenArea(null)}
                                aria-label="Close fullscreen map"
                                className="flex items-center gap-2 rounded-xl border border-white/25 px-4 py-2.5 text-sm font-bold text-white"
                            >
                                <X size={16} />
                                Close
                            </button>
                        </div>
                    </div>
                    {fullscreenArea.polygon?.coordinates?.[0]?.length ? (
                        <div
                            ref={fullscreenContainerRef}
                            className="min-h-0 flex-1"
                        />
                    ) : (
                        <p className="p-10 text-center text-sm text-white/70">
                            No boundary is saved for this area.
                        </p>
                    )}
                </div>
            )}
        </AdminShell>
    );
}
