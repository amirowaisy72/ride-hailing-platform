// Realistic top-down vehicle marker for the driver's own map view.
// The sprite is a white-bodied photo; the driver's chosen paint colour
// is multiplied over it through a mask so the body takes the colour
// while windows, tyres and shading stay intact.

const SPRITES = {
    CAR: { src: "/vehicles/car-top.png", w: 26, h: 53 },
    BIKE: { src: "/vehicles/bike-top.png", w: 18, h: 39 },
    RICKSHAW: { src: "/vehicles/rickshaw-top.png", w: 25, h: 44 },
};

const COLOR_NAMES = {
    white: "#F4F5F2", pearl: "#EEF0EA", black: "#26282D", grey: "#8A8F96",
    gray: "#8A8F96", silver: "#B9BEC4", red: "#C8312E", maroon: "#7A1F24",
    blue: "#2C5FB8", navy: "#22345E", green: "#1E7A4C", yellow: "#E2B528",
    orange: "#E0732A", brown: "#6E4A33", gold: "#C9A24A", beige: "#D9C9A8",
    purple: "#6A3F94", pink: "#D9748E",
};

export function normalizeVehicleType(type) {
    const value = String(type || "").toUpperCase();
    if (value === "BIKE" || value === "MOTORCYCLE") return "BIKE";
    if (value === "RICKSHAW") return "RICKSHAW";
    return "CAR";
}

export function vehicleColorHex(color) {
    if (!color) return COLOR_NAMES.white;
    const raw = String(color).trim();
    if (/^#[0-9a-f]{3,8}$/i.test(raw)) return raw;
    const lower = raw.toLowerCase();
    const match = Object.keys(COLOR_NAMES).find((name) => lower.includes(name));
    return match ? COLOR_NAMES[match] : COLOR_NAMES.white;
}

export function isNightTime(theme, date = new Date()) {
    const hour = date.getHours();
    return theme === "dark" || hour >= 19 || hour < 6;
}

function innerMarkup(type, color) {
    const kind = normalizeVehicleType(type);
    const sprite = SPRITES[kind];
    const hex = vehicleColorHex(color);
    const tint = hex.toLowerCase() === COLOR_NAMES.white.toLowerCase()
        ? ""
        : `<span class="sf-veh-tint" style="background:${hex};-webkit-mask-image:url(${sprite.src});mask-image:url(${sprite.src})"></span>`;
    return {
        kind,
        sprite,
        html:
            `<span class="sf-veh-locator"></span>` +
            `<span class="sf-veh-rotor">` +
            `<span class="sf-veh-beam"></span>` +
            `<span class="sf-veh-shadow"></span>` +
            `<span class="sf-veh-sprite"><img src="${sprite.src}" alt="" draggable="false" />${tint}</span>` +
            `<span class="sf-veh-lamp sf-veh-lamp--l"></span><span class="sf-veh-lamp sf-veh-lamp--r"></span>` +
            `<span class="sf-veh-tail sf-veh-tail--l"></span><span class="sf-veh-tail sf-veh-tail--r"></span>` +
            `</span>`,
    };
}

export function createVehicleElement(type, color, night) {
    const element = document.createElement("div");
    element.setAttribute("aria-label", "Your vehicle");
    updateVehicleElement(element, type, color, night);
    return element;
}

export function updateVehicleElement(element, type, color, night) {
    const { kind, sprite, html } = innerMarkup(type, color);
    element.className = `sf-veh sf-veh--${kind.toLowerCase()}${night ? " is-night" : ""}`;
    element.style.setProperty("--veh-w", `${sprite.w}px`);
    element.style.setProperty("--veh-h", `${sprite.h}px`);
    element.innerHTML = html;
}

export function setVehicleNight(element, night) {
    element?.classList.toggle("is-night", Boolean(night));
}
