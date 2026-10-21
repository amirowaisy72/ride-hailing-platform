"use client";

import { useEffect } from "react";
import { AlertCircle, Check, Package, X } from "lucide-react";
import { TIMELINE_STEPS, PARCEL_FLOW, statusMeta, statusProgress } from "@/components/parcel/parcelUi";

const TONES = {
    warning: "bg-pd-warning-soft text-pd-warning",
    info: "bg-pd-info-soft text-pd-info",
    accent: "bg-pd-accent-soft text-pd-accent-text",
    success: "bg-pd-success-soft text-pd-success",
    danger: "bg-pd-danger-soft text-pd-danger",
    neutral: "bg-pd-surface-2 text-pd-muted",
};

export function ParcelStatusBadge({ status, short = true, className = "" }) {
    const meta = statusMeta(status);
    const live = !["DELIVERED", "CANCELLED", "FAILED"].includes(status);
    return (
        <span className={`inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[11px] font-bold capitalize ${TONES[meta.tone]} ${className}`}>
            <span className={`h-1.5 w-1.5 rounded-full bg-current ${live ? "opacity-90" : "opacity-60"}`} />
            {short ? meta.short : meta.label}
        </span>
    );
}

export function ParcelProgress({ status, className = "" }) {
    const failed = ["CANCELLED", "FAILED"].includes(status);
    const pct = failed ? 100 : Math.max(6, Math.round(statusProgress(status) * 100));
    return (
        <div className={`h-1.5 w-full overflow-hidden rounded-full bg-pd-surface-3 ${className}`} aria-hidden="true">
            <div
                className={`h-full rounded-full transition-[width] duration-700 ${failed ? "bg-pd-danger/60" : "bg-pd-accent"}`}
                style={{ width: `${pct}%` }}
            />
        </div>
    );
}

export function ParcelTimeline({ status }) {
    const current = PARCEL_FLOW.indexOf(status);
    return (
        <ol className="relative space-y-0">
            {TIMELINE_STEPS.map(([value, label], index) => {
                const done = current > index || status === "DELIVERED";
                const now = current === index && status !== "DELIVERED";
                const last = index === TIMELINE_STEPS.length - 1;
                return (
                    <li key={value} className="relative flex gap-3 pb-3 last:pb-0">
                        {!last && (
                            <span className={`absolute left-[11px] top-6 h-[calc(100%-16px)] w-0.5 rounded ${done ? "bg-pd-accent" : "bg-pd-line-strong"}`} />
                        )}
                        <span
                            className={`relative z-10 grid h-6 w-6 shrink-0 place-items-center rounded-full text-[10px] font-extrabold ${done
                                ? "bg-pd-accent text-pd-accent-ink"
                                : now
                                    ? "pd-live-dot border-2 border-pd-accent bg-pd-surface text-pd-text"
                                    : "border-2 border-pd-line-strong bg-pd-surface text-pd-faint"
                                }`}
                        >
                            {done ? <Check size={13} strokeWidth={3} /> : index + 1}
                        </span>
                        <span className={`pt-0.5 text-sm ${done || now ? "font-bold text-pd-text" : "text-pd-faint"}`}>
                            {label}
                            {now && <span className="ml-2 text-[11px] font-semibold text-pd-accent-text">Now</span>}
                        </span>
                    </li>
                );
            })}
        </ol>
    );
}

/** Pickup -> destination stacked addresses with a connector line. */
export function RouteSummary({ pickup, destination, pickupLabel = "Pickup", destinationLabel = "Drop-off", compact = false }) {
    return (
        <div className="relative grid gap-2.5">
            <span className="absolute left-[7px] top-[18px] bottom-[18px] w-px border-l-2 border-dotted border-pd-line-strong" aria-hidden="true" />
            {[
                [pickupLabel, pickup, "rounded-full bg-pd-ink"],
                [destinationLabel, destination, "rounded-[4px] bg-pd-danger"],
            ].map(([label, point, dot]) => (
                <div key={label} className="relative flex min-w-0 items-start gap-3">
                    <span className={`mt-1 grid h-4 w-4 shrink-0 place-items-center ${dot}`}>
                        <span className="h-1.5 w-1.5 rounded-full bg-pd-surface" />
                    </span>
                    <div className="min-w-0">
                        <p className="text-[10px] font-bold uppercase tracking-wide text-pd-muted">{label}</p>
                        <p className={`text-sm font-semibold text-pd-text ${compact ? "truncate" : "line-clamp-2"}`}>
                            {point?.address || (point ? "Pinned location" : "Not set")}
                        </p>
                    </div>
                </div>
            ))}
        </div>
    );
}

export function EmptyState({ icon: Icon = Package, title, body, action }) {
    return (
        <div className="pd-rise rounded-3xl border border-dashed border-pd-line-strong bg-pd-surface px-5 py-8 text-center">
            <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-pd-accent-soft text-pd-accent-text">
                <Icon size={22} />
            </span>
            <h3 className="mt-3 font-extrabold text-pd-text">{title}</h3>
            {body && <p className="mx-auto mt-1 max-w-xs text-sm text-pd-muted">{body}</p>}
            {action && <div className="mt-4">{action}</div>}
        </div>
    );
}

export function CardSkeleton({ count = 2 }) {
    return (
        <div className="space-y-3" aria-busy="true" aria-label="Loading">
            {Array.from({ length: count }).map((_, i) => (
                <div key={i} className="rounded-3xl bg-pd-surface p-4">
                    <div className="pd-skeleton h-4 w-1/3 rounded-full" />
                    <div className="pd-skeleton mt-3 h-3 w-2/3 rounded-full" />
                    <div className="pd-skeleton mt-2 h-3 w-1/2 rounded-full" />
                    <div className="pd-skeleton mt-4 h-10 w-full rounded-2xl" />
                </div>
            ))}
        </div>
    );
}

export function InlineError({ children, onDismiss }) {
    if (!children) return null;
    return (
        <div role="alert" className="pd-rise flex items-start gap-2 rounded-2xl bg-pd-danger-soft p-3 text-sm font-semibold text-pd-danger">
            <AlertCircle size={18} className="mt-0.5 shrink-0" />
            <span className="min-w-0 flex-1">{children}</span>
            {onDismiss && (
                <button type="button" onClick={onDismiss} aria-label="Dismiss" className="-m-1 grid h-8 w-8 shrink-0 place-items-center rounded-full">
                    <X size={16} />
                </button>
            )}
        </div>
    );
}

/** Top toast that auto-dismisses; never blocks the bottom actions. */
export function Toast({ message, onClose, action, timeout = 6000 }) {
    useEffect(() => {
        if (!message || !timeout) return;
        const timer = setTimeout(() => onClose?.(), timeout);
        return () => clearTimeout(timer);
    }, [message, timeout, onClose]);

    if (!message) return null;
    return (
        <div className="pointer-events-none fixed inset-x-3 top-[max(10px,env(safe-area-inset-top))] z-[300] mx-auto max-w-md">
            <div role="status" className="pd-drop pointer-events-auto flex items-center gap-3 rounded-2xl bg-pd-ink px-3.5 py-3 text-sm font-semibold text-pd-ink-text shadow-pd-lg">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-pd-accent text-pd-accent-ink">
                    <Package size={16} />
                </span>
                <span className="min-w-0 flex-1 leading-snug">{message}</span>
                {action}
                <button type="button" onClick={onClose} aria-label="Dismiss notification" className="grid h-8 w-8 shrink-0 place-items-center rounded-full opacity-70">
                    <X size={16} />
                </button>
            </div>
        </div>
    );
}

export function Button({ variant = "primary", className = "", children, ...props }) {
    const styles = {
        primary: "bg-pd-accent text-pd-accent-ink",
        ink: "bg-pd-ink text-pd-ink-text",
        soft: "bg-pd-surface-2 text-pd-text",
        outline: "border border-pd-line-strong bg-pd-surface text-pd-text",
        danger: "bg-pd-danger-soft text-pd-danger",
    };
    return (
        <button
            type="button"
            {...props}
            className={`inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl px-4 text-[15px] font-extrabold transition active:scale-[.98] disabled:pointer-events-none disabled:opacity-45 ${styles[variant]} ${className}`}
        >
            {children}
        </button>
    );
}
