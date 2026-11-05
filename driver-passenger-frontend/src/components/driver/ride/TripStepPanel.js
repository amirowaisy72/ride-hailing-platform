"use client";

import { useState } from "react";
import { ArrowRight, Car, Check, CheckCircle2, ChevronRight, Flag, Hourglass, MapPin, MessageCircle, Navigation, XCircle, ExternalLink } from "lucide-react";
import Link from "next/link";
import { money, placeText } from "@/components/driver/DriverRequestCard";

export const TOTAL_STEPS = 4;
export const TRIP_PANEL_HEIGHT = 372;

function pointCoords(point) {
    const coords = Array.isArray(point?.coordinates) ? point.coordinates : [point?.longitude, point?.latitude];
    const lng = Number(coords?.[0]);
    const lat = Number(coords?.[1]);
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

export function mapsUrl(point) {
    const c = pointCoords(point);
    return c ? `https://www.google.com/maps/dir/?api=1&destination=${c.lat},${c.lng}&travelmode=driving` : null;
}

/** Maps the unchanged backend ride status to one simple screen. */
export function describeStep({ status, passengerName, pendingStop, stopWaiting, tripType, stopsDone, stopsTotal }) {
    if (status === "DRIVER_SELECTED") {
        return {
            step: 1, Icon: Car, navigate: false,
            title: `Go to pick up ${passengerName}`,
            hint: "Press the button when you start driving to the pickup point.",
            action: "Start driving to pickup", ActionIcon: Navigation,
        };
    }
    if (status === "DRIVER_EN_ROUTE") {
        return {
            step: 2, Icon: Navigation, navigate: true,
            title: "Drive to the pickup point",
            hint: "Follow the map. Press the button when you reach the passenger.",
            action: "I have arrived", ActionIcon: MapPin,
        };
    }
    if (status === "DRIVER_ARRIVED") {
        return {
            step: 3, Icon: Hourglass, navigate: false,
            title: `Wait for ${passengerName}`,
            hint: "The passenger knows you are here. Press the button when they are in your vehicle.",
            action: "Start trip", ActionIcon: ArrowRight,
        };
    }
    if (pendingStop) {
        const label = tripType === "ROUND_TRIP" && stopsDone === stopsTotal - 1 ? "the far destination" : `stop ${stopsDone + 1} of ${stopsTotal}`;
        return {
            step: 4, Icon: Navigation, navigate: true, stopAction: "ARRIVE",
            title: `Drive to ${label}`,
            hint: "Press the button when you reach this place.",
            action: "I reached this stop", ActionIcon: MapPin,
        };
    }
    if (stopWaiting) {
        return {
            step: 4, Icon: Hourglass, navigate: false, stopAction: "CONTINUE",
            title: "Waiting at the stop",
            hint: "When the passenger is ready, continue the trip.",
            action: "Continue trip", ActionIcon: ArrowRight,
        };
    }
    return {
        step: 4, Icon: Flag, navigate: true, confirm: true,
        title: tripType === "ROUND_TRIP" ? "Drive back to the pickup" : "Drive to the destination",
        hint: "Follow the map. Press the button only when the passenger has reached the end.",
        action: "Complete trip", ActionIcon: Check,
    };
}

/**
 * One screen per trip step: what to do, where to go, and one big button.
 * Remount with a new `key` per step so the confirm state always resets.
 */
export default function TripStepPanel({
    status, passengerName, tripType, stopsDone, stopsTotal, pendingStop, stopWaiting,
    targetPoint, targetPlace, navigationInfo, waitingTime, completeBlocked,
    busy, unread = 0, onAdvance, onStopAction, onChat,
}) {
    const [confirming, setConfirming] = useState(false);
    const info = describeStep({ status, passengerName, pendingStop, stopWaiting, tripType, stopsDone, stopsTotal });
    // Open in Maps is a directions link to the current target, so it
    // shows at every step that has one — previously it was hidden on
    // non-driving steps (Step 1 before starting, arrival, waiting),
    // leaving the driver with no way to open Maps for the pickup.
    const url = mapsUrl(targetPoint);
    const waiting = status === "DRIVER_ARRIVED" || stopWaiting;
    const blocked = busy || (info.confirm && completeBlocked);

    function press() {
        if (info.stopAction) onStopAction(info.stopAction);
        else if (info.confirm) setConfirming(true);
        else onAdvance();
    }

    return (
        <section
            aria-label={`Trip step ${info.step} of ${TOTAL_STEPS}`}
            className="fixed inset-x-0 bottom-0 z-40 mx-auto flex w-full max-w-xl flex-col gap-4 rounded-t-[28px] bg-pd-surface px-4 pt-4 pb-[max(16px,env(safe-area-inset-bottom))] text-pd-text shadow-pd-lg"
        >
            <div className="flex items-center gap-3">
                <div className="flex flex-1 gap-1.5" aria-hidden>
                    {Array.from({ length: TOTAL_STEPS }, (_, i) => (
                        <span key={i} className="h-2 flex-1 rounded-full"
                            style={{ background: i < info.step ? "var(--pd-accent)" : "var(--pd-surface-3)" }} />
                    ))}
                </div>
                <p className="shrink-0 text-sm font-extrabold text-pd-text-2">Step {info.step} of {TOTAL_STEPS}</p>
            </div>

            <div className="flex items-start gap-3">
                <span className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-pd-accent-soft text-pd-accent-text" aria-hidden>
                    <info.Icon size={28} />
                </span>
                <div className="min-w-0">
                    <h2 className="text-2xl font-black leading-tight text-balance">{info.title}</h2>
                    <p className="mt-1 text-base leading-snug text-pd-text-2">{info.hint}</p>
                </div>
            </div>

            <div className="flex flex-col gap-1 rounded-2xl bg-pd-surface-2 p-3">
                <p className="flex items-start gap-2 text-lg font-extrabold leading-snug">
                    <MapPin size={20} className="mt-0.5 shrink-0 text-pd-accent-text" aria-hidden />
                    <span className="min-w-0">{targetPlace}</span>
                </p>
                {info.navigate && navigationInfo && (
                    <p className="pl-7 text-base font-bold text-pd-text-2">
                        {navigationInfo.distanceKm} km · about {navigationInfo.durationMinutes} min
                    </p>
                )}
                {waiting && waitingTime && (
                    <p className="flex items-center gap-1.5 pl-7 text-base font-bold text-pd-warning">
                        <Hourglass size={16} aria-hidden /> Waiting time {waitingTime}
                    </p>
                )}
            </div>

            {confirming ? (
                <div className="flex flex-col gap-3">
                    <p className="text-center text-lg font-extrabold">Has the passenger reached the end of the trip?</p>
                    <button type="button" onClick={() => { setConfirming(false); onAdvance(); }} disabled={blocked}
                        className="flex h-16 w-full items-center justify-center gap-2 rounded-2xl bg-pd-accent text-lg font-extrabold text-pd-accent-ink disabled:opacity-60">
                        <Check size={22} aria-hidden /> Yes, complete trip
                    </button>
                    <button type="button" onClick={() => setConfirming(false)}
                        className="flex h-12 w-full items-center justify-center rounded-2xl bg-pd-surface-2 text-base font-bold text-pd-text ring-1 ring-pd-line-strong">
                        Not yet
                    </button>
                </div>
            ) : (
                <>
                    <button type="button" onClick={press} disabled={blocked}
                        className="flex h-16 w-full items-center justify-center gap-2 rounded-2xl bg-pd-accent text-xl font-extrabold text-pd-accent-ink disabled:opacity-60">
                        <info.ActionIcon size={24} aria-hidden /> {busy ? "Please wait…" : info.action}
                    </button>
                    {info.confirm && completeBlocked && (
                        <p className="text-center text-sm font-semibold text-pd-warning">Finish the stop first, then you can complete the trip.</p>
                    )}
                    <div className="grid grid-cols-2 gap-3">
                        {url ? (
                            <a href={url} target="_blank" rel="noopener noreferrer"
                                className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-pd-surface-2 text-base font-bold text-pd-text ring-1 ring-pd-line-strong">
                                <ExternalLink size={18} aria-hidden /> Open in Maps
                            </a>
                        ) : <span aria-hidden />}
                        <button type="button" onClick={onChat}
                            className="relative flex h-12 items-center justify-center gap-2 rounded-2xl bg-pd-surface-2 text-base font-bold text-pd-text ring-1 ring-pd-line-strong">
                            <MessageCircle size={18} aria-hidden /> Message
                            {unread > 0 && (
                                <span className="absolute -right-1 -top-2 flex h-6 min-w-6 items-center justify-center rounded-full bg-pd-accent px-1.5 text-xs font-extrabold text-pd-accent-ink">
                                    {unread === 99 ? "99+" : unread}
                                </span>
                            )}
                        </button>
                    </div>
                </>
            )}
        </section>
    );
}

/** Trip finished (or ended by the passenger): one message, one button. */
export function RideEndedPanel({ status, firstName, finalPrice, onDone }) {
    const completed = status === "TRIP_COMPLETED";
    const title = completed ? "Trip complete" : status === "EXPIRED" ? "Ride expired" : "Ride cancelled";
    return (
        <section aria-label={title}
            // The bottom tab bar returns after a trip ends, so this panel
            // sits above it (same 68px + safe-area offset the idle sheet
            // uses). At bottom-0 the tab bar covered the Back button.
            style={{ bottom: "calc(68px + env(safe-area-inset-bottom))" }}
            className="fixed inset-x-0 z-40 mx-auto flex w-full max-w-xl flex-col items-center gap-4 rounded-t-[28px] bg-pd-surface px-4 pt-6 pb-[max(16px,env(safe-area-inset-bottom))] text-center text-pd-text shadow-pd-lg">
            <span className="flex size-20 items-center justify-center rounded-full"
                style={{
                    background: completed ? "var(--pd-accent-soft)" : "var(--pd-danger-soft)",
                    color: completed ? "var(--pd-accent-text)" : "var(--pd-danger)",
                }}>
                {completed ? <CheckCircle2 size={44} aria-hidden /> : <XCircle size={44} aria-hidden />}
            </span>
            <h2 className="text-3xl font-black">{title}</h2>
            {completed ? (
                <>
                    <p className="text-base text-pd-text-2">Well done, {firstName}. You earned</p>
                    <p className="text-5xl font-black tabular-nums">{money(finalPrice)}</p>
                    <Link href="/driver/earnings" className="flex min-h-11 items-center gap-1 text-base font-bold text-pd-accent-text underline underline-offset-4">
                        See my earnings <ChevronRight size={16} aria-hidden />
                    </Link>
                </>
            ) : (
                <p className="text-base text-pd-text-2">This ride is no longer active. You do not need to do anything.</p>
            )}
            <button type="button" onClick={onDone}
                className="flex h-16 w-full items-center justify-center gap-2 rounded-2xl bg-pd-accent text-xl font-extrabold text-pd-accent-ink">
                Back to home <ArrowRight size={22} aria-hidden />
            </button>
        </section>
    );
}

export { placeText };
