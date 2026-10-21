"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

/**
 * Application-wide theme preference.
 *
 * preference: "system" | "light" | "dark"   (what the user chose)
 * resolvedTheme: "light" | "dark"           (what is actually shown)
 *
 * Persistence is localStorage for now. To move to a database-backed
 * preference later, call `setPreference(valueFromServer)` after login and
 * pass `onPreferenceChange` to sync the user's changes to the API.
 */

import { THEME_OPTIONS, THEME_STORAGE_KEY } from "@/components/theme/themeScript";

export { THEME_OPTIONS, THEME_STORAGE_KEY };

const ThemeContext = createContext({
    preference: "system",
    resolvedTheme: "light",
    setPreference: () => { },
});

function readStoredPreference() {
    try {
        const value = window.localStorage.getItem(THEME_STORAGE_KEY);
        return THEME_OPTIONS.includes(value) ? value : "system";
    } catch {
        return "system";
    }
}

function systemPrefersDark() {
    return typeof window !== "undefined"
        && window.matchMedia?.("(prefers-color-scheme: dark)").matches;
}

export function applyTheme(resolved) {
    const root = document.documentElement;
    root.classList.toggle("dark", resolved === "dark");
    root.dataset.theme = resolved;
    root.style.colorScheme = resolved;

    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", resolved === "dark" ? "#0c0d10" : "#f4f5f7");
}

export function ThemeProvider({ children, onPreferenceChange }) {
    const [preference, setPreferenceState] = useState("system");
    const [systemDark, setSystemDark] = useState(false);

    // Hydrate from storage + subscribe to OS appearance changes.
    useEffect(() => {
        setPreferenceState(readStoredPreference());
        const media = window.matchMedia?.("(prefers-color-scheme: dark)");
        setSystemDark(Boolean(media?.matches));

        const onChange = (event) => setSystemDark(event.matches);
        media?.addEventListener?.("change", onChange);

        const onStorage = (event) => {
            if (event.key === THEME_STORAGE_KEY) setPreferenceState(readStoredPreference());
        };
        window.addEventListener("storage", onStorage);

        // Allow colour transitions only after first paint (prevents flash).
        const frame = requestAnimationFrame(() => document.documentElement.classList.add("theme-ready"));

        return () => {
            media?.removeEventListener?.("change", onChange);
            window.removeEventListener("storage", onStorage);
            cancelAnimationFrame(frame);
        };
    }, []);

    const resolvedTheme = preference === "system"
        ? (systemDark ? "dark" : "light")
        : preference;

    useEffect(() => {
        applyTheme(resolvedTheme);
    }, [resolvedTheme]);

    const setPreference = useCallback((next) => {
        if (!THEME_OPTIONS.includes(next)) return;
        setPreferenceState(next);
        try {
            window.localStorage.setItem(THEME_STORAGE_KEY, next);
        } catch {
            // Storage may be unavailable (private mode); theme still applies for this session.
        }
        onPreferenceChange?.(next);
    }, [onPreferenceChange]);

    const value = useMemo(
        () => ({ preference, resolvedTheme, setPreference, systemDark: systemPrefersDark() }),
        [preference, resolvedTheme, setPreference]
    );

    return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
    return useContext(ThemeContext);
}

