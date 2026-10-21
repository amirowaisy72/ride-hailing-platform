"use client";

import { useRef } from "react";

/**
 * Three-state mobile bottom sheet: "peek" | "half" | "full".
 *
 * - `peek` (always visible) holds the essential summary + primary action.
 * - `children` is the detail area, revealed in half/full and scrollable
 *   only inside the sheet (no nested scroll traps with the map).
 * - Drag the handle (or tap it) to move between states.
 * Controlled: pass `snap` + `onSnapChange`.
 */
const ORDER = ["peek", "half", "full"];
const BODY_HEIGHT = {
    peek: "0px",
    half: "min(42dvh, 420px)",
    full: "calc(88dvh - 180px)",
};

export default function BottomSheet({ snap = "peek", onSnapChange, peek, children, label = "Details", className = "" }) {
    const start = useRef(null);

    function move(direction) {
        const index = ORDER.indexOf(snap);
        const next = ORDER[Math.max(0, Math.min(ORDER.length - 1, index + direction))];
        if (next !== snap) onSnapChange?.(next);
    }

    function onPointerDown(event) {
        start.current = { y: event.clientY, t: Date.now() };
        event.currentTarget.setPointerCapture?.(event.pointerId);
    }

    function onPointerUp(event) {
        if (!start.current) return;
        const dy = event.clientY - start.current.y;
        start.current = null;
        if (Math.abs(dy) < 8) {
            // Tap toggles between peek and half.
            onSnapChange?.(snap === "peek" ? "half" : "peek");
            return;
        }
        const steps = Math.abs(dy) > 160 ? 2 : 1;
        move(dy < 0 ? steps : -steps);
    }

    return (
        <section
            aria-label={label}
            className={`absolute inset-x-0 bottom-0 z-30 mx-auto flex max-w-xl flex-col rounded-t-[28px] border-t border-pd-line bg-pd-surface text-pd-text shadow-pd-lg sm:inset-x-3 sm:bottom-3 sm:rounded-[28px] sm:border ${className}`}
        >
            <button
                type="button"
                aria-label={snap === "peek" ? `Show ${label.toLowerCase()}` : `Collapse ${label.toLowerCase()}`}
                aria-expanded={snap !== "peek"}
                onPointerDown={onPointerDown}
                onPointerUp={onPointerUp}
                onPointerCancel={() => { start.current = null; }}
                onKeyDown={(e) => {
                    if (e.key === "ArrowUp") { e.preventDefault(); move(1); }
                    if (e.key === "ArrowDown") { e.preventDefault(); move(-1); }
                }}
                className="flex h-7 w-full shrink-0 touch-none items-center justify-center"
            >
                <span className="h-1.5 w-11 rounded-full bg-pd-line-strong" />
            </button>

            <div className="shrink-0 px-4">{peek}</div>

            <div
                className="pd-no-scrollbar overflow-y-auto overscroll-contain px-4 transition-[max-height] duration-300 ease-[cubic-bezier(.22,1,.36,1)]"
                style={{ maxHeight: BODY_HEIGHT[snap] }}
                aria-hidden={snap === "peek"}
                inert={snap === "peek"}
            >
                <div className="pb-2 pt-3">{children}</div>
            </div>

            <div className="pd-safe-bottom shrink-0" />
        </section>
    );
}
