"use client";

import { useEffect, useState } from "react";
import { CircleHelp } from "lucide-react";
import GuideOverlay from "@/components/guides/GuideOverlay";
import { GUIDES } from "@/lib/guides/definitions";
import { isGuideImmature, recordGuideView } from "@/lib/guides/guideStore";
import { useLanguage } from "@/components/i18n/LanguageProvider";

/**
 * Drop-in tutorial guide for one service (Phase 3, A12).
 *
 * Auto-opens the first time an immature user reaches the service
 * (and at most once per browser session per service, so a skip is
 * respected until the next visit). Once the user has completed the
 * service's real flow twice — recorded via recordFlowCompletion —
 * it stops auto-opening for good. The floating "Guide" button
 * replays it at any time.
 */
export default function ServiceGuide({ serviceId, userId }) {
    const { t } = useLanguage();
    const [open, setOpen] = useState(false);
    const steps = GUIDES[serviceId] || [];

    useEffect(() => {
        if (!steps.length) return undefined;
        let sessionKey = "";
        try {
            sessionKey = `guide-session:${serviceId}`;
            if (window.sessionStorage.getItem(sessionKey)) return undefined;
        } catch { /* private mode — fall through and show */ }
        if (!isGuideImmature(userId, serviceId)) return undefined;
        const timer = setTimeout(() => {
            try { window.sessionStorage.setItem(sessionKey, "1"); } catch { /* noop */ }
            recordGuideView(userId, serviceId);
            setOpen(true);
        }, 700);
        return () => clearTimeout(timer);
    }, [serviceId, userId, steps.length]);

    if (!steps.length) return null;

    return (
        <>
            {!open && (
                <button
                    type="button"
                    onClick={() => setOpen(true)}
                    className="fixed bottom-24 end-3 z-40 flex h-11 items-center gap-1.5 rounded-full bg-pd-surface px-3.5 text-xs font-extrabold text-pd-accent-text shadow-pd-lg ring-1 ring-pd-line transition active:scale-95"
                >
                    <CircleHelp size={17} aria-hidden="true" />
                    {t("guide.replay")}
                </button>
            )}
            {open && <GuideOverlay steps={steps} onClose={() => setOpen(false)} />}
        </>
    );
}
