"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Volume2, VolumeX, X } from "lucide-react";
import { useLanguage } from "@/components/i18n/LanguageProvider";

/**
 * Coach-mark overlay (Phase 3, A12; positioning fixed in the
 * Amir-test fix round, T-1/T-3): dims the screen, highlights one
 * element, and shows ONE short instruction with Next / Back / Skip.
 *
 * T-1: the instruction panel is positioned dynamically from the
 * target's rect — below the target when there is room, above it
 * when there is not, and at the far end of the screen as a last
 * resort — so the panel NEVER covers the element it points at.
 * The dim layer leaves a real hole around the highlight, so the
 * target stays clickable while the guide is open.
 *
 * T-3: the Listen button always reads the instruction aloud in
 * Urdu (ur-PK, with an explicitly selected Urdu voice). Where the
 * device has no Urdu voice at all, the Listen button is not shown
 * — it never falls back to an English voice.
 *
 * A step whose target is not on the page simply shows without a
 * highlight — the guide never breaks the screen underneath.
 */
export default function GuideOverlay({ steps, onClose }) {
    const { t, isUrdu } = useLanguage();
    const [index, setIndex] = useState(0);
    const [rect, setRect] = useState(null);
    const [speaking, setSpeaking] = useState(false);
    const [urduVoice, setUrduVoice] = useState(null);
    const [voicesReady, setVoicesReady] = useState(false);
    const [panelHeight, setPanelHeight] = useState(0);
    const panelRef = useRef(null);
    const step = steps[index];
    const total = steps.length;

    const measure = useCallback(() => {
        if (!step?.target) {
            setRect(null);
            return;
        }
        const el = document.querySelector(`[data-guide="${step.target}"]`);
        if (!el) {
            setRect(null);
            return;
        }
        const r = el.getBoundingClientRect();
        setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
    }, [step]);

    useEffect(() => {
        if (!step?.target) {
            const clear = setTimeout(() => setRect(null), 0);
            return () => clearTimeout(clear);
        }
        const el = document.querySelector(`[data-guide="${step.target}"]`);
        el?.scrollIntoView({ block: "center", behavior: "smooth" });
        const first = setTimeout(measure, 350);
        const poll = setInterval(measure, 400);
        window.addEventListener("resize", measure);
        return () => {
            clearTimeout(first);
            clearInterval(poll);
            window.removeEventListener("resize", measure);
        };
    }, [step, measure]);

    // Measure the rendered panel so placement math uses its real height.
    useLayoutEffect(() => {
        if (panelRef.current) {
            const h = panelRef.current.offsetHeight;
            if (h && h !== panelHeight) setPanelHeight(h);
        }
    });

    // ---- T-3: Urdu TTS voice discovery --------------------------------
    // getVoices() is often empty on first call and fills in via the
    // voiceschanged event, so availability is tracked as state.
    useEffect(() => {
        let cancelled = false;
        const update = () => {
            try {
                const voices = window.speechSynthesis?.getVoices() || [];
                if (cancelled) return;
                if (voices.length > 0) setVoicesReady(true);
                const ur = voices.find((v) => v.lang?.toLowerCase().startsWith("ur"));
                setUrduVoice(ur || null);
            } catch { /* TTS unavailable */ }
        };
        update();
        window.speechSynthesis?.addEventListener?.("voiceschanged", update);
        return () => {
            cancelled = true;
            window.speechSynthesis?.removeEventListener?.("voiceschanged", update);
        };
    }, []);

    const stopSpeaking = useCallback(() => {
        try { window.speechSynthesis?.cancel(); } catch { /* noop */ }
        setSpeaking(false);
    }, []);

    useEffect(() => stopSpeaking, [index, stopSpeaking]);
    useEffect(() => () => stopSpeaking(), [stopSpeaking]);

    const speak = () => {
        if (speaking) {
            stopSpeaking();
            return;
        }
        // Urdu only (T-3): the Urdu step text, an Urdu voice, ur-PK.
        if (!urduVoice) return;
        try {
            const synth = window.speechSynthesis;
            if (!synth) return;
            const utter = new SpeechSynthesisUtterance(step.ur);
            utter.lang = "ur-PK";
            utter.voice = urduVoice;
            utter.onend = () => setSpeaking(false);
            utter.onerror = () => setSpeaking(false);
            synth.cancel();
            synth.speak(utter);
            setSpeaking(true);
        } catch { /* TTS unavailable — the text stays readable */ }
    };

    const last = index >= total - 1;
    const pad = 6;
    const gap = 14;

    // ---- T-1: dynamic panel placement ---------------------------------
    // Panel sits below the target if it fits there, above it if it
    // fits there, otherwise at whichever screen end is opposite the
    // target's centre. It is clamped inside the viewport.
    const vh = typeof window !== "undefined" ? window.innerHeight : 0;
    const estimatedPanelH = panelHeight || 248;
    let panelTop = null;
    if (rect && vh) {
        const targetTop = rect.top - pad;
        const targetBottom = rect.top + rect.height + pad;
        const fitsBelow = vh - targetBottom >= estimatedPanelH + gap + 8;
        const fitsAbove = targetTop >= estimatedPanelH + gap + 8;
        if (fitsBelow) {
            panelTop = targetBottom + gap;
        } else if (fitsAbove) {
            panelTop = targetTop - gap - estimatedPanelH;
        } else {
            const targetCentre = rect.top + rect.height / 2;
            panelTop = targetCentre < vh / 2 ? vh - estimatedPanelH - 12 : 12;
        }
        panelTop = Math.max(8, Math.min(panelTop, Math.max(8, vh - estimatedPanelH - 8)));
    }

    const hole = rect
        ? {
            top: Math.max(0, rect.top - pad),
            left: Math.max(0, rect.left - pad),
            width: rect.width + pad * 2,
            height: rect.height + pad * 2,
        }
        : null;

    const blockTap = (e) => e.stopPropagation();

    return createPortal(
        <div className="fixed inset-0 z-[90]" role="dialog" aria-modal="true" aria-label={t("guide.replay")}>
            {/* Dim layer with a real hole over the target, so the
                highlighted element stays visible AND clickable.
                Without a target the whole screen is blocked. */}
            {!hole && <div className="absolute inset-0 bg-black/60" onClick={blockTap} />}
            {hole && (
                <>
                    <div aria-hidden="true" className="absolute bg-black/60" onClick={blockTap}
                        style={{ top: 0, left: 0, width: "100%", height: hole.top }} />
                    <div aria-hidden="true" className="absolute bg-black/60" onClick={blockTap}
                        style={{ top: hole.top + hole.height, left: 0, width: "100%", bottom: 0 }} />
                    <div aria-hidden="true" className="absolute bg-black/60" onClick={blockTap}
                        style={{ top: hole.top, left: 0, width: hole.left, height: hole.height }} />
                    <div aria-hidden="true" className="absolute bg-black/60" onClick={blockTap}
                        style={{ top: hole.top, left: hole.left + hole.width, right: 0, height: hole.height }} />
                    <div
                        aria-hidden="true"
                        className="pointer-events-none absolute rounded-3xl border-2 border-[#3FD6A2] transition-all duration-300"
                        style={{
                            top: hole.top,
                            left: hole.left,
                            width: hole.width,
                            height: hole.height,
                        }}
                    />
                </>
            )}

            <div
                ref={panelRef}
                className="absolute inset-x-3 rounded-[24px] bg-pd-surface p-5 text-pd-text shadow-pd-lg"
                style={panelTop !== null
                    ? { top: panelTop }
                    : { bottom: "max(12px, env(safe-area-inset-bottom))" }}
            >
                <div className="flex items-start justify-between gap-3">
                    <p className="text-xs font-extrabold uppercase tracking-wide text-pd-accent-text">
                        {t("guide.stepOf", { step: index + 1, total })}
                    </p>
                    <button
                        type="button"
                        onClick={() => onClose("skip")}
                        aria-label={t("guide.skip")}
                        className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-pd-surface-2 text-pd-muted"
                    >
                        <X size={16} />
                    </button>
                </div>

                <p className="mt-2 text-[17px] font-semibold leading-relaxed">
                    {isUrdu ? step.ur : step.en}
                </p>

                <div className="mt-4 flex items-center gap-2">
                    {/* T-3: Listen exists only where an Urdu voice
                        exists; it never speaks English. While the
                        voice list is still loading the button stays
                        hidden rather than guessing. */}
                    {voicesReady && urduVoice && (
                        <button
                            type="button"
                            onClick={speak}
                            className={`flex h-12 items-center gap-2 rounded-2xl px-4 text-sm font-bold transition active:scale-95 ${speaking ? "bg-pd-danger-soft text-pd-danger" : "bg-pd-accent-soft text-pd-accent-text"}`}
                        >
                            {speaking ? <VolumeX size={18} /> : <Volume2 size={18} />}
                            {speaking ? t("guide.stopListening") : t("guide.listen")}
                        </button>
                    )}
                    <span className="flex-1" />
                    {index > 0 && (
                        <button
                            type="button"
                            onClick={() => setIndex((i) => Math.max(0, i - 1))}
                            className="flex h-12 items-center rounded-2xl bg-pd-surface-2 px-4 text-sm font-bold text-pd-text transition active:scale-95"
                        >
                            {t("guide.back")}
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={() => (last ? onClose("finish") : setIndex((i) => i + 1))}
                        className="flex h-12 items-center rounded-2xl bg-[#087F5B] px-5 text-sm font-extrabold text-white transition active:scale-95"
                    >
                        {last ? t("guide.finish") : t("guide.next")}
                    </button>
                </div>
                {!last && (
                    <button
                        type="button"
                        onClick={() => onClose("skip")}
                        className="mt-3 w-full text-center text-xs font-bold text-pd-muted"
                    >
                        {t("guide.skip")}
                    </button>
                )}
            </div>
        </div>,
        document.body
    );
}
