"use client";

import { useLanguage, storedLanguage } from "@/components/i18n/LanguageProvider";

import { useEffect, useRef, useState } from "react";
import { Clock, LocateFixed, MapPin, Maximize2, Minimize2, Radio, Search, X } from "lucide-react";
import { searchLocations } from "@/lib/locationService";
import { useVisibleViewport } from "@/hooks/useVisibleViewport";

export function PickupLocationSearch({
    token,
    currentLocation,
    pickupAddress,
    onSelect,
    onUseGPS,
    disabled = false,
    // Optional: lets the parent booking sheet know a search is active
    // so it can pin itself above the keyboard (Round 5).
    onEditingChange,
}) {
    const { t } = useLanguage();
    const [editing, setEditing] = useState(false);
    const [query, setQuery] = useState("");
    const [results, setResults] = useState([]);
    const [loading, setLoading] = useState(false);
    const panelRef = useRef(null);
    const viewport = useVisibleViewport();

    useEffect(() => {
        onEditingChange?.(editing);
    }, [editing, onEditingChange]);

    // Keep the search panel on screen when it opens: with the keyboard
    // up, the panel can start below the visible strip of the sheet.
    useEffect(() => {
        if (editing) {
            panelRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
        }
    }, [editing]);

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
            name: place.display_name || place.name || (storedLanguage() === "ur" ? "منتخب اٹھانے کی جگہ" : "Selected pickup"),
        });

        setEditing(false);
        setQuery("");
        setResults([]);
    }

    return (
        <div className="relative">
            <div className="flex items-center gap-3">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center" aria-hidden="true">
                    <span className="h-3.5 w-3.5 rounded-full border-[4px] border-pd-ink" />
                </span>

                <button
                    type="button"
                    disabled={disabled}
                    onClick={() => setEditing((value) => !value)}
                    aria-expanded={editing}
                    className="min-w-0 flex-1 text-left disabled:opacity-50"
                >
                    <span className="block text-[11px] font-semibold uppercase tracking-wide text-pd-faint">{t("ride.pickup")}</span>
                    <span className="block truncate text-[15px] font-semibold text-pd-text">
                        {pickupAddress || t("ride.choosePickup")}
                    </span>
                </button>

                <button
                    type="button"
                    disabled={disabled}
                    onClick={onUseGPS}
                    aria-label={t("ride.useGps")}
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-pd-surface-2 text-pd-text transition-colors hover:bg-pd-surface-3 disabled:opacity-40"
                >
                    <LocateFixed size={17} />
                </button>
            </div>

            {editing && !disabled && (
                <div ref={panelRef} className="mt-3 rounded-2xl border border-pd-line bg-pd-surface p-2 shadow-[0_8px_28px_rgba(17,17,17,0.10)]">
                    <label className="flex items-center gap-2 rounded-xl bg-pd-surface-2 px-3 focus-within:ring-2 focus-within:ring-pd-text">
                        <Search size={17} className="text-pd-faint" aria-hidden="true" />
                        <span className="sr-only">{t("ride.searchPickup")}</span>
                        <input
                            autoFocus
                            value={query}
                            onChange={(event) => setQuery(event.target.value)}
                            placeholder={t("ride.searchPickup")}
                            className="h-11 min-w-0 flex-1 bg-transparent text-sm font-medium outline-none placeholder:text-pd-faint"
                        />
                        <button
                            type="button"
                            onClick={() => setEditing(false)}
                            aria-label={t("ride.closePickupSearch")}
                            className="flex h-9 w-9 items-center justify-center rounded-full text-pd-muted hover:bg-pd-surface"
                        >
                            <X size={16} />
                        </button>
                    </label>

                    {loading && (
                        <div className="mt-2 space-y-2 px-1" aria-label={t("ride.searchingLocations")}>
                            <div className="h-10 animate-pulse rounded-xl bg-pd-surface-2" />
                            <div className="h-10 animate-pulse rounded-xl bg-pd-surface-2" />
                        </div>
                    )}

                    {!loading && query.trim().length >= 3 && results.length === 0 && (
                        <p className="px-3 py-3 text-xs text-pd-muted">{t("ride.noMatchingPlaces")}</p>
                    )}

                    {results.length > 0 && (
                        <ul
                            className="mt-1 max-h-52 overflow-y-auto overscroll-contain"
                            // With the keyboard open, the fixed 13 rem cap
                            // left results in a one-row strip above the
                            // keys. Grow the list to the visible height
                            // instead (sheet header + this card + the
                            // search field occupy roughly 300 px of it);
                            // it returns to the compact cap when the
                            // keyboard closes.
                            style={viewport.keyboardOpen && viewport.height
                                ? { maxHeight: Math.max(200, viewport.height - 300) }
                                : undefined}
                        >
                            {results.map((place, index) => (
                                <li key={place.place_id || index} className="border-b border-pd-line last:border-b-0">
                                    <button
                                        type="button"
                                        onClick={() => choosePlace(place)}
                                        className="flex w-full items-center gap-3 rounded-xl p-2.5 text-left transition-colors hover:bg-pd-surface-2"
                                    >
                                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-pd-surface-2">
                                            <MapPin size={15} className="text-pd-muted" aria-hidden="true" />
                                        </span>
                                        <span className="min-w-0">
                                            <span className="block truncate text-sm font-semibold">{place.shortName || place.name}</span>
                                            {place.subtitle && <span className="block truncate text-xs text-pd-muted">{place.subtitle}</span>}
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
    const { t } = useLanguage();
    return (
        <button
            type="button"
            onClick={onToggle}
            className="flex h-11 items-center gap-2 rounded-full bg-pd-surface px-4 text-xs font-bold text-pd-text shadow-[0_6px_24px_rgba(17,17,17,0.12)] transition-transform active:scale-95"
        >
            {fullScreen ? <Minimize2 size={16} aria-hidden="true" /> : <Maximize2 size={16} aria-hidden="true" />}
            {fullScreen ? t("ride.showBooking") : t("ride.fullScreenMap")}
        </button>
    );
}

export function SearchingDrivers({ ride, offerCount = 0 }) {
    const { t } = useLanguage();
    const [seconds, setSeconds] = useState(0);

    useEffect(() => {
        if (!ride?._id) return;
        setSeconds(0);
        const timer = setInterval(() => setSeconds((previous) => previous + 1), 1000);
        return () => clearInterval(timer);
    }, [ride?._id]);

    if (!ride || !["REQUESTED", "SEARCHING", "BIDDING"].includes(ride.status)) return null;

    return (
        <div className="rounded-3xl border border-pd-line bg-pd-surface p-5 shadow-[0_8px_28px_rgba(17,17,17,0.08)]">
            <div className="flex items-center gap-4">
                <span className="relative flex h-14 w-14 shrink-0 items-center justify-center" aria-hidden="true">
                    <span className="absolute inset-0 animate-ping rounded-full bg-[#087F5B]/60" />
                    <span className="relative flex h-14 w-14 items-center justify-center rounded-full bg-pd-ink">
                        <Radio size={24} className="text-[#087F5B]" />
                    </span>
                </span>
                <div className="min-w-0 flex-1" aria-live="polite">
                    <h3 className="text-lg font-extrabold tracking-tight text-pd-text">{t("ride.findingDriver")}</h3>
                    <p className="mt-0.5 text-xs text-pd-muted">{t("ride.findingHint")}</p>
                </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2">
                <div className="rounded-2xl bg-pd-surface-2 p-3">
                    <p className="text-xl font-extrabold tabular-nums">{offerCount}</p>
                    <p className="text-[11px] font-medium text-pd-muted">{t("ride.offersReceived")}</p>
                </div>
                <div className="rounded-2xl bg-pd-surface-2 p-3">
                    <p className="flex items-center gap-1 text-xl font-extrabold tabular-nums">
                        <Clock size={16} aria-hidden="true" />
                        {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}
                    </p>
                    <p className="text-[11px] font-medium text-pd-muted">{t("ride.waitingTime")}</p>
                </div>
            </div>

            {seconds >= 45 && offerCount === 0 && (
                <p className="mt-3 rounded-2xl border border-amber-200 bg-pd-warning-soft p-3 text-xs leading-relaxed text-pd-warning">
                    No offers yet. You can cancel this request and try again with a higher proposed fare.
                </p>
            )}
        </div>
    );
}
