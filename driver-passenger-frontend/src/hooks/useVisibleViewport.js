"use client";

import { useEffect, useState } from "react";

// Tracks the *visible* viewport — the part of the page NOT covered by
// the on-screen keyboard — via window.visualViewport.
//
// Why this exists: in the Android WebView (Capacitor) the layout
// viewport does NOT shrink when the keyboard opens; the keyboard simply
// overlays the bottom half of the screen. Anything sized in dvh or
// anchored to the bottom (booking sheet, search panels) keeps its full
// layout height and its lower part disappears behind the keyboard —
// search results were squeezed into a thin strip above it. The visual
// viewport, by contrast, always reports the region actually visible,
// so surfaces that need to live "above the keyboard" size themselves
// from it while a search is active, and drop the override when the
// keyboard closes.
//
// Returns { height, offsetTop, keyboardOpen } — height/offsetTop in
// CSS px (null height until measured), keyboardOpen when the visible
// height has shrunk more than 120 px below the largest seen (the URL
// bar collapsing is ~56 px, so it never trips this).
export function useVisibleViewport() {
    const [viewport, setViewport] = useState({ height: null, offsetTop: 0, keyboardOpen: false });

    useEffect(() => {
        if (typeof window === "undefined") return undefined;

        let maxHeight = window.innerHeight;

        function update() {
            const vv = window.visualViewport;
            const height = vv ? vv.height : window.innerHeight;
            if (height > maxHeight) maxHeight = height;
            setViewport({
                height,
                offsetTop: vv ? vv.offsetTop : 0,
                keyboardOpen: maxHeight - height > 120,
            });
        }

        update();
        const vv = window.visualViewport;
        vv?.addEventListener("resize", update);
        vv?.addEventListener("scroll", update);
        window.addEventListener("resize", update);
        window.addEventListener("orientationchange", update);
        return () => {
            vv?.removeEventListener("resize", update);
            vv?.removeEventListener("scroll", update);
            window.removeEventListener("resize", update);
            window.removeEventListener("orientationchange", update);
        };
    }, []);

    return viewport;
}

// Inline style that pins a full-screen surface to exactly the visible
// region (use with position absolute/fixed ancestors that span the
// layout viewport). Returns undefined when the keyboard is closed, so
// the surface falls back to its normal class-based layout untouched.
export function visibleViewportSurfaceStyle(viewport) {
    if (!viewport || !viewport.keyboardOpen || !viewport.height) return undefined;
    return { height: viewport.height, top: viewport.offsetTop, bottom: "auto" };
}
