"use client";

import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, MapPin, Plus, Trash2 } from "lucide-react";
import { searchLocations } from "@/lib/locationService";

export default function RideStopsEditor({
    stops,
    onChange,
    token,
    pickup,
    disabled = false,
}) {
    const [query, setQuery] = useState("");
    const [results, setResults] = useState([]);
    const [searching, setSearching] = useState(false);

    useEffect(() => {
        if (!token || !pickup || query.trim().length < 3 || disabled) {
            setResults([]);
            return;
        }

        let cancelled = false;
        const timer = setTimeout(async () => {
            setSearching(true);
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

    return (
        <div className="mt-4 space-y-3">
            <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-slate-800">
                    Intermediate Stops
                </h3>
                <span className="text-xs text-slate-500">
                    {stops.length}/5
                </span>
            </div>

            {stops.map((stop, index) => (
                <div
                    key={stop.id}
                    className="flex items-center gap-2 rounded-xl border border-emerald-100 bg-white p-3"
                >
                    <MapPin size={17} className="shrink-0 text-[#087F5B]" />
                    <div className="min-w-0 flex-1">
                        <p className="text-xs font-bold text-[#087F5B]">
                            Stop {index + 1}
                        </p>
                        <p className="truncate text-sm text-slate-700">
                            {stop.name}
                        </p>
                    </div>

                    <button
                        type="button"
                        disabled={disabled || index === 0}
                        onClick={() => move(index, -1)}
                        aria-label="Move stop up"
                        className="p-1 disabled:opacity-30"
                    >
                        <ArrowUp size={17} />
                    </button>

                    <button
                        type="button"
                        disabled={disabled || index === stops.length - 1}
                        onClick={() => move(index, 1)}
                        aria-label="Move stop down"
                        className="p-1 disabled:opacity-30"
                    >
                        <ArrowDown size={17} />
                    </button>

                    <button
                        type="button"
                        disabled={disabled}
                        onClick={() =>
                            onChange(stops.filter((item) => item.id !== stop.id))
                        }
                        aria-label="Remove stop"
                        className="p-1 text-red-500 disabled:opacity-30"
                    >
                        <Trash2 size={17} />
                    </button>
                </div>
            ))}

            {stops.length < 5 && !disabled && (
                <div className="relative">
                    <div className="flex items-center gap-2 rounded-xl border bg-white px-3">
                        <Plus size={18} className="text-[#087F5B]" />
                        <input
                            type="text"
                            value={query}
                            onChange={(event) => setQuery(event.target.value)}
                            placeholder="Search and add a stop"
                            className="h-12 min-w-0 flex-1 bg-transparent text-sm outline-none"
                        />
                    </div>

                    {searching && (
                        <p className="p-2 text-xs text-slate-500">
                            Searching...
                        </p>
                    )}

                    {results.length > 0 && (
                        <div className="mt-2 max-h-44 overflow-y-auto rounded-xl border bg-white shadow-md">
                            {results.map((place, index) => (
                                <button
                                    type="button"
                                    key={place.place_id || index}
                                    onClick={() => {
                                        const latitude = Number(place.latitude);
                                        const longitude = Number(place.longitude);

                                        if (!Number.isFinite(latitude) ||
                                            !Number.isFinite(longitude)) return;

                                        onChange([
                                            ...stops,
                                            {
                                                id: `${Date.now()}-${index}`,
                                                name: String(
                                                    place.display_name ||
                                                    place.name ||
                                                    `Stop ${stops.length + 1}`
                                                ).slice(0, 200),
                                                latitude,
                                                longitude,
                                            },
                                        ]);
                                        setQuery("");
                                        setResults([]);
                                    }}
                                    className="block w-full border-b p-3 text-left text-sm hover:bg-emerald-50"
                                >
                                    {place.display_name || place.name}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}