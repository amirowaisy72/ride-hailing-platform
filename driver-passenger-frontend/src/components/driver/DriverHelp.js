"use client";

import { useEffect, useState } from "react";
import { LifeBuoy, MessageCircle, Phone, X } from "lucide-react";
import { SUPPORT_CALL_NUMBER, SUPPORT_WHATSAPP_NUMBER } from "@/components/SupportContact";

// One Help entry point for every driver screen. Opens a simple sheet
// with the two existing support contacts.
export default function DriverHelp({ floating = false, className = "" }) {
    const [open, setOpen] = useState(false);

    useEffect(() => {
        if (!open) return undefined;
        const onKey = (event) => event.key === "Escape" && setOpen(false);
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [open]);

    const position = floating
        ? "fixed right-4 top-[max(16px,env(safe-area-inset-top))] z-[60] shadow-pd-lg"
        : "";

    return (
        <>
            <button
                type="button"
                onClick={() => setOpen(true)}
                className={`inline-flex min-h-11 items-center gap-2 rounded-full border border-pd-line bg-pd-surface px-4 text-sm font-bold text-pd-text outline-none transition-colors hover:bg-pd-surface-2 focus-visible:ring-2 focus-visible:ring-pd-accent ${position} ${className}`}
            >
                <LifeBuoy className="h-5 w-5 text-pd-accent-text" aria-hidden="true" />
                Help
            </button>

            {open && (
                <div className="fixed inset-0 z-[90] flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label="Help and support">
                    <button
                        type="button"
                        aria-label="Close help"
                        onClick={() => setOpen(false)}
                        className="absolute inset-0 bg-pd-scrim"
                    />
                    <div className="sf-rise relative w-full max-w-md rounded-t-[28px] border border-pd-line bg-pd-surface p-6 pb-[max(24px,env(safe-area-inset-bottom))] text-pd-text shadow-pd-lg sm:rounded-[28px]">
                        <div className="flex items-start justify-between gap-4">
                            <div>
                                <h2 className="text-xl font-extrabold">Need help?</h2>
                                <p className="mt-1 text-base text-pd-muted">Talk to the Safar team. We are happy to help.</p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setOpen(false)}
                                aria-label="Close"
                                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-pd-line text-pd-text"
                            >
                                <X className="h-5 w-5" aria-hidden="true" />
                            </button>
                        </div>

                        <div className="mt-5 flex flex-col gap-3">
                            <a
                                href="tel:+923160609994"
                                className="flex min-h-14 items-center justify-center gap-3 rounded-2xl bg-pd-accent px-5 text-base font-extrabold text-pd-accent-ink"
                            >
                                <Phone className="h-5 w-5" aria-hidden="true" />
                                Call us · {SUPPORT_CALL_NUMBER}
                            </a>
                            <a
                                href="https://wa.me/923100668952"
                                target="_blank"
                                rel="noreferrer"
                                className="flex min-h-14 items-center justify-center gap-3 rounded-2xl border border-pd-accent bg-pd-accent-soft px-5 text-base font-extrabold text-pd-accent-text"
                            >
                                <MessageCircle className="h-5 w-5" aria-hidden="true" />
                                WhatsApp · {SUPPORT_WHATSAPP_NUMBER}
                            </a>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
