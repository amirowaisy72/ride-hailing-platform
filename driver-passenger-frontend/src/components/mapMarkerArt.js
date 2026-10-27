// Shared professional map-pin artwork for RideMap and ParcelTrackingMap.
// Crisp inline SVG only — no emoji, no external assets. Theme colors:
// Safar green #087F5B, white, dark slate #16181D.

export const MARKER_GREEN = "#087F5B";
export const MARKER_SLATE = "#16181D";
export const MARKER_WHITE = "#FFFFFF";

const svgWrap = (inner, size, filled) =>
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${size}" height="${size}" ${filled
        ? `fill="currentColor"`
        : `fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"`
    } aria-hidden="true">${inner}</svg>`;

/** Standing passenger with one arm raised, hailing a ride. */
export function hailingPersonSvg(color = MARKER_WHITE, size = 20) {
    return `<span style="display:grid;place-items:center;color:${color}">` +
        svgWrap(
            `<circle cx="10.4" cy="4.4" r="2" fill="currentColor" stroke="none"/>` +
            `<path d="M11.3 7.3 L16.2 3.2"/>` + // raised arm
            `<path d="M11.3 7.5 L8.4 10.8"/>` + // relaxed arm
            `<path d="M11.5 7.1 L10.9 13.4"/>` + // torso
            `<path d="M10.9 13.4 L8.2 20.6"/>` + // leg
            `<path d="M10.9 13.4 L14.1 20.4"/>`, // leg
            size
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

// Pin family used by ParcelTrackingMap (RideMap keeps its own rx-map-*
// classes but shares the glyph builders above).
export const MAP_PIN_STYLES = `
.sf-pin{position:relative;display:block;filter:drop-shadow(0 6px 9px rgba(9,24,17,.38))}
.sf-pin-disc{position:relative;z-index:2;display:grid;place-items:center;border-radius:50%;border:3px solid #fff}
.sf-pin-tail{position:absolute;z-index:1;left:50%;bottom:-6px;transform:translateX(-50%);width:0;height:0;border:6px solid transparent}
.sf-pin--green .sf-pin-disc{background:${MARKER_GREEN}}
.sf-pin--green .sf-pin-tail{border-top:8px solid ${MARKER_GREEN}}
.sf-pin--slate .sf-pin-disc{background:${MARKER_SLATE}}
.sf-pin--slate .sf-pin-tail{border-top:8px solid ${MARKER_SLATE}}
.sf-pin-pulse{position:absolute;inset:-9px;z-index:0;border-radius:50%;background:rgba(8,127,91,.4);animation:sf-pin-pulse 2.2s ease-out infinite}
@keyframes sf-pin-pulse{0%{transform:scale(.7);opacity:.9}100%{transform:scale(1.5);opacity:0}}
@media (prefers-reduced-motion: reduce){.sf-pin-pulse{animation:none!important}}
`;

function pinElement(className, discSize, inner, label, extra = "") {
    const element = document.createElement("div");
    element.className = `sf-pin ${className}`;
    element.setAttribute("aria-label", label);
    element.innerHTML =
        `${extra}<span class="sf-pin-disc" style="width:${discSize}px;height:${discSize}px">${inner}</span><span class="sf-pin-tail"></span>`;
    return element;
}

/** Green pin with the hailing-passenger glyph (pickup / passenger). */
export function createPersonPinElement(label = "Passenger location") {
    return pinElement(
        "sf-pin--green",
        34,
        hailingPersonSvg(MARKER_WHITE, 19),
        label
    );
}

/** Green pin with the active vehicle's glyph and a live pulse (driver). */
export function createDriverPinElement(vehicleType, label = "Driver live location") {
    return pinElement(
        "sf-pin--green",
        40,
        vehicleGlyphSvg(vehicleType, MARKER_WHITE, 23),
        label,
        `<span class="sf-pin-pulse"></span>`
    );
}

/** Dark slate pin with a white flag glyph (destination). */
export function createDestinationPinElement(label = "Destination") {
    return pinElement(
        "sf-pin--slate",
        32,
        flagSvg(MARKER_WHITE, 16),
        label
    );
}
