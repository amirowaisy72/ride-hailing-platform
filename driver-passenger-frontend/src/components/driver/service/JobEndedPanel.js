"use client";

import Link from "next/link";
import { ArrowRight, CheckCircle2, ChevronRight, XCircle } from "lucide-react";

/**
 * How every job ends: one message, what you earned (if known), one button.
 */
export default function JobEndedPanel({ completed, title, message, amountLabel, amountText, backHref, backLabel, className = "" }) {
    return (
        <section
            aria-label={title}
            className={`flex flex-col items-center gap-4 rounded-[28px] bg-pd-surface p-6 text-center text-pd-text shadow-sm ring-1 ring-pd-line ${className}`}
        >
            <span
                className="flex size-20 items-center justify-center rounded-full"
                style={{
                    background: completed ? "var(--pd-accent-soft)" : "var(--pd-danger-soft)",
                    color: completed ? "var(--pd-accent-text)" : "var(--pd-danger)",
                }}
            >
                {completed ? <CheckCircle2 size={44} aria-hidden /> : <XCircle size={44} aria-hidden />}
            </span>
            <h2 className="text-3xl font-black text-balance">{title}</h2>
            {message && <p className="text-base text-pd-text-2">{message}</p>}
            {amountText && (
                <>
                    <p className="text-sm font-bold text-pd-muted">{amountLabel}</p>
                    <p className="-mt-3 text-5xl font-black tabular-nums">{amountText}</p>
                </>
            )}
            {completed && (
                <Link href="/driver/earnings" className="flex min-h-11 items-center gap-1 text-base font-bold text-pd-accent-text underline underline-offset-4">
                    See my earnings <ChevronRight size={16} aria-hidden />
                </Link>
            )}
            <Link
                href={backHref}
                className="flex h-16 w-full items-center justify-center gap-2 rounded-2xl bg-pd-accent text-xl font-extrabold text-pd-accent-ink"
            >
                {backLabel} <ArrowRight size={22} aria-hidden />
            </Link>
        </section>
    );
}
