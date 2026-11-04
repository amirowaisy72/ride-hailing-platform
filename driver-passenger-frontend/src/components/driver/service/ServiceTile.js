"use client";

import { ChevronRight } from "lucide-react";
import { JOURNEYS } from "@/components/driver/service/serviceJourneys";

/** Plain-words status for a service, plus whether the On/Off switch can be used. */
export function plainStatus(state) {
    const s = state?.status;
    if (s === "SUSPENDED") return { text: "Stopped by Safar. Tap to see why.", tone: "bad", canSwitch: false };
    if (s === "REJECTED") return { text: "Not approved. Tap to fix and try again.", tone: "bad", canSwitch: false };
    if (s === "PENDING" || s === "UNDER_REVIEW") return { text: "Safar is checking your papers. Please wait.", tone: "wait", canSwitch: false };
    if (s === "APPROVED") {
        if (!state.eligible) return { text: "Approved, but one thing is missing. Tap to fix.", tone: "wait", canSwitch: false };
        return state.enabled
            ? { text: "ON. You can get jobs now.", tone: "good", canSwitch: true }
            : { text: "OFF. Turn it on to get jobs.", tone: "off", canSwitch: true };
    }
    if (s === "INCOMPLETE") return { text: "Almost done. Tap to finish setup.", tone: "wait", canSwitch: false };
    return { text: "Not started. Tap to set up.", tone: "off", canSwitch: false };
}

const TONE = {
    good: "text-pd-accent-text",
    off: "text-pd-text-2",
    wait: "text-pd-warning",
    bad: "text-pd-danger",
};

function Switch({ on, disabled, busy, label, onChange }) {
    return (
        <button
            type="button" role="switch" aria-checked={on} aria-label={label}
            disabled={disabled || busy} onClick={() => onChange(!on)}
            className={`relative flex h-12 w-24 shrink-0 items-center rounded-full px-1.5 text-sm font-black transition-colors disabled:opacity-40 ${
                on ? "justify-start bg-pd-accent text-pd-accent-ink" : "justify-end bg-pd-surface-3 text-pd-text-2"
            }`}
        >
            <span className={`absolute top-1.5 size-9 rounded-full bg-pd-surface shadow transition-all ${on ? "left-[54px]" : "left-1.5"}`} aria-hidden />
            <span className="relative px-2" aria-hidden>{on ? "ON" : "OFF"}</span>
        </button>
    );
}

/**
 * One service as one big row: what it is, what state it is in (in words),
 * and a big switch only when the switch can actually be used.
 */
export default function ServiceTile({ service, state, onOpen, onToggle, busy, badge, statusOverride }) {
    const journey = JOURNEYS[service];
    const Icon = journey.Icon;
    const status = statusOverride || plainStatus(state);

    return (
        <div className="flex items-center gap-3 rounded-[24px] bg-pd-surface p-4 text-pd-text shadow-sm ring-1 ring-pd-line">
            <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                <span className="relative flex size-14 shrink-0 items-center justify-center rounded-2xl bg-pd-accent-soft text-pd-accent-text" aria-hidden>
                    <Icon size={28} />
                    {badge > 0 && (
                        <span className="absolute -right-1.5 -top-1.5 flex h-6 min-w-6 items-center justify-center rounded-full bg-pd-ink px-1.5 text-xs font-extrabold text-pd-ink-text">{badge}</span>
                    )}
                </span>
                <span className="min-w-0 flex-1">
                    <span className="block text-xl font-black leading-tight">{journey.label}</span>
                    <span className={`mt-0.5 block text-base font-bold leading-snug ${TONE[status.tone]}`}>{status.text}</span>
                </span>
                {!status.canSwitch && <ChevronRight size={22} className="shrink-0 text-pd-faint" aria-hidden />}
            </button>
            {status.canSwitch && (
                <Switch on={Boolean(state.enabled)} busy={busy} label={`${journey.label} on or off`} onChange={onToggle} />
            )}
        </div>
    );
}
