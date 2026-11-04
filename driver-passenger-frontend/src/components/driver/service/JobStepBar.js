"use client";

import { describeJobStep } from "@/components/driver/service/serviceJourneys";

/**
 * "Step 3 of 5 — what to do now" card shown on top of a job screen.
 * It only reads the existing order status, so it never changes the flow.
 */
export default function JobStepBar({ service, status, className = "" }) {
    const info = describeJobStep(service, status);
    if (!info) return null;
    const { Icon } = info;

    return (
        <section
            aria-label={`Step ${info.step} of ${info.total}`}
            className={`flex flex-col gap-3 rounded-[24px] bg-pd-surface p-4 text-pd-text shadow-sm ring-1 ring-pd-line ${className}`}
        >
            <div className="flex items-center gap-3">
                <div className="flex flex-1 gap-1.5" aria-hidden>
                    {Array.from({ length: info.total }, (_, i) => (
                        <span
                            key={i}
                            className="h-2 flex-1 rounded-full"
                            style={{ background: i < info.step ? "var(--pd-accent)" : "var(--pd-surface-3)" }}
                        />
                    ))}
                </div>
                <p className="shrink-0 text-sm font-extrabold text-pd-text-2">
                    Step {info.step} of {info.total}
                </p>
            </div>
            <div className="flex items-start gap-3">
                <span className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-pd-accent-soft text-pd-accent-text" aria-hidden>
                    <Icon size={28} />
                </span>
                <div className="min-w-0">
                    <h2 className="text-2xl font-black leading-tight text-balance">{info.title}</h2>
                    <p className="mt-1 text-base leading-snug text-pd-text-2">{info.hint}</p>
                </div>
            </div>
        </section>
    );
}
