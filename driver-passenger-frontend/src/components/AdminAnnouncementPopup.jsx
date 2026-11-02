"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { storedLanguage } from "@/components/i18n/LanguageProvider";
import { apiRequest } from "@/lib/api";

// ---------------------------------------------------------------------------
// Admin in-app announcement popup: exactly once per user per
// announcement.
//
//  * Fetches once after sign-in: the oldest active announcement that
//    targets this user and that they have not read yet.
//  * Closing it marks it read ON THE SERVER, so it never returns —
//    not next launch, not after reinstall, not on a new device.
//  * Only one announcement per launch: if several are unread, the
//    next one appears on the following launch.
//  * No token (logged out) means no popup; failures are silent so a
//    backend hiccup never blocks app use.
// ---------------------------------------------------------------------------

export default function AdminAnnouncementPopup() {
    const { token } = useAuth();
    const [announcement, setAnnouncement] = useState(null);
    const [closing, setClosing] = useState(false);

    useEffect(() => {
        if (!token) return undefined;
        let cancelled = false;
        (async () => {
            try {
                const result = await apiRequest("/announcements/active", {
                    token,
                });
                if (!cancelled && result?.announcement) {
                    setAnnouncement(result.announcement);
                }
            } catch {
                /* Silent: announcements must never block the app. */
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [token]);

    async function close() {
        if (!announcement || closing) return;
        setClosing(true);
        try {
            await apiRequest(`/announcements/${announcement.id}/read`, {
                token,
                method: "POST",
            });
        } catch {
            // Even if the read-mark fails, hide it for this session;
            // it will simply be offered again next launch.
        } finally {
            setAnnouncement(null);
            setClosing(false);
        }
    }

    if (!announcement) return null;

    const isUr = storedLanguage() === "ur";

    return (
        <div
            className="fixed inset-0 z-[145] flex items-end justify-center bg-black/45 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:items-center"
            role="alertdialog"
            aria-modal="true"
            aria-label={announcement.title}
        >
            <div className="pd-rise w-full max-w-md rounded-[24px] border border-pd-line bg-pd-elevated p-5 shadow-pd-lg">
                <h2 className="text-base font-extrabold text-pd-text">
                    {announcement.title}
                </h2>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-snug text-pd-muted">
                    {announcement.body}
                </p>
                <button
                    type="button"
                    disabled={closing}
                    onClick={() => void close()}
                    className="mt-4 flex h-12 w-full items-center justify-center rounded-xl bg-pd-accent text-sm font-extrabold text-pd-accent-ink disabled:opacity-50"
                >
                    {isUr ? "ٹھیک ہے" : "Got it"}
                </button>
            </div>
        </div>
    );
}
