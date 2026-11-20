"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Car, Flag, MapPin, Navigation, ShieldAlert } from "lucide-react";
import { apiRequest } from "@/lib/api";

// ---------------------------------------------------------------------
// Safety (Safar To-Do #5, Phase 1, item c) — public live-trip page.
//
// Opened from a share link (WhatsApp etc.) as /share/ride?token=…
// (query param, NOT a [token] segment — this app is a static export,
// so dynamic segments cannot build). NO login required: the 24-hour
// token in the URL is the access control, and the endpoint returns
// live position + ride status only — no phone numbers, no full names,
// no fares. Polls every 10 seconds while the trip is live.
// ---------------------------------------------------------------------

const LIVE_STATUSES = ["DRIVER_SELECTED", "DRIVER_EN_ROUTE", "DRIVER_ARRIVED", "TRIP_STARTED"];

const STATUS_LABEL = {
    DRIVER_SELECTED: "Driver confirmed",
    DRIVER_EN_ROUTE: "Driver is on the way",
    DRIVER_ARRIVED: "Driver has arrived",
    TRIP_STARTED: "Trip in progress",
    TRIP_COMPLETED: "Trip completed",
    CANCELLED: "Trip cancelled",
    EXPIRED: "Trip expired",
};

function coords(point) {
    if (!Array.isArray(point?.coordinates) || point.coordinates.length !== 2) return null;
    return { lng: point.coordinates[0], lat: point.coordinates[1] };
}

function mapsLink(lat, lng, label) {
    return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}&query_place_id=${encodeURIComponent(label || "")}`;
}

export default function SharedRidePage() {
    return (
        <Suspense fallback={<main className="flex min-h-dvh items-center justify-center bg-pd-bg px-6"><p className="text-sm font-semibold text-pd-muted">Loading live trip…</p></main>}>
            <SharedRideContent />
        </Suspense>
    );
}

function SharedRideContent() {
    const params = useSearchParams();
    const token = params.get("token");
    const [data, setData] = useState(null);
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(true);

    const load = useCallback(async () => {
        if (!token) return;
        try {
            const result = await apiRequest(`/safety/shared/${token}`);
            setData(result);
            setError("");
        } catch (err) {
            setError(err.message || "Share link expired or not found");
        } finally {
            setLoading(false);
        }
    }, [token]);

    useEffect(() => {
        if (!token) {
            setLoading(false);
            setError("This share link is missing its token.");
            return;
        }
        load();
        const timer = setInterval(load, 10000);
        return () => clearInterval(timer);
    }, [load, token]);

    const ride = data?.ride;
    const loc = data?.driverLocation;
    const pickup = coords(ride?.pickup);
    const destination = coords(ride?.destination);
    const live = ride && LIVE_STATUSES.includes(ride.status);
    const mapSrc = loc
        ? `https://www.openstreetmap.org/export/embed.html?bbox=${loc.longitude - 0.03},${loc.latitude - 0.02},${loc.longitude + 0.03},${loc.latitude + 0.02}&layer=mapnik&marker=${loc.latitude},${loc.longitude}`
        : null;

    return (
        <main className="min-h-dvh bg-pd-bg px-4 py-6 text-pd-text">
            <div className="mx-auto max-w-lg">
                <header className="flex items-center gap-2">
                    <img src="/safar-icon.png" alt="Safar logo" className="h-10 w-10 rounded-xl object-cover" />
                    <span className="text-xl font-extrabold tracking-tight">Safar · Live trip</span>
                </header>

                {loading && (
                    <p className="mt-10 text-center text-sm font-semibold text-pd-muted">Loading live trip…</p>
                )}

                {!loading && error && (
                    <div role="alert" className="mt-10 rounded-3xl bg-pd-surface p-6 text-center shadow-sm">
                        <ShieldAlert size={28} className="mx-auto text-pd-muted" />
                        <h1 className="mt-3 text-lg font-extrabold">This link is no longer live</h1>
                        <p className="mt-1 text-sm text-pd-muted">{error}</p>
                        <p className="mt-2 text-xs text-pd-faint">Share links expire 24 hours after they are created.</p>
                    </div>
                )}

                {!loading && !error && ride && (
                    <div className="mt-6 space-y-3">
                        <section className="rounded-3xl bg-pd-surface p-5 shadow-sm">
                            <span className="inline-flex items-center gap-1.5 rounded-full bg-pd-surface-2 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-pd-text-2">
                                <span className={`h-2 w-2 rounded-full ${live ? "bg-emerald-500" : "bg-pd-faint"}`} />
                                {live ? "Live" : "Ended"}
                            </span>
                            <h1 className="mt-2 text-[22px] font-extrabold leading-tight">
                                {STATUS_LABEL[ride.status] || ride.status}
                            </h1>
                            <p className="mt-0.5 text-sm text-pd-muted">
                                {ride.driverName ? `Driver: ${ride.driverName}` : "Safar ride"}
                                {ride.vehicleType ? ` · ${String(ride.vehicleType).replaceAll("_", " ")}` : ""}
                            </p>
                            {loc && (
                                <p className="mt-2 text-xs font-semibold text-pd-text-2">
                                    Last update: {new Date(loc.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                                </p>
                            )}
                        </section>

                        {mapSrc ? (
                            <section aria-label="Live position map" className="overflow-hidden rounded-3xl border border-pd-line shadow-sm">
                                <iframe
                                    title="Live trip position"
                                    src={mapSrc}
                                    className="h-[380px] w-full"
                                    loading="lazy"
                                />
                            </section>
                        ) : (
                            <section className="rounded-3xl bg-pd-surface p-5 text-center shadow-sm">
                                <Navigation size={24} className="mx-auto text-pd-muted" />
                                <p className="mt-2 text-sm font-bold">Waiting for the driver&apos;s live location…</p>
                                <p className="mt-1 text-xs text-pd-muted">This page refreshes automatically every 10 seconds.</p>
                            </section>
                        )}

                        <section className="space-y-2 rounded-3xl bg-pd-surface p-5 shadow-sm">
                            {pickup && (
                                <a href={mapsLink(pickup.lat, pickup.lng, "Pickup")} target="_blank" rel="noreferrer" className="flex items-center gap-3 text-sm font-semibold">
                                    <MapPin size={17} className="shrink-0 text-[#087F5B]" />
                                    Pickup · {pickup.lat.toFixed(5)}, {pickup.lng.toFixed(5)}
                                </a>
                            )}
                            {destination && (
                                <a href={mapsLink(destination.lat, destination.lng, "Destination")} target="_blank" rel="noreferrer" className="flex items-center gap-3 text-sm font-semibold">
                                    <Flag size={16} className="shrink-0 text-pd-danger" />
                                    Drop-off · {destination.lat.toFixed(5)}, {destination.lng.toFixed(5)}
                                </a>
                            )}
                            {loc && (
                                <a href={mapsLink(loc.latitude, loc.longitude, "Driver")} target="_blank" rel="noreferrer" className="flex items-center gap-3 text-sm font-semibold">
                                    <Car size={17} className="shrink-0 text-pd-text-2" />
                                    Driver now · {loc.latitude.toFixed(5)}, {loc.longitude.toFixed(5)} (open in Google Maps)
                                </a>
                            )}
                        </section>

                        <p className="pb-4 text-center text-[11px] text-pd-faint">
                            Shared from Safar. If someone is in danger, call 15 (Police, Pakistan).
                        </p>
                    </div>
                )}
            </div>
        </main>
    );
}
