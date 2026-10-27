"use client";

import { useEffect, useState } from "react";
import { Clock, LocateFixed, MapPin, Maximize2, Minimize2, Radio, Search, X } from "lucide-react";
import { searchLocations } from "@/lib/locationService";

export function PickupLocationSearch({
    token,
    currentLocation,
    pickupAddress,
    onSelect,
    onUseGPS,
    disabled = false,
}) {
    const [editing, setEditing] = useState(false);
    const [query, setQuery] = useState("");
    const [results, setResults] = useState([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!editing || query.trim().length < 3 || !token) {
            setResults([]);
            setLoading(false);
            return;
        }

        let cancelled = false;
        setLoading(true);

        const timer = setTimeout(async () => {
            try {
                const places = await searchLocations(query, token, currentLocation || undefined);
                if (!cancelled) setResults(places || []);
            } catch {
                if (!cancelled) setResults([]);
            } finally {
                if (!cancelled) setLoading(false);
            }
        }, 450);

        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [editing, query, token, currentLocation?.latitude, currentLocation?.longitude]);

    function choosePlace(place) {
        const latitude = Number(place.latitude);
        const longitude = Number(place.longitude);

        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;

        onSelect({
            latitude,
            longitude,
            name: place.display_name || place.name || "Selected pickup",
        });

        setEditing(false);
        setQuery("");
        setResults([]);
    }

    return (
        <div className="relative">
            <div className="flex items-center gap-3">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center" aria-hidden="true">
                    <span className="h-3.5 w-3.5 rounded-full border-[4px] border-[#111111]" />
                </span>

                <button
                    type="button"
                    disabled={disabled}
                    onClick={() => setEditing((value) => !value)}
                    aria-expanded={editing}
                    className="min-w-0 flex-1 text-left disabled:opacity-50"
                >
                    <span className="block text-[11px] font-semibold uppercase tracking-wide text-[#9CA3AF]">Pickup</span>
                    <span className="block truncate text-[15px] font-semibold text-[#111111]">
                        {pickupAddress || "Choose pickup location"}
                    </span>
                </button>

                <button
                    type="button"
                    disabled={disabled}
                    onClick={onUseGPS}
                    aria-label="Use current GPS location"
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#F4F5F7] text-[#111111] transition-colors hover:bg-[#E9EBEE] disabled:opacity-40"
                >
                    <LocateFixed size={17} />
                </button>
            </div>

            {editing && !disabled && (
                <div className="mt-3 rounded-2xl border border-[#EEF0F2] bg-white p-2 shadow-[0_8px_28px_rgba(17,17,17,0.10)]">
                    <label className="flex items-center gap-2 rounded-xl bg-[#F4F5F7] px-3 focus-within:ring-2 focus-within:ring-[#111111]">
                        <Search size={17} className="text-[#9CA3AF]" aria-hidden="true" />
                        <span className="sr-only">Search pickup address</span>
                        <input
                            autoFocus
                            value={query}
                            onChange={(event) => setQuery(event.target.value)}
                            placeholder="Search pickup address"
                            className="h-11 min-w-0 flex-1 bg-transparent text-sm font-medium outline-none placeholder:text-[#9CA3AF]"
                        />
                        <button
                            type="button"
                            onClick={() => setEditing(false)}
                            aria-label="Close pickup search"
                            className="flex h-7 w-7 items-center justify-center rounded-full text-[#6B7280] hover:bg-white"
                        >
                            <X size={16} />
                        </button>
                    </label>

                    {loading && (
                        <div className="mt-2 space-y-2 px-1" aria-label="Searching locations">
                            <div className="h-10 animate-pulse rounded-xl bg-[#F1F2F4]" />
                            <div className="h-10 animate-pulse rounded-xl bg-[#F1F2F4]" />
                        </div>
                    )}

                    {!loading && query.trim().length >= 3 && results.length === 0 && (
                        <p className="px-3 py-3 text-xs text-[#6B7280]">No matching places. Try a nearby landmark.</p>
                    )}

                    {results.length > 0 && (
                        <ul className="mt-1 max-h-52 overflow-y-auto">
                            {results.map((place, index) => (
                                <li key={place.place_id || index} className="border-b border-[#F1F2F4] last:border-b-0">
                                    <button
                                        type="button"
                                        onClick={() => choosePlace(place)}
                                        className="flex w-full items-center gap-3 rounded-xl p-2.5 text-left transition-colors hover:bg-[#F7F8F9]"
                                    >
                                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#F4F5F7]">
                                            <MapPin size={15} className="text-[#6B7280]" aria-hidden="true" />
                                        </span>
                                        <span className="min-w-0">
                                            <span className="block truncate text-sm font-semibold">{place.shortName || place.name}</span>
                                            {place.subtitle && <span className="block truncate text-xs text-[#6B7280]">{place.subtitle}</span>}
                                        </span>
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            )}
        </div>
    );
}

export function MapViewControl({ fullScreen, onToggle }) {
    return (
        <button
            type="button"
            onClick={onToggle}
            className="flex h-11 items-center gap-2 rounded-full bg-white px-4 text-xs font-bold text-[#111111] shadow-[0_6px_24px_rgba(17,17,17,0.12)] transition-transform active:scale-95"
        >
            {fullScreen ? <Minimize2 size={16} aria-hidden="true" /> : <Maximize2 size={16} aria-hidden="true" />}
            {fullScreen ? "Show booking" : "Full screen map"}
        </button>
    );
}

export function SearchingDrivers({ ride, offerCount = 0 }) {
    const [seconds, setSeconds] = useState(0);

    useEffect(() => {
        if (!ride?._id) return;
        setSeconds(0);
        const timer = setInterval(() => setSeconds((previous) => previous + 1), 1000);
        return () => clearInterval(timer);
    }, [ride?._id]);

    if (!ride || !["REQUESTED", "SEARCHING", "BIDDING"].includes(ride.status)) return null;

    return (
        <div className="rounded-3xl border border-[#EEF0F2] bg-white p-5 shadow-[0_8px_28px_rgba(17,17,17,0.08)]">
            <div className="flex items-center gap-4">
                <span className="relative flex h-14 w-14 shrink-0 items-center justify-center" aria-hidden="true">
                    <span className="absolute inset-0 animate-ping rounded-full bg-[#087F5B]/60" />
                    <span className="relative flex h-14 w-14 items-center justify-center rounded-full bg-[#111111]">
                        <Radio size={24} className="text-[#087F5B]" />
                    </span>
                </span>
                <div className="min-w-0 flex-1" aria-live="polite">
                    <h3 className="text-lg font-extrabold tracking-tight text-[#111111]">Finding your driver</h3>
                    <p className="mt-0.5 text-xs text-[#6B7280]">Nearby available drivers are being notified.</p>
                </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2">
                <div className="rounded-2xl bg-[#F4F5F7] p-3">
                    <p className="text-xl font-extrabold tabular-nums">{offerCount}</p>
                    <p className="text-[11px] font-medium text-[#6B7280]">Offers received</p>
                </div>
                <div className="rounded-2xl bg-[#F4F5F7] p-3">
                    <p className="flex items-center gap-1 text-xl font-extrabold tabular-nums">
                        <Clock size={16} aria-hidden="true" />
                        {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}
                    </p>
                    <p className="text-[11px] font-medium text-[#6B7280]">Waiting time</p>
                </div>
            </div>

            {seconds >= 45 && offerCount === 0 && (
                <p className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-900">
                    No offers yet. You can cancel this request and try again with a higher proposed fare.
                </p>
            )}
        </div>
    );
}
