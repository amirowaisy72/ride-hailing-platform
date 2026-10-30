"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Mic, Square } from "lucide-react";
import { useLanguage } from "@/components/i18n/LanguageProvider";

/**
 * Voice input for a text field (Phase 3, A11a).
 *
 * Uses the browser's built-in speech recognition (Web Speech API —
 * free, no service). Urdu first: recognition starts with lang
 * "ur-PK"; if the engine reports it does not support that language
 * it retries once with "en-US". Recognized text is APPENDED to the
 * field through `onAppend(text)` so existing typing is never lost.
 *
 * The button renders nothing when speech recognition is not
 * supported (older WebViews) — the field keeps working by typing.
 * A denied microphone permission shows one short friendly line.
 */
export default function MicButton({ onAppend, disabled = false, className = "" }) {
    const { t } = useLanguage();
    // Support detection via useSyncExternalStore: false during SSR,
    // the real capability on the client — no hydration mismatch and
    // the button simply never renders where the API is missing.
    const supported = useSyncExternalStore(
        () => () => { },
        () => Boolean(window.SpeechRecognition || window.webkitSpeechRecognition),
        () => false
    );
    const [listening, setListening] = useState(false);
    const [note, setNote] = useState("");
    const recognitionRef = useRef(null);
    const retriedRef = useRef(false);

    useEffect(() => () => {
        try { recognitionRef.current?.abort(); } catch { /* noop */ }
    }, []);

    if (!supported) return null;

    const start = () => {
        const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!Ctor || listening) return;
        setNote("");
        retriedRef.current = false;

        const recognition = new Ctor();
        recognitionRef.current = recognition;
        recognition.interimResults = false;
        recognition.continuous = false;
        recognition.maxAlternatives = 1;
        // Safar's users speak Urdu whatever the UI language is, so
        // recognition always starts in ur-PK (en-US retry below).
        recognition.lang = "ur-PK";

        recognition.onresult = (event) => {
            const transcript = event?.results?.[0]?.[0]?.transcript?.trim();
            if (transcript) onAppend?.(transcript);
        };
        recognition.onerror = (event) => {
            const code = event?.error || "";
            setListening(false);
            if (code === "language-not-supported" && !retriedRef.current) {
                // Engine has no Urdu — retry once in English rather
                // than failing the user outright.
                retriedRef.current = true;
                try {
                    const retry = new Ctor();
                    recognitionRef.current = retry;
                    retry.interimResults = false;
                    retry.continuous = false;
                    retry.maxAlternatives = 1;
                    retry.lang = "en-US";
                    retry.onresult = recognition.onresult;
                    retry.onerror = (e2) => {
                        setListening(false);
                        if (e2?.error === "not-allowed" || e2?.error === "service-not-allowed") {
                            setNote(t("mic.denied"));
                        } else if (e2?.error === "no-speech") {
                            setNote(t("mic.noSpeech"));
                        } else {
                            setNote(t("mic.error"));
                        }
                    };
                    retry.onend = () => setListening(false);
                    setListening(true);
                    retry.start();
                    return;
                } catch { /* fall through to the error note */ }
            }
            if (code === "not-allowed" || code === "service-not-allowed") {
                setNote(t("mic.denied"));
            } else if (code === "no-speech") {
                setNote(t("mic.noSpeech"));
            } else if (code !== "aborted") {
                setNote(t("mic.error"));
            }
        };
        recognition.onend = () => setListening(false);

        try {
            setListening(true);
            recognition.start();
        } catch {
            setListening(false);
        }
    };

    const stop = () => {
        try { recognitionRef.current?.stop(); } catch { /* noop */ }
    };

    return (
        <span className={`inline-flex flex-col ${className}`}>
            <button
                type="button"
                disabled={disabled}
                onClick={listening ? stop : start}
                aria-label={listening ? t("mic.tapToStop") : t("mic.speak")}
                aria-pressed={listening}
                className={`grid h-11 w-11 shrink-0 place-items-center rounded-full transition active:scale-95 disabled:opacity-50 ${listening
                    ? "animate-pulse bg-pd-danger text-white"
                    : "bg-pd-accent-soft text-pd-accent-text"
                    }`}
            >
                {listening ? <Square size={17} /> : <Mic size={19} />}
            </button>
            {listening && (
                <span className="mt-1 text-[11px] font-bold text-pd-danger">{t("mic.listening")}</span>
            )}
            {note && !listening && (
                <span role="alert" className="mt-1 max-w-56 text-[11px] font-semibold leading-snug text-pd-danger">
                    {note}
                </span>
            )}
        </span>
    );
}
