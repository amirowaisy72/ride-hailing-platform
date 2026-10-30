"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { STRINGS } from "@/lib/i18n/strings";
import { LANGUAGE_OPTIONS, LANGUAGE_STORAGE_KEY } from "@/components/i18n/languageScript";

export { LANGUAGE_OPTIONS, LANGUAGE_STORAGE_KEY };

/**
 * App language (Phase 3): "en" | "ur".
 *
 * Device-level preference persisted in localStorage (default
 * English). When Urdu is active the whole document flips to
 * dir="rtl" + lang="ur" and the `lang-ur` class switches the app
 * font to Noto Nastaliq Urdu (see globals.css). Translations come
 * from the STRINGS dictionary; a missing Urdu string falls back to
 * English so a half-translated screen never breaks.
 */

const LanguageContext = createContext({
    lang: "en",
    isUrdu: false,
    setLang: () => { },
    t: (key) => key,
});

function readStoredLanguage() {
    try {
        const value = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
        return LANGUAGE_OPTIONS.includes(value) ? value : "en";
    } catch {
        return "en";
    }
}

export function applyLanguage(lang) {
    const root = document.documentElement;
    const urdu = lang === "ur";
    root.lang = urdu ? "ur" : "en";
    root.dir = urdu ? "rtl" : "ltr";
    root.classList.toggle("lang-ur", urdu);
}

/**
 * Non-hook language read for pure helpers (status-label tables and
 * other render-time utilities that cannot consume context). Reads
 * the same localStorage key the provider persists.
 */
export function storedLanguage() {
    try {
        return window.localStorage.getItem(LANGUAGE_STORAGE_KEY) === "ur" ? "ur" : "en";
    } catch {
        return "en";
    }
}

export function translate(lang, key, vars) {
    const table = STRINGS[lang] || STRINGS.en;
    let text = table[key] ?? STRINGS.en[key] ?? key;
    if (vars) {
        for (const [name, value] of Object.entries(vars)) {
            text = text.replaceAll(`{${name}}`, String(value));
        }
    }
    return text;
}

export function LanguageProvider({ children }) {
    const [lang, setLangState] = useState("en");

    useEffect(() => {
        const stored = readStoredLanguage();
        setLangState(stored);
        applyLanguage(stored);
    }, []);

    const setLang = useCallback((next) => {
        const value = LANGUAGE_OPTIONS.includes(next) ? next : "en";
        setLangState(value);
        applyLanguage(value);
        try {
            window.localStorage.setItem(LANGUAGE_STORAGE_KEY, value);
        } catch { /* storage unavailable — language still applies for this session */ }
    }, []);

    const t = useCallback((key, vars) => translate(lang, key, vars), [lang]);

    const value = useMemo(
        () => ({ lang, isUrdu: lang === "ur", setLang, t }),
        [lang, setLang, t]
    );

    return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
    return useContext(LanguageContext);
}
