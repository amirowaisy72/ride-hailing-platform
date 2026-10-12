"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const SOUND_KEY = "driver:sound-enabled";
const TONES = {
    ride: [660, 880, 990],
    success: [523, 659, 784],
    warning: [440, 330],
    chat: [740, 988],
    info: [660, 880],
};

/**
 * Driver notification centre: de-duplicated history, transient toasts and
 * optional Web-Audio alerts. Sound only plays after the driver enables it
 * with a tap (satisfies browser autoplay rules); the choice is remembered.
 */
export default function useDriverNotifications() {
    const [items, setItems] = useState([]);
    const [toast, setToast] = useState(null);
    const [unread, setUnread] = useState(0);
    const [soundEnabled, setSoundEnabled] = useState(false);
    const soundRef = useRef(false);
    const audioRef = useRef(null);
    const seen = useRef(new Map());
    const toastTimer = useRef(null);

    useEffect(() => {
        try {
            // Preference is restored, but audio stays locked until the next user gesture.
            if (window.localStorage.getItem(SOUND_KEY) === "1") setSoundEnabled(true);
        } catch { /* storage unavailable */ }
    }, []);
    useEffect(() => { soundRef.current = soundEnabled; }, [soundEnabled]);

    const ensureAudio = useCallback(async () => {
        try {
            const Ctx = window.AudioContext || window.webkitAudioContext;
            if (!Ctx) return null;
            const ctx = audioRef.current || new Ctx();
            audioRef.current = ctx;
            if (ctx.state === "suspended") await ctx.resume();
            return ctx;
        } catch { return null; }
    }, []);

    // Unlock audio on the first interaction when the saved preference is "on".
    useEffect(() => {
        const unlock = () => { if (soundRef.current) ensureAudio(); };
        window.addEventListener("pointerdown", unlock, { once: true });
        return () => window.removeEventListener("pointerdown", unlock);
    }, [ensureAudio]);

    const play = useCallback((tone = "info") => {
        if (!soundRef.current) return;
        const ctx = audioRef.current;
        if (!ctx || ctx.state !== "running") return;
        try {
            const start = ctx.currentTime;
            (TONES[tone] || TONES.info).forEach((frequency, index) => {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = "sine";
                osc.frequency.value = frequency;
                const at = start + index * 0.13;
                gain.gain.setValueAtTime(0.0001, at);
                gain.gain.exponentialRampToValueAtTime(0.07, at + 0.015);
                gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.12);
                osc.connect(gain).connect(ctx.destination);
                osc.start(at);
                osc.stop(at + 0.13);
            });
        } catch { /* ignore */ }
    }, []);

    /**
     * notify({ key, title, body, tone, kind, sound })
     * `key` de-duplicates repeats from socket reconnects / polling (60 s window).
     */
    const notify = useCallback((input) => {
        const n = typeof input === "string" ? { title: input } : input;
        if (!n?.title) return;
        const key = n.key || `${n.kind || "info"}:${n.title}:${n.body || ""}`;
        const now = Date.now();
        const last = seen.current.get(key);
        if (last && now - last < 60000) return;
        seen.current.set(key, now);
        if (seen.current.size > 200) {
            for (const [k, t] of seen.current) if (now - t > 60000) seen.current.delete(k);
        }
        const item = { id: `${now}-${Math.random().toString(36).slice(2, 7)}`, kind: n.kind || "info", title: n.title, body: n.body || "", at: now };
        setItems((old) => [item, ...old].slice(0, 30));
        setUnread((u) => Math.min(u + 1, 99));
        setToast(item);
        window.clearTimeout(toastTimer.current);
        toastTimer.current = window.setTimeout(() => setToast(null), n.kind === "error" ? 7000 : 5000);
        if (n.sound !== false) play(n.tone || (n.kind === "error" ? "warning" : n.kind));
    }, [play]);

    useEffect(() => () => window.clearTimeout(toastTimer.current), []);

    const toggleSound = useCallback(async () => {
        const next = !soundRef.current;
        if (next) await ensureAudio();
        setSoundEnabled(next);
        soundRef.current = next;
        try { window.localStorage.setItem(SOUND_KEY, next ? "1" : "0"); } catch { /* ignore */ }
        if (next) play("success");
    }, [ensureAudio, play]);

    return {
        items, toast, unread, soundEnabled,
        notify, toggleSound,
        dismissToast: () => setToast(null),
        markRead: () => setUnread(0),
        clear: () => { setItems([]); setUnread(0); },
    };
}
