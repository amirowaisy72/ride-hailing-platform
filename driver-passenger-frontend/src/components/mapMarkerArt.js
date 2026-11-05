// Shared professional map-pin artwork for RideMap — the single map used
// by every ride and parcel screen. Crisp inline SVG only — no emoji, no
// external assets. Theme colors: Safar green #087F5B, white, dark slate
// #16181D.

export const MARKER_GREEN = "#087F5B";
export const MARKER_SLATE = "#16181D";
export const MARKER_WHITE = "#FFFFFF";

const svgWrap = (inner, size, filled) =>
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${size}" height="${size}" ${filled
        ? `fill="currentColor"`
        : `fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"`
    } aria-hidden="true">${inner}</svg>`;

/**
 * Standing passenger with one arm raised, waving to hail a ride. The raised
 * arm carries the rx-map-wave-* classes: RideMap's MAP_STYLES rotates it at
 * the shoulder (and the forearm at the elbow); without those styles the arm
 * simply rests in the raised pose.
 */
export function hailingPersonSvg(color = MARKER_WHITE, size = 20) {
    const limb = `fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"`;
    return `<span style="display:grid;place-items:center;color:${color}">` +
        svgWrap(
            // head, neck
            `<ellipse cx="12" cy="4.6" rx="2.3" ry="2.6"/>` +
            `<rect x="11" y="6.8" width="2" height="1.8" rx="0.8"/>` +
            // torso
            `<path d="M9.6 8 H14.4 C15.7 8 16.3 8.9 16.1 10.2 L15.6 15.8 H8.4 L7.9 10.2 C7.7 8.9 8.3 8 9.6 8 Z"/>` +
            // legs and shoes
            `<rect x="8.5" y="14.8" width="3.2" height="7" rx="1.4"/>` +
            `<rect x="12.3" y="14.8" width="3.2" height="7" rx="1.4"/>` +
            `<ellipse cx="9.9" cy="21.8" rx="2" ry="0.9"/>` +
            `<ellipse cx="14.1" cy="21.8" rx="2" ry="0.9"/>` +
            // relaxed arm and hand
            `<path d="M15.5 9.9 L17 15" ${limb}/>` +
            `<ellipse cx="17.1" cy="16.3" rx="1.2" ry="1.4"/>` +
            // waving arm: upper arm pivots at the shoulder, forearm and hand at the elbow
            `<g class="rx-map-wave-arm">` +
            `<path d="M8.5 9.9 L5.4 8.2" ${limb}/>` +
            `<g class="rx-map-wave-fore">` +
            `<path d="M5.4 8.2 L5 4.4" ${limb}/>` +
            `<ellipse cx="5" cy="3.1" rx="1.35" ry="1.7"/>` +
            `</g></g>`,
            size,
            true
        ) +
        `</span>`;
}

function motorcycleGlyph() {
    return (
        `<circle cx="5.4" cy="16.9" r="2.7"/>` +
        `<circle cx="18.6" cy="16.9" r="2.7"/>` +
        `<path d="M5.4 16.9 L8.7 10.1 H12.6"/>` +
        `<path d="M12.6 10.1 L14.5 8.7"/>` +
        `<path d="M14.5 8.7 L16.9 6.1 H19.1"/>` +
        `<path d="M14.5 8.7 L18.6 16.9"/>` +
        `<path d="M8.7 10.1 L11.8 16.9 H15.2"/>`
    );
}

function rickshawGlyph() {
    return (
        `<circle cx="6.1" cy="17.3" r="2.3"/>` +
        `<circle cx="18.4" cy="17.3" r="2.3"/>` +
        `<path d="M4.4 17.3 V11.9 C4.4 8.3 7.1 5.7 10.7 5.7 H13.6 C16.1 5.7 17.7 7.5 18 10 L18.4 17.3"/>` +
        `<path d="M8.4 17.3 H16.1"/>` +
        `<path d="M9.3 17.3 V10.9 H14.6 V17.3"/>` +
        `<path d="M17.8 9.4 L19.7 6.9"/>`
    );
}

function carGlyph() {
    return (
        `<path d="M2.9 15.6 L4.1 10.3 C4.3 9.4 5 8.9 5.9 8.9 H7.7 L10 5.7 C10.4 5.1 11 4.8 11.7 4.8 H14.7 C15.4 4.8 16 5.1 16.4 5.7 L18.7 8.9 H19.5 C20.3 8.9 20.9 9.4 21.1 10.2 L21.8 15.6"/>` +
        `<path d="M12.2 4.8 V8.9"/>` +
        `<circle cx="7" cy="16.9" r="1.9"/>` +
        `<circle cx="17.4" cy="16.9" r="1.9"/>` +
        `<path d="M2.9 16.9 H5.1 M8.9 16.9 H15.5 M19.3 16.9 H21.8"/>`
    );
}

/** Vehicle glyph chosen by backend vehicleType enum; defaults to car. */
export function vehicleGlyphSvg(type, color = MARKER_WHITE, size = 22) {
    const normalized = String(type || "").toUpperCase();
    const inner = normalized === "BIKE" || normalized === "MOTORCYCLE"
        ? motorcycleGlyph()
        : normalized === "RICKSHAW"
            ? rickshawGlyph()
            : carGlyph();

    return `<span style="display:grid;place-items:center;color:${color}">` +
        svgWrap(inner, size) +
        `</span>`;
}

/** Destination flag glyph (filled flag on a stroked pole). */
export function flagSvg(color = MARKER_WHITE, size = 16) {
    return `<span style="display:grid;place-items:center;color:${color}">` +
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
        `<path d="M6.5 21.5 V3.5"/>` +
        `<path d="M6.5 4 H15.2 L13 6.9 L15.2 9.8 H6.5 Z" fill="currentColor" stroke="none"/>` +
        `</svg></span>`;
}
