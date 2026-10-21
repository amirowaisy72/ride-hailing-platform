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
    REQUESTED: { label: "Awaiting offers", short: "Awaiting offers", tone: "warning" },
    DRIVER_ASSIGNED: { label: "Driver assigned", short: "Assigned", tone: "info" },
    DRIVER_EN_ROUTE: { label: "Driver heading to pickup", short: "To pickup", tone: "info" },
    ARRIVED_AT_PICKUP: { label: "Driver at pickup", short: "At pickup", tone: "accent" },
    PICKED_UP: { label: "Parcel picked up", short: "Picked up", tone: "accent" },
    OUT_FOR_DELIVERY: { label: "Out for delivery", short: "In transit", tone: "accent" },
    DELIVERED: { label: "Delivered", short: "Delivered", tone: "success" },
    CANCELLED: { label: "Cancelled", short: "Cancelled", tone: "danger" },
    FAILED: { label: "Delivery failed", short: "Failed", tone: "danger" },
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

export function statusMeta(status) {
    return STATUS_META[status] || {
        label: String(status || "Unknown").replaceAll("_", " ").toLowerCase(),
        short: String(status || "Unknown").replaceAll("_", " ").toLowerCase(),
        tone: "neutral",
    };
}

export function serviceLabel(serviceType) {
    return serviceType === "SHOP_PICKUP" ? "Shop Pickup" : "Send Parcel";
}

export function categoryLabel(category) {
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
