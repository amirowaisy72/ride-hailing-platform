"use client";

import {
    ArrowUp, ArrowUpLeft, ArrowUpRight, Clock3, CornerUpLeft, CornerUpRight,
    Flag, LoaderCircle, MapPin, Route, RotateCw, Undo2,
} from "lucide-react";
import { formatDistance } from "@/components/driver/map/navMath";

const ICONS = {
    left: CornerUpLeft,
    right: CornerUpRight,
    "sharp-left": CornerUpLeft,
    "sharp-right": CornerUpRight,
    "slight-left": ArrowUpLeft,
    "slight-right": ArrowUpRight,
    straight: ArrowUp,
    uturn: Undo2,
    roundabout: RotateCw,
    arrive: Flag,
};

function arrivalClock(minutes) {
    return new Date(Date.now() + minutes * 60000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/**
 * Turn-by-turn guidance card shown above the map while the driver is heading
 * to the pickup or the destination. One glance: what to do, how far, then the
 * time and distance left. `info` is the object the map reports through
 * `onRouteUpdate`.
 */
export default function NavigationBanner({ info, targetKind = "pickup", className = "" }) {
    const place = targetKind === "destination" ? "destination" : "pickup point";
    const waiting = !info || info.status === "loading" || info.status === "rerouting";
    const arrived = Boolean(info?.arrived);
    const Icon = arrived ? (targetKind === "destination" ? Flag : MapPin) : ICONS[info?.maneuver] || ArrowUp;

    let heading;
    let detail;
    if (waiting && !info?.nextStep) {
        heading = info?.status === "rerouting" ? "Finding a new way…" : "Getting directions…";
        detail = `To the ${place}`;
    } else if (arrived) {
        heading = `You are at the ${place}`;
        detail = targetKind === "destination" ? "Tap Complete trip below" : "Tap I have arrived below";
    } else {
        heading = formatDistance(info.stepDistanceMeters);
        detail = `${info.text}${info.road ? ` ${info.road}` : ""}`;
    }

    return (
        <section
            aria-label="Navigation"
            aria-live="polite"
            // In dark theme the inverted ink card would render white, so
            // it uses a normal surface card there instead. Light theme
            // keeps the exact inverted look it already had.
            className={`overflow-hidden rounded-2xl bg-pd-ink text-pd-ink-text shadow-[0_10px_30px_rgba(0,0,0,0.28)] dark:border dark:border-pd-line dark:bg-pd-surface dark:text-pd-text ${className}`}
        >
            <div className="flex items-center gap-3 p-3">
                <span className="flex size-16 shrink-0 items-center justify-center rounded-xl bg-pd-accent text-pd-accent-ink" aria-hidden>
                    {waiting && !info?.nextStep
                        ? <LoaderCircle size={32} className="animate-spin" />
                        : <Icon size={38} strokeWidth={2.6} />}
                </span>
                <div className="min-w-0 flex-1">
                    <p className="truncate text-3xl font-black leading-none tabular-nums">{heading}</p>
                    <p className="mt-1.5 line-clamp-2 text-lg font-bold leading-tight opacity-95">{detail}</p>
                </div>
            </div>
            {info?.durationMinutes != null && !arrived && (
                <div className="flex items-center gap-4 border-t border-white/15 px-4 py-2.5 text-base font-bold dark:border-pd-line">
                    <span className="flex items-center gap-1.5"><Clock3 size={18} aria-hidden />{info.durationMinutes} min</span>
                    <span className="flex items-center gap-1.5"><Route size={18} aria-hidden />{formatDistance(info.remainingMeters ?? info.distanceKm * 1000)}</span>
                    <span className="ml-auto opacity-85">Arrive {arrivalClock(info.durationMinutes)}</span>
                </div>
            )}
        </section>
    );
}
