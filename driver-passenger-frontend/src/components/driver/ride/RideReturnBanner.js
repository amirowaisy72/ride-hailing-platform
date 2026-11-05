"use client";

import Link from "next/link";
import { BellRing, CarFront, ChevronRight, Clock3 } from "lucide-react";

const KINDS = {
    active: { Icon: CarFront, tone: "bg-pd-accent text-pd-accent-ink", chip: "bg-white/20" },
    // Normal surface card in both themes: the old inverted-ink card
    // rendered black in light theme and white in dark theme.
    available: { Icon: BellRing, tone: "bg-pd-surface text-pd-text border border-pd-line", chip: "bg-pd-accent-soft text-pd-accent-text" },
    offer: { Icon: Clock3, tone: "bg-pd-surface text-pd-text border border-pd-line", chip: "bg-pd-accent-soft text-pd-accent-text" },
};

/**
 * Persistent, always-tappable way back to the driver's ride.
 * kind: "active" (your current ride) | "available" (rides waiting) | "offer" (offer sent).
 * Pass `href` to navigate from other screens, or `onClick` on the home screen.
 */
export default function RideReturnBanner({ kind, title, subtitle, href, onClick, className = "" }) {
    const { Icon, tone, chip } = KINDS[kind] || KINDS.available;
    const body = (
        <>
            <span className={`relative flex size-11 shrink-0 items-center justify-center rounded-full ${chip}`} aria-hidden>
                <Icon size={22} />
                {kind === "available" && <span className="absolute -right-0.5 -top-0.5 size-3 animate-pulse rounded-full bg-pd-accent ring-2 ring-pd-surface" />}
            </span>
            <span className="min-w-0 flex-1 text-left">
                <span className="block truncate text-lg font-extrabold leading-tight">{title}</span>
                {subtitle && <span className="block truncate text-sm font-semibold opacity-85">{subtitle}</span>}
            </span>
            <span className="flex shrink-0 items-center gap-0.5 text-sm font-extrabold">Open <ChevronRight size={18} aria-hidden /></span>
        </>
    );
    const classes = `pointer-events-auto flex min-h-16 w-full items-center gap-3 rounded-2xl px-3 py-2 shadow-pd-lg ${tone} ${className}`;
    return href ? (
        <Link href={href} className={classes}>{body}</Link>
    ) : (
        <button type="button" onClick={onClick} className={classes}>{body}</button>
    );
}
