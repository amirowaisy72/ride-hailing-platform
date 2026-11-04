"use client";

import { useState } from "react";
import { BellRing, Check, ChevronDown, Clock3, Flag, Minus, Navigation, Plus, Route, X, MapPin, ChevronRight } from "lucide-react";
import { money, placeText, vehicleNames } from "@/components/driver/DriverRequestCard";

export function passengerNameOf(ride) {
    const person = ride?.passengerId;
    const full = person && typeof person === "object"
        ? [person.firstName, person.lastName].filter(Boolean).join(" ")
        : "";
    return full || ride?.passengerName || "Passenger";
}

function initialsOf(name) {
    return String(name || "P").split(" ").map((part) => part[0]).filter(Boolean).slice(0, 2).join("").toUpperCase() || "P";
}

/**
 * One big incoming-ride card. The only things competing for attention are
 * the two answer buttons. Accept sends the offer at the passenger's fare
 * (same offer API as before); Decline hides the card for this ride.
 * Fare changes live behind one quiet link so they never clutter the card.
 */
export default function RideRequestCard({
    ride, passengerName, pickupDistanceText, secondsLeft, totalSeconds,
    price, onPriceChange, onAccept, onDecline, onClose, busy, submitted, cooldownSeconds = 0,
}) {
    const [adjusting, setAdjusting] = useState(false);
    const base = Number(ride.requestedPrice) || 0;
    const current = Number(price ?? ride.requestedPrice) || 0;
    const step = base >= 1000 ? 50 : 10;
    const progress = totalSeconds > 0 ? Math.max(0, Math.min(100, (secondsLeft / totalSeconds) * 100)) : 0;
    const low = secondsLeft <= 10;
    const cooling = cooldownSeconds > 0;
    const stopCount = ride.stops?.length || 0;
    const acceptLabel = adjusting && current !== base ? `Offer ${money(current)}` : "Accept";

    return (
        <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="ride-request-title"
            className="fixed inset-0 z-[70] flex items-end justify-center bg-[var(--pd-scrim)] p-3 pb-[max(12px,env(safe-area-inset-bottom))] pt-[max(12px,env(safe-area-inset-top))] backdrop-blur-[2px] sm:items-center"
        >
            <div className="flex max-h-full w-full max-w-md flex-col gap-5 overflow-y-auto rounded-[28px] bg-pd-surface p-5 text-pd-text shadow-pd-lg">
                <header className="flex flex-col gap-3">
                    <div className="flex items-center justify-between gap-3">
                        <h2 id="ride-request-title" className="flex items-center gap-2 text-base font-extrabold text-pd-accent-text">
                            <BellRing size={20} aria-hidden /> New ride request
                        </h2>
                        {!submitted && (
                            <span
                                className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-extrabold tabular-nums"
                                style={{
                                    background: low ? "var(--pd-danger-soft)" : "var(--pd-accent-soft)",
                                    color: low ? "var(--pd-danger)" : "var(--pd-accent-text)",
                                }}
                            >
                                <Clock3 size={15} aria-hidden /> {secondsLeft}s
                            </span>
                        )}
                    </div>
                    {!submitted && (
                        <div className="h-1.5 overflow-hidden rounded-full bg-pd-surface-3" aria-hidden>
                            <span
                                className="block h-full rounded-full transition-[width] duration-1000 ease-linear"
                                style={{ width: `${progress}%`, background: low ? "var(--pd-danger)" : "var(--pd-accent)" }}
                            />
                        </div>
                    )}
                </header>

                <div className="flex items-center gap-3">
                    <span className="flex size-14 shrink-0 items-center justify-center rounded-full bg-pd-accent-soft text-xl font-black text-pd-accent-text" aria-hidden>
                        {initialsOf(passengerName)}
                    </span>
                    <div className="min-w-0">
                        <p className="truncate text-2xl font-black leading-tight">{passengerName}</p>
                        <p className="truncate text-base text-pd-text-2">
                            {vehicleNames[ride.vehicleType] || ride.vehicleType}
                            {ride.tripType === "ROUND_TRIP" ? " · Round trip" : " · One way"}
                        </p>
                    </div>
                </div>

                <div className="flex items-end justify-between gap-4 rounded-2xl bg-pd-surface-2 p-4">
                    <div>
                        <p className="text-sm font-bold text-pd-muted">Fare</p>
                        <p className="text-4xl font-black leading-none tabular-nums sm:text-5xl">{money(current || ride.requestedPrice)}</p>
                    </div>
                    <ul className="flex flex-col items-end gap-1.5 text-base font-bold text-pd-text-2">
                        {ride.distance != null && (
                            <li className="flex items-center gap-1.5"><Route size={17} aria-hidden /> {ride.distance} km trip</li>
                        )}
                        {pickupDistanceText && (
                            <li className="flex items-center gap-1.5"><MapPin size={17} aria-hidden /> {pickupDistanceText} to pickup</li>
                        )}
                    </ul>
                </div>

                <ol className="flex flex-col">
                    <li className="flex items-start gap-3">
                        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-pd-accent text-pd-accent-ink" aria-hidden><Navigation size={18} /></span>
                        <p className="min-w-0 pb-4 text-xl font-bold leading-snug">
                            <span className="block text-sm font-bold text-pd-muted">Pick up from</span>
                            {placeText(ride.pickup)}
                        </p>
                    </li>
                    <li className="flex items-start gap-3">
                        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-pd-ink text-pd-ink-text" aria-hidden><Flag size={18} /></span>
                        <p className="min-w-0 text-xl font-bold leading-snug">
                            <span className="block text-sm font-bold text-pd-muted">
                                {ride.tripType === "ROUND_TRIP" ? "Go to, then return" : "Drop off at"}
                            </span>
                            {placeText(ride.destination)}
                            {stopCount > 0 && (
                                <span className="mt-1 block text-sm font-semibold text-pd-muted">
                                    {stopCount === 1 ? "1 stop on the way" : `${stopCount} stops on the way`}
                                </span>
                            )}
                        </p>
                    </li>
                </ol>

                {submitted ? (
                    <div className="flex flex-col gap-3">
                        <p className="flex items-start gap-2 rounded-2xl bg-pd-accent-soft p-4 text-base font-bold text-pd-accent-text">
                            <Check size={20} className="mt-0.5 shrink-0" aria-hidden />
                            Offer sent. Waiting for the passenger to choose you.
                        </p>
                        <button type="button" onClick={onClose}
                            className="flex h-16 w-full items-center justify-center gap-2 rounded-2xl bg-pd-accent text-lg font-extrabold text-pd-accent-ink">
                            <Check size={22} aria-hidden /> OK, I will wait
                        </button>
                    </div>
                ) : (
                    <div className="grid grid-cols-2 gap-3">
                        <button type="button" onClick={onDecline} disabled={busy}
                            className="flex h-16 items-center justify-center gap-2 rounded-2xl border-2 border-pd-line-strong bg-pd-surface-2 text-lg font-extrabold text-pd-text disabled:opacity-50">
                            <X size={22} aria-hidden /> Decline
                        </button>
                        <button type="button" onClick={onAccept} disabled={busy}
                            className="flex h-16 items-center justify-center gap-2 rounded-2xl bg-pd-accent text-lg font-extrabold text-pd-accent-ink disabled:opacity-60">
                            <Check size={22} aria-hidden /> {busy ? "Sending…" : acceptLabel}
                        </button>
                    </div>
                )}

                <div className="flex flex-col gap-3">
                    <button type="button" onClick={() => setAdjusting((open) => !open)} aria-expanded={adjusting}
                        className="mx-auto flex min-h-11 items-center gap-1.5 px-3 text-base font-bold text-pd-text-2 underline underline-offset-4">
                        {submitted ? "Change my fare" : "Offer a different fare"}
                        <ChevronDown size={18} className={adjusting ? "rotate-180" : ""} aria-hidden />
                    </button>
                    {adjusting && (
                        <div className="flex flex-col gap-3 rounded-2xl bg-pd-surface-2 p-3">
                            <div className="flex items-center gap-2">
                                <button type="button" aria-label="Lower fare" disabled={current - step <= 0}
                                    onClick={() => onPriceChange(String(Math.max(1, current - step)))}
                                    className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-pd-surface text-pd-text ring-1 ring-pd-line-strong disabled:opacity-40">
                                    <Minus size={22} aria-hidden />
                                </button>
                                <label className="flex min-w-0 flex-1 flex-col items-center">
                                    <span className="text-xs font-bold text-pd-muted">Your fare (PKR)</span>
                                    <input type="text" inputMode="numeric"
                                        value={price ?? ride.requestedPrice ?? ""}
                                        onChange={(event) => onPriceChange(event.target.value)}
                                        className="w-full bg-transparent text-center text-3xl font-black tabular-nums outline-none" />
                                </label>
                                <button type="button" aria-label="Raise fare" onClick={() => onPriceChange(String(current + step))}
                                    className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-pd-surface text-pd-text ring-1 ring-pd-line-strong">
                                    <Plus size={22} aria-hidden />
                                </button>
                            </div>
                            {base > 0 && current !== base && (
                                <button type="button" onClick={() => onPriceChange(String(base))}
                                    className="min-h-11 text-sm font-bold text-pd-accent-text underline">
                                    Back to passenger&apos;s fare ({money(base)})
                                </button>
                            )}
                            {submitted && (
                                <button type="button" onClick={onAccept} disabled={busy || cooling}
                                    className="flex h-14 items-center justify-center gap-2 rounded-2xl bg-pd-ink text-base font-extrabold text-pd-ink-text disabled:opacity-50">
                                    {cooling ? `Wait ${cooldownSeconds}s to change` : `Send ${money(current)}`}
                                </button>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

/** Compact row for the home list: one tap reopens the big card. */
export function RideQueueRow({ ride, submitted, onOpen }) {
    return (
        <button type="button" onClick={onOpen}
            className="flex min-h-20 w-full items-center gap-3 rounded-2xl border border-pd-line bg-pd-surface p-3 text-left text-pd-text shadow-sm">
            <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-pd-accent-soft text-pd-accent-text" aria-hidden>
                <Navigation size={20} />
            </span>
            <span className="min-w-0 flex-1">
                <span className="block truncate text-base font-extrabold">{placeText(ride.pickup)}</span>
                <span className="block truncate text-sm font-semibold text-pd-text-2">to {placeText(ride.destination)}</span>
                {submitted && <span className="mt-0.5 block text-xs font-bold text-pd-accent-text">Offer sent, waiting</span>}
            </span>
            <span className="shrink-0 text-right">
                <span className="block text-lg font-black tabular-nums">{money(ride.requestedPrice)}</span>
                <span className="flex items-center justify-end text-xs font-bold text-pd-muted">Open <ChevronRight size={14} aria-hidden /></span>
            </span>
        </button>
    );
}
