"use client";

import { useRef } from "react";

/**
 * Draggable bottom sheet with three snap states: "peek" | "half" | "full".
 * Height is controlled by the parent so the map camera can account for it.
 * Drag the handle (or tap it) to change state; content scrolls internally.
 */
export const SHEET_ORDER = ["peek", "half", "full"];

export default function DriverSheet({ state, onStateChange, heights, bottomOffset = "0px", label, peek, children }) {
    const drag = useRef(null);

    function onPointerDown(e) {
        drag.current = { y: e.clientY, moved: false };
        e.currentTarget.setPointerCapture?.(e.pointerId);
    }
    function onPointerMove(e) {
        if (drag.current && Math.abs(e.clientY - drag.current.y) > 6) drag.current.moved = true;
    }
    function onPointerUp(e) {
        const d = drag.current;
        drag.current = null;
        if (!d) return;
        const index = SHEET_ORDER.indexOf(state);
        const delta = e.clientY - d.y;
        if (!d.moved) {
            onStateChange(state === "peek" ? "half" : "peek");
        } else if (delta < -40) {
            onStateChange(SHEET_ORDER[Math.min(SHEET_ORDER.length - 1, index + (delta < -220 ? 2 : 1))]);
        } else if (delta > 40) {
            onStateChange(SHEET_ORDER[Math.max(0, index - (delta > 220 ? 2 : 1))]);
        }
    }

    return (
        <section
            aria-label={label}
            className="dx-sheet"
            data-state={state}
            style={{ height: heights[state], bottom: bottomOffset }}
        >
            <button
                type="button"
                className="dx-sheet-handle"
                aria-label={state === "peek" ? "Expand panel" : "Collapse panel"}
                aria-expanded={state !== "peek"}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={() => { drag.current = null; }}
                onKeyDown={(e) => {
                    if (e.key === "ArrowUp") onStateChange(SHEET_ORDER[Math.min(2, SHEET_ORDER.indexOf(state) + 1)]);
                    if (e.key === "ArrowDown") onStateChange(SHEET_ORDER[Math.max(0, SHEET_ORDER.indexOf(state) - 1)]);
                }}
            >
                <span />
            </button>
            {peek && <div className="dx-sheet-peek">{peek}</div>}
            <div className="dx-sheet-body" hidden={state === "peek" && Boolean(peek)}>{children}</div>
        </section>
    );
}
