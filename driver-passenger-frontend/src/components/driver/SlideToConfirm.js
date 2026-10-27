"use client";

import { useRef, useState } from "react";
import { ArrowRight, Check } from "lucide-react";

const KNOB = 52;
const PAD = 5;

/**
 * Slide-to-confirm control for trip step actions (Arrived, Start trip,
 * Complete trip). A stray tap can never fire it: the knob must be
 * dragged at least 85% across the track (or the knob activated by
 * keyboard) before `onConfirm` runs.
 */
export default function SlideToConfirm({ label, onConfirm, disabled = false, variant = "lime" }) {
    const trackRef = useRef(null);
    const dragRef = useRef(null);
    const [offset, setOffset] = useState(0);
    const [dragging, setDragging] = useState(false);
    const [done, setDone] = useState(false);

    const maxOffset = () => Math.max(0, (trackRef.current?.clientWidth || 0) - KNOB - PAD * 2);

    function confirm() {
        if (disabled || done) return;
        setDone(true);
        setOffset(maxOffset());
        onConfirm?.();
        window.setTimeout(() => { setDone(false); setOffset(0); }, 900);
    }

    function onPointerDown(event) {
        if (disabled || done) return;
        dragRef.current = { startX: event.clientX, startOffset: offset };
        setDragging(true);
        event.currentTarget.setPointerCapture?.(event.pointerId);
    }

    function onPointerMove(event) {
        const drag = dragRef.current;
        if (!drag) return;
        const next = Math.min(maxOffset(), Math.max(0, drag.startOffset + event.clientX - drag.startX));
        setOffset(next);
    }

    function onPointerUp() {
        const drag = dragRef.current;
        dragRef.current = null;
        setDragging(false);
        if (!drag) return;
        if (offset >= maxOffset() * 0.85 && maxOffset() > 0) confirm();
        else setOffset(0);
    }

    return (
        <div
            ref={trackRef}
            className={`dx-slide dx-slide-${variant}`}
            data-done={done ? "true" : undefined}
            data-disabled={disabled ? "true" : undefined}
            role="group"
            aria-label={label}
        >
            <span className="dx-slide-fill" style={{ width: `${offset + KNOB + PAD * 2}px` }} aria-hidden />
            <span className="dx-slide-label">{done ? "Confirmed" : label}</span>
            <button
                type="button"
                className="dx-slide-knob"
                style={{
                    transform: `translateX(${offset}px)`,
                    transition: dragging ? "none" : "transform .25s ease",
                }}
                disabled={disabled}
                aria-label={`Slide to confirm: ${label}`}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={() => { dragRef.current = null; setDragging(false); setOffset(0); }}
                onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        confirm();
                    }
                }}
            >
                {done ? <Check size={22} /> : <ArrowRight size={22} />}
            </button>
        </div>
    );
}
