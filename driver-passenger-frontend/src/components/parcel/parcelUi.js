// Pure helpers shared by Passenger + Driver parcel screens (no React).

export const PARCEL_FLOW = [
    "REQUESTED",
    "DRIVER_ASSIGNED",
    "DRIVER_EN_ROUTE",
    "ARRIVED_AT_PICKUP",
    "PICKED_UP",
    "OUT_FOR_DELIVERY",
    "DELIVERED",
];

export const TERMINAL_STATUSES = ["DELIVERED", "CANCELLED", "FAILED"];

// tone -> token family used by ParcelStatusBadge
export const STATUS_META = {
    REQUESTED: { label: "Awaiting offers", labelUr: "آفرز کا انتظار", short: "Awaiting offers", shortUr: "انتظار", tone: "warning" },
    DRIVER_ASSIGNED: { label: "Driver assigned", labelUr: "ڈرائیور منتخب ہو گیا", short: "Assigned", shortUr: "منتخب", tone: "info" },
    DRIVER_EN_ROUTE: { label: "Driver heading to pickup", labelUr: "ڈرائیور پک اپ کی طرف آ رہا ہے", short: "To pickup", shortUr: "راستے میں", tone: "info" },
    ARRIVED_AT_PICKUP: { label: "Driver at pickup", labelUr: "ڈرائیور پک اپ پر پہنچ گیا", short: "At pickup", shortUr: "پک اپ پر", tone: "accent" },
    PICKED_UP: { label: "Parcel picked up", labelUr: "پارسل اٹھا لیا گیا", short: "Picked up", shortUr: "اٹھا لیا", tone: "accent" },
    OUT_FOR_DELIVERY: { label: "Out for delivery", labelUr: "ڈیلیوری کے لیے نکل پڑا", short: "In transit", shortUr: "راستے میں", tone: "accent" },
    DELIVERED: { label: "Delivered", labelUr: "پہنچا دیا گیا", short: "Delivered", shortUr: "پہنچ گیا", tone: "success" },
    CANCELLED: { label: "Cancelled", labelUr: "منسوخ", short: "Cancelled", shortUr: "منسوخ", tone: "danger" },
    FAILED: { label: "Delivery failed", labelUr: "ڈیلیوری ناکام", short: "Failed", shortUr: "ناکام", tone: "danger" },
};

export const TIMELINE_STEPS = [
    ["REQUESTED", "Requested"],
    ["DRIVER_ASSIGNED", "Driver assigned"],
    ["DRIVER_EN_ROUTE", "Heading to pickup"],
    ["ARRIVED_AT_PICKUP", "Arrived at pickup"],
    ["PICKED_UP", "Parcel picked up"],
    ["OUT_FOR_DELIVERY", "Out for delivery"],
    ["DELIVERED", "Delivered"],
];

export const CATEGORY_LABELS = {
    DOCUMENTS: "Documents",
    FOOD: "Food",
    CLOTHES: "Clothes",
    ELECTRONICS: "Electronics",
    OTHER: "Other",
};

export const VEHICLE_LABELS = {
    BIKE: "Motorcycle",
    RICKSHAW: "Rickshaw",
    CAR_NON_AC: "Car Non-AC",
    CAR_AC: "Car AC",
};

export const VEHICLE_LABELS_UR = {
    BIKE: "موٹر سائیکل",
    RICKSHAW: "رکشہ",
    CAR_NON_AC: "کار بغیر AC",
    CAR_AC: "کار AC",
};

const CATEGORY_LABELS_UR = {
    DOCUMENTS: "دستاویزات",
    FOOD: "کھانا",
    CLOTHES: "کپڑے",
    ELECTRONICS: "الیکٹرانکس",
    GROCERY: "راشن",
    MEDICINE: "ادویات",
    FRAGILE: "نازک سامان",
    OTHER: "دیگر",
};

function isUrduUi() {
    try {
        return window.localStorage.getItem("app-language") === "ur";
    } catch {
        return false;
    }
}

export function vehicleLabel(vehicleType) {
    if (isUrduUi()) return VEHICLE_LABELS_UR[vehicleType] || VEHICLE_LABELS[vehicleType] || vehicleType;
    return VEHICLE_LABELS[vehicleType] || vehicleType;
}

export function statusMeta(status) {
    const meta = STATUS_META[status];
    if (meta) {
        try {
            if (window.localStorage.getItem("app-language") === "ur") {
                return {
                    ...meta,
                    label: meta.labelUr || meta.label,
                    short: meta.shortUr || meta.short,
                };
            }
        } catch { /* SSR / storage blocked — English label */ }
        return meta;
    }
    return {
        label: String(status || "Unknown").replaceAll("_", " ").toLowerCase(),
        short: String(status || "Unknown").replaceAll("_", " ").toLowerCase(),
        tone: "neutral",
    };
}

export function serviceLabel(serviceType) {
    if (isUrduUi()) return serviceType === "SHOP_PICKUP" ? "دکان سے اٹھانا" : "پارسل بھیجیں";
    return serviceType === "SHOP_PICKUP" ? "Shop Pickup" : "Send Parcel";
}

export function categoryLabel(category) {
    if (isUrduUi()) return CATEGORY_LABELS_UR[category] || CATEGORY_LABELS[category] || "پارسل";
    return CATEGORY_LABELS[category] || (category ? String(category).replaceAll("_", " ") : "Parcel");
}

export function formatPKR(value) {
    const amount = Number(value);
    if (!Number.isFinite(amount)) return "PKR —";
    return `PKR ${amount.toLocaleString("en-PK", { maximumFractionDigits: 0 })}`;
}

export function orderPrice(order) {
    return order?.finalPrice ?? order?.requestedPrice;
}

/** 0..1 progress along the happy-path lifecycle. */
export function statusProgress(status) {
    const index = PARCEL_FLOW.indexOf(status);
    if (index < 0) return 0;
    return index / (PARCEL_FLOW.length - 1);
}

export function isActive(order) {
    return Boolean(order) && !TERMINAL_STATUSES.includes(order.status);
}

export function shortAddress(address, fallback) {
    if (!address || typeof address !== "string") return fallback;
    const parts = address.split(",").map((p) => p.trim()).filter(Boolean);
    return parts.slice(0, 2).join(", ") || fallback;
}

export function formatWhen(value) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function playNotificationSound(volume = 0.5) {
    if (typeof Audio === "undefined") return;
    try {
        const audio = new Audio("/sounds/notification.mp3");
        audio.volume = volume;
        audio.play().catch(() => { });
    } catch {
        // Audio unavailable; visual notification is still shown.
    }
}
