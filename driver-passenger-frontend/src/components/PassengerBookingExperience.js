"use client";

import { useEffect, useState } from "react";
import {
    ArrowDown, ArrowUp, Check, ChevronDown,
    ChevronUp, LocateFixed, MapPin, Navigation,
    Search, X,
} from "lucide-react";
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
            return;
        }

        let cancelled = false;

        const timer = setTimeout(async () => {
            setLoading(true);

            try {
                const places = await searchLocations(
                    query,
                    token,
                    currentLocation || undefined
                );

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
    }, [
        editing,
        query,
        token,
        currentLocation?.latitude,
        currentLocation?.longitude,
    ]);

    function choosePlace(place) {
        const latitude = Number(place.latitude);
        const longitude = Number(place.longitude);

        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
            return;
        }

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
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-[#087F5B]">
                    <Navigation size={19} />
                </div>

                <button
                    type="button"
                    disabled={disabled}
                    onClick={() => setEditing(!editing)}
                    className="min-w-0 flex-1 text-left disabled:opacity-50"
                >
                    <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
                        Pickup Location
                    </p>
                    <p className="truncate text-sm font-semibold text-slate-900">
                        {pickupAddress || "Choose pickup location"}
                    </p>
                </button>

                <button
                    type="button"
                    disabled={disabled}
                    onClick={onUseGPS}
                    aria-label="Use current GPS location"
                    className="rounded-xl bg-white p-2 text-[#087F5B] shadow-sm disabled:opacity-40"
                >
                    <LocateFixed size={19} />
                </button>
            </div>

            {editing && !disabled && (
                <div className="mt-3 rounded-2xl border border-emerald-100 bg-white p-3 shadow-md">
                    <div className="flex items-center gap-2 rounded-xl bg-slate-50 px-3">
                        <Search size={17} className="text-slate-400" />

                        <input
                            autoFocus
                            value={query}
                            onChange={(event) => setQuery(event.target.value)}
                            placeholder="Search another pickup address"
                            className="h-12 min-w-0 flex-1 bg-transparent text-sm outline-none"
                        />

                        <button
                            type="button"
                            onClick={() => setEditing(false)}
                            aria-label="Close pickup search"
                        >
                            <X size={18} />
                        </button>
                    </div>

                    {loading && (
                        <p className="p-3 text-xs text-slate-500">
                            Searching locations...
                        </p>
                    )}

                    <div className="max-h-48 overflow-y-auto">
                        {results.map((place, index) => (
                            <button
                                key={place.place_id || index}
                                type="button"
                                onClick={() => choosePlace(place)}
                                className="flex w-full items-start gap-3 border-b border-slate-100 p-3 text-left text-sm hover:bg-emerald-50"
                            >
                                <MapPin
                                    size={17}
                                    className="mt-0.5 shrink-0 text-[#087F5B]"
                                />
                                <span>
                                    {place.display_name || place.name}
                                </span>
                            </button>
                        ))}
                    </div>
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
            className="flex items-center gap-2 rounded-full bg-white px-4 py-3 text-xs font-bold text-[#087F5B] shadow-lg"
        >
            {fullScreen ? <ArrowUp size={17} /> : <ArrowDown size={17} />}
            {fullScreen ? "Show Booking" : "Full Screen Map"}
        </button>
    );
}

export function SearchingDrivers({ ride, offerCount = 0 }) {
    const [seconds, setSeconds] = useState(0);

    useEffect(() => {
        if (!ride?._id) return;

        setSeconds(0);

        const timer = setInterval(() => {
            setSeconds((previous) => previous + 1);
        }, 1000);

        return () => clearInterval(timer);
    }, [ride?._id]);

    if (
        !ride ||
        !["REQUESTED", "SEARCHING", "BIDDING"].includes(ride.status)
    ) {
        return null;
    }

    return (
        <div className="relative overflow-hidden rounded-[24px] border border-emerald-100 bg-gradient-to-br from-emerald-50 to-white p-5">
            <div className="flex items-center gap-4">
                <div className="relative flex h-16 w-16 shrink-0 items-center justify-center">
                    <span className="absolute inset-0 animate-ping rounded-full bg-emerald-300/30" />
                    <span className="absolute inset-2 animate-pulse rounded-full bg-emerald-200/70" />

                    <div className="relative flex h-11 w-11 items-center justify-center rounded-full bg-[#087F5B] text-white shadow-lg">
                        <Search size={22} />
                    </div>
                </div>

                <div className="min-w-0 flex-1">
                    <h3 className="font-extrabold text-slate-900">
                        Finding your driver
                    </h3>
                    <p className="mt-1 text-xs leading-5 text-slate-500">
                        Nearby available drivers are being notified.
                    </p>
                </div>
            </div>

            <div className="mt-5 grid grid-cols-3 gap-2">
                <div className="rounded-xl bg-white p-3 text-center">
                    <p className="text-lg font-extrabold text-[#087F5B]">
                        {offerCount}
                    </p>
                    <p className="text-[11px] text-slate-500">
                        Offers received
                    </p>
                </div>

                <div className="rounded-xl bg-white p-3 text-center">
                    <p className="text-lg font-extrabold text-slate-900">
                        {Math.floor(seconds / 60)}:
                        {String(seconds % 60).padStart(2, "0")}
                    </p>
                    <p className="text-[11px] text-slate-500">
                        Waiting time
                    </p>
                </div>

                <div className="rounded-xl bg-white p-3 text-center">
                    <Check size={21} className="mx-auto text-[#087F5B]" />
                    <p className="mt-1 text-[11px] text-slate-500">
                        Request active
                    </p>
                </div>
            </div>

            {seconds >= 45 && offerCount === 0 && (
                <p className="mt-4 rounded-xl bg-amber-50 p-3 text-sm leading-5 text-amber-800">
                    No offers yet. You can cancel this request and try
                    again with a higher proposed fare.
                </p>
            )}

            <p className="mt-4 text-center text-xs text-slate-400">
                Driver availability depends on your location and vehicle type.
            </p>
        </div>
    );
}
