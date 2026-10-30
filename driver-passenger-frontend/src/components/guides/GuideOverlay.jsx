"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Volume2, VolumeX, X } from "lucide-react";
import { useLanguage } from "@/components/i18n/LanguageProvider";

/**
 * Coach-mark overlay (Phase 3, A12): dims the screen, highlights
 * one element, and shows ONE short instruction with Next / Back /
 * Skip. The speaker button reads the instruction aloud with the
 * device's free text-to-speech (ur-PK when the Urdu UI is on).
 * A step whose target is not on the page simply shows without a
 * highlight — the guide never breaks the screen underneath.
 */
export default function GuideOverlay({ steps, onClose }) {
    const { t, isUrdu } = useLanguage();
    const [index, setIndex] = useState(0);
    const [rect, setRect] = useState(null);
    const [speaking, setSpeaking] = useState(false);
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
        try {
            const synth = window.speechSynthesis;
            if (!synth) return;
            const utter = new SpeechSynthesisUtterance(isUrdu ? step.ur : step.en);
            utter.lang = isUrdu ? "ur-PK" : "en-US";
            const voice = synth
                .getVoices()
                .find((v) => v.lang?.toLowerCase().startsWith(isUrdu ? "ur" : "en"));
            if (voice) utter.voice = voice;
            utter.onend = () => setSpeaking(false);
            utter.onerror = () => setSpeaking(false);
            synth.cancel();
            synth.speak(utter);
            setSpeaking(true);
        } catch { /* TTS unavailable — the text stays readable */ }
    };

    const last = index >= total - 1;
    const pad = 6;

    return createPortal(
        <div className="fixed inset-0 z-[90]" role="dialog" aria-modal="true" aria-label={t("guide.replay")}>
            {/* Dim layer (the highlight box punches its own hole via box-shadow) */}
            {!rect && <div className="absolute inset-0 bg-black/60" />}
            {rect && (
                <div
                    aria-hidden="true"
                    className="pointer-events-none absolute rounded-3xl border-2 border-[#3FD6A2] transition-all duration-300"
                    style={{
                        top: rect.top - pad,
                        left: rect.left - pad,
                        width: rect.width + pad * 2,
                        height: rect.height + pad * 2,
                        boxShadow: "0 0 0 9999px rgba(0,0,0,0.62)",
                    }}
                />
            )}
            {/* Block taps to the app while the guide is open */}
            <div className="absolute inset-0" onClick={(e) => e.stopPropagation()} />

            <div className="absolute inset-x-3 bottom-[max(12px,env(safe-area-inset-bottom))] rounded-[24px] bg-pd-surface p-5 text-pd-text shadow-pd-lg">
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
                    <button
                        type="button"
                        onClick={speak}
                        className={`flex h-12 items-center gap-2 rounded-2xl px-4 text-sm font-bold transition active:scale-95 ${speaking ? "bg-pd-danger-soft text-pd-danger" : "bg-pd-accent-soft text-pd-accent-text"}`}
                    >
                        {speaking ? <VolumeX size={18} /> : <Volume2 size={18} />}
                        {speaking ? t("guide.stopListening") : t("guide.listen")}
                    </button>
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
