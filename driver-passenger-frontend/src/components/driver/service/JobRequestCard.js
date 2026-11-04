"use client";

import { useState } from "react";
import { Check, ChevronDown, Flag, Minus, Navigation, Plus, X } from "lucide-react";
import { JOURNEYS } from "@/components/driver/service/serviceJourneys";

/**
 * One big request card for Parcels, Buy & Deliver and Rentals.
 * Same shape as the ride card: who/what, the money, from -> to, then two
 * answer buttons. Changing the fare hides behind one quiet link.
 *
 * `onAccept` / `onDecline` are supplied by the screen and call the existing
 * offer / accept APIs unchanged.
 */
export default function JobRequestCard({
    service, heading, subject, subjectNote, amountLabel = "Fare", amountText, facts = [],
    fromLabel = "Pick up from", fromText, toLabel = "Deliver to", toText,
    acceptLabel = "Accept", sentText, busy, fare, onFareChange, baseFare,
    onAccept, onDecline, className = "",
    requireFee = false, feeLabel = "Your delivery fee (PKR)", sentAction = null,
}) {
    const journey = JOURNEYS[service];
    const Icon = journey.Icon;
    const [adjusting, setAdjusting] = useState(false);
    const canAdjust = typeof onFareChange === "function";
    const current = Number(fare ?? baseFare) || 0;
    const step = baseFare >= 1000 ? 50 : 10;

    return (
        <article className={`flex flex-col gap-5 rounded-[28px] bg-pd-surface p-5 text-pd-text shadow-pd-lg ring-1 ring-pd-line ${className}`}>
            <header className="flex items-center gap-2 text-base font-extrabold text-pd-accent-text">
                <Icon size={20} aria-hidden /> {heading || `New ${journey.jobNoun} request`}
            </header>

            <div className="min-w-0">
                <p className="truncate text-2xl font-black leading-tight">{subject}</p>
                {subjectNote && <p className="truncate text-base text-pd-text-2">{subjectNote}</p>}
            </div>

            <div className="flex items-end justify-between gap-4 rounded-2xl bg-pd-surface-2 p-4">
                <div>
                    <p className="text-sm font-bold text-pd-muted">{amountLabel}</p>
                    <p className="text-4xl font-black leading-none tabular-nums">{amountText}</p>
                </div>
                {facts.length > 0 && (
                    <ul className="flex flex-col items-end gap-1 text-base font-bold text-pd-text-2">
                        {facts.map((fact) => <li key={fact}>{fact}</li>)}
                    </ul>
                )}
            </div>

            <ol className="flex flex-col">
                <li className="flex items-start gap-3">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-pd-accent text-pd-accent-ink" aria-hidden><Navigation size={18} /></span>
                    <p className="min-w-0 pb-4 text-xl font-bold leading-snug">
                        <span className="block text-sm font-bold text-pd-muted">{fromLabel}</span>
                        {fromText}
                    </p>
                </li>
                {toText && (
                    <li className="flex items-start gap-3">
                        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-pd-ink text-pd-ink-text" aria-hidden><Flag size={18} /></span>
                        <p className="min-w-0 text-xl font-bold leading-snug">
                            <span className="block text-sm font-bold text-pd-muted">{toLabel}</span>
                            {toText}
                        </p>
                    </li>
                )}
            </ol>

            {requireFee && !sentText && (
                <label className="flex flex-col gap-1 rounded-2xl bg-pd-surface-2 p-4">
                    <span className="text-sm font-bold text-pd-muted">{feeLabel}</span>
                    <input type="text" inputMode="numeric" placeholder="0" value={fare ?? ""}
                        onChange={(event) => onFareChange?.(event.target.value.replace(/[^\d]/g, ""))}
                        className="w-full bg-transparent text-4xl font-black tabular-nums outline-none placeholder:text-pd-faint" />
                </label>
            )}

            {sentText ? (
                <div className="flex flex-col gap-3">
                    <p role="status" className="flex items-start gap-2 rounded-2xl bg-pd-accent-soft p-4 text-base font-bold text-pd-accent-text">
                        <Check size={20} className="mt-0.5 shrink-0" aria-hidden /> {sentText}
                    </p>
                    {sentAction}
                </div>
            ) : (
                <div className="grid grid-cols-2 gap-3">
                    <button type="button" onClick={onDecline} disabled={busy}
                        className="flex h-16 items-center justify-center gap-2 whitespace-nowrap rounded-2xl border-2 border-pd-line-strong bg-pd-surface-2 text-base font-extrabold disabled:opacity-50">
                        <X size={22} aria-hidden /> Decline
                    </button>
                    <button type="button" onClick={onAccept} disabled={busy || (requireFee && !Number(fare))}
                        className="flex h-16 items-center justify-center gap-2 whitespace-nowrap rounded-2xl bg-pd-accent text-base font-extrabold text-pd-accent-ink disabled:opacity-60">
                        <Check size={22} aria-hidden /> {busy ? "Sending…" : adjusting && current !== baseFare ? `Offer ${current}` : acceptLabel}
                    </button>
                </div>
            )}

            {canAdjust && !sentText && (
                <div className="flex flex-col gap-3">
                    <button type="button" onClick={() => setAdjusting((open) => !open)} aria-expanded={adjusting}
                        className="mx-auto flex min-h-11 items-center gap-1.5 px-3 text-base font-bold text-pd-text-2 underline underline-offset-4">
                        Offer a different fare
                        <ChevronDown size={18} className={adjusting ? "rotate-180" : ""} aria-hidden />
                    </button>
                    {adjusting && (
                        <div className="flex items-center gap-2 rounded-2xl bg-pd-surface-2 p-3">
                            <button type="button" aria-label="Lower fare" disabled={current - step <= 0}
                                onClick={() => onFareChange(String(Math.max(1, current - step)))}
                                className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-pd-surface ring-1 ring-pd-line-strong disabled:opacity-40">
                                <Minus size={22} aria-hidden />
                            </button>
                            <label className="flex min-w-0 flex-1 flex-col items-center">
                                <span className="text-xs font-bold text-pd-muted">Your fare (PKR)</span>
                                <input type="text" inputMode="numeric" value={fare ?? baseFare ?? ""}
                                    onChange={(event) => onFareChange(event.target.value.replace(/[^\d]/g, ""))}
                                    className="w-full bg-transparent text-center text-3xl font-black tabular-nums outline-none" />
                            </label>
                            <button type="button" aria-label="Raise fare" onClick={() => onFareChange(String(current + step))}
                                className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-pd-surface ring-1 ring-pd-line-strong">
                                <Plus size={22} aria-hidden />
                            </button>
                        </div>
                    )}
                </div>
            )}
        </article>
    );
}
