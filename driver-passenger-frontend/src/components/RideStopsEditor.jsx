"use client";

import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, MapPin, Plus, Search, Trash2, X } from "lucide-react";
import { searchLocations } from "@/lib/locationService";

const MAX_STOPS = 5;

export default function RideStopsEditor({
    stops,
    onChange,
    token,
    pickup,
    disabled = false,
}) {
    const [adding, setAdding] = useState(false);
    const [query, setQuery] = useState("");
    const [results, setResults] = useState([]);
    const [searching, setSearching] = useState(false);

    useEffect(() => {
        if (!token || !pickup || query.trim().length < 3 || disabled) {
            setResults([]);
            setSearching(false);
            return;
        }

        let cancelled = false;
        setSearching(true);
        const timer = setTimeout(async () => {
            try {
                const places = await searchLocations(query, token, pickup);
                if (!cancelled) setResults(places || []);
            } catch {
                if (!cancelled) setResults([]);
            } finally {
                if (!cancelled) setSearching(false);
            }
        }, 450);

        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [query, token, pickup?.latitude, pickup?.longitude, disabled]);

    function move(index, direction) {
        const next = [...stops];
        const target = index + direction;
        if (target < 0 || target >= next.length) return;
        [next[index], next[target]] = [next[target], next[index]];
        onChange(next);
    }

    function closeSearch() {
        setAdding(false);
        setQuery("");
        setResults([]);
    }

    function addStop(place, index) {
        const latitude = Number(place.latitude);
        const longitude = Number(place.longitude);
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;

        onChange([
            ...stops,
            {
                id: `${Date.now()}-${index}`,
                name: String(place.display_name || place.name || `Stop ${stops.length + 1}`).slice(0, 200),
                latitude,
                longitude,
            },
        ]);
        closeSearch();
    }

    return (
        <div className="mt-3">
            {stops.length > 0 && (
                <ul className="mb-2 space-y-1.5" aria-label="Intermediate stops">
                    {stops.map((stop, index) => (
                        <li key={stop.id} className="flex items-center gap-2 rounded-xl border border-[#EEF0F2] bg-white py-2 pl-2.5 pr-1.5">
                            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 border-[#111111] text-[11px] font-extrabold" aria-hidden="true">
                                {index + 1}
                            </span>
                            <p className="min-w-0 flex-1 truncate text-sm font-medium" title={stop.name}>
                                <span className="sr-only">Stop {index + 1}: </span>
                                {stop.name}
                            </p>
                            <button
                                type="button"
                                disabled={disabled || index === 0}
                                onClick={() => move(index, -1)}
                                aria-label={`Move stop ${index + 1} up`}
                                className="flex h-8 w-8 items-center justify-center rounded-lg text-[#374151] hover:bg-[#F4F5F7] disabled:opacity-30"
                            >
                                <ArrowUp size={16} />
                            </button>
                            <button
                                type="button"
                                disabled={disabled || index === stops.length - 1}
                                onClick={() => move(index, 1)}
                                aria-label={`Move stop ${index + 1} down`}
                                className="flex h-8 w-8 items-center justify-center rounded-lg text-[#374151] hover:bg-[#F4F5F7] disabled:opacity-30"
                            >
                                <ArrowDown size={16} />
                            </button>
                            <button
                                type="button"
                                disabled={disabled}
                                onClick={() => onChange(stops.filter((item) => item.id !== stop.id))}
                                aria-label={`Remove stop ${index + 1}`}
                                className="flex h-8 w-8 items-center justify-center rounded-lg text-[#E5484D] hover:bg-[#FDECEC] disabled:opacity-30"
                            >
                                <Trash2 size={16} />
                            </button>
                        </li>
                    ))}
                </ul>
            )}

            {stops.length < MAX_STOPS && !disabled && !adding && (
                <button
                    type="button"
                    onClick={() => setAdding(true)}
                    className="flex h-10 items-center gap-2 rounded-full bg-[#F4F5F7] px-3.5 text-xs font-bold text-[#111111] transition-colors hover:bg-[#E9EBEE]"
                >
                    <Plus size={15} aria-hidden="true" />
                    {stops.length ? "Add another stop" : "Add a stop"}
                    <span className="font-semibold text-[#9CA3AF]">{stops.length}/{MAX_STOPS}</span>
                </button>
            )}

            {adding && !disabled && (
                <div className="rounded-2xl border border-[#EEF0F2] bg-white p-2 shadow-[0_8px_28px_rgba(17,17,17,0.08)]">
                    <label className="flex items-center gap-2 rounded-xl bg-[#F4F5F7] px-3 focus-within:ring-2 focus-within:ring-[#111111]">
                        <Search size={16} className="text-[#9CA3AF]" aria-hidden="true" />
                        <span className="sr-only">Search a stop</span>
                        <input
                            type="text"
                            autoFocus
                            value={query}
                            onChange={(event) => setQuery(event.target.value)}
                            placeholder="Search and add a stop"
                            className="h-11 min-w-0 flex-1 bg-transparent text-sm font-medium outline-none placeholder:text-[#9CA3AF]"
                        />
                        <button
                            type="button"
                            onClick={closeSearch}
                            aria-label="Close stop search"
                            className="flex h-7 w-7 items-center justify-center rounded-full text-[#6B7280] hover:bg-white"
                        >
                            <X size={15} />
                        </button>
                    </label>

                    {searching && (
                        <div className="mt-2 space-y-2 px-1" aria-label="Searching stops">
                            <div className="h-10 animate-pulse rounded-xl bg-[#F1F2F4]" />
                            <div className="h-10 animate-pulse rounded-xl bg-[#F1F2F4]" />
                        </div>
                    )}

                    {results.length > 0 && (
                        <ul className="mt-1 max-h-44 overflow-y-auto">
                            {results.map((place, index) => (
                                <li key={place.place_id || index} className="border-b border-[#F1F2F4] last:border-b-0">
                                    <button
                                        type="button"
                                        onClick={() => addStop(place, index)}
                                        className="flex w-full items-center gap-3 rounded-xl p-2.5 text-left transition-colors hover:bg-[#F7F8F9]"
                                    >
                                        <MapPin size={15} className="shrink-0 text-[#6B7280]" aria-hidden="true" />
                                        <span className="min-w-0">
                                            <span className="block truncate text-sm font-semibold">{place.shortName || place.display_name || place.name}</span>
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
