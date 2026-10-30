import {
    Bike,
    Car,
    CarFront,
    Footprints,
    Motorbike,
    Package,
    ShoppingBag,
} from "lucide-react";

// Phase 3 — shared presentation metadata for the multi-service
// platform (Phase 2 backend). The driver Home summary and the
// My Services screen both render from these definitions so the two
// surfaces can never disagree about a service's state.
//
// Verification rule (all services): every service — Rides, Parcels
// and Buy & Deliver alike — requires an approved vehicle, driving
// licence and vehicle registration. A Buy & Deliver transport mode
// only describes how the partner usually travels; it never reduces
// the verification requirements.

export const SERVICE_META = {
    RIDE: {
        label: "Passenger Rides",
        short: "Rides",
        Icon: CarFront,
        blurb: "Carry passengers and earn on every completed trip.",
    },
    PARCEL: {
        label: "Parcel Delivery",
        short: "Parcels",
        Icon: Package,
        blurb: "Deliver parcels and shop pickups for customers.",
    },
    BUY_DELIVER: {
        label: "Buy & Deliver",
        short: "Buy & Deliver",
        Icon: ShoppingBag,
        blurb: "Kharid Kar Lao — shop for customers and deliver to their door.",
    },
};

export const SERVICE_ORDER = ["RIDE", "PARCEL", "BUY_DELIVER"];

export const STATUS_META = {
    NOT_APPLIED: {
        label: "Not applied",
        pill: "bg-pd-surface-2 text-pd-text-2",
        dot: "bg-pd-faint",
    },
    INCOMPLETE: {
        label: "Incomplete",
        pill: "bg-pd-warning-soft text-pd-warning",
        dot: "bg-amber-500",
    },
    PENDING: {
        label: "Under review",
        pill: "bg-pd-warning-soft text-pd-warning",
        dot: "bg-amber-500",
    },
    UNDER_REVIEW: {
        label: "Under review",
        pill: "bg-pd-warning-soft text-pd-warning",
        dot: "bg-amber-500",
    },
    APPROVED: {
        label: "Approved",
        pill: "bg-pd-success-soft text-[#087F5B]",
        dot: "bg-[#087F5B]",
    },
    REJECTED: {
        label: "Rejected",
        pill: "bg-pd-danger-soft text-pd-danger",
        dot: "bg-red-500",
    },
    SUSPENDED: {
        label: "Suspended",
        pill: "bg-pd-danger-soft text-pd-danger",
        dot: "bg-red-500",
    },
};

export const DOCUMENT_LABELS = {
    CNIC_FRONT: "CNIC front",
    CNIC_BACK: "CNIC back",
    DRIVING_LICENSE: "Driving licence",
    VEHICLE_REGISTRATION: "Vehicle registration book",
    PROFILE_PHOTO: "Profile photo",
    INSURANCE: "Vehicle insurance",
    VEHICLE_PHOTO: "Vehicle photo",
};

export const TRANSPORT_MODES = [
    { value: "WALKING", label: "On foot", Icon: Footprints },
    { value: "BICYCLE", label: "Bicycle", Icon: Bike },
    { value: "MOTORBIKE", label: "Motorbike", Icon: Motorbike },
    { value: "CAR", label: "Car", Icon: Car },
];

export function transportModeLabel(value) {
    return (
        TRANSPORT_MODES.find((mode) => mode.value === value)?.label || null
    );
}

// Turns a raw eligibility reason from the backend into partner-facing
// copy. Reasons the requirements checklist already explains return
// null so they are never repeated.
export function humanizeReason(reason) {
    if (!reason) return null;
    if (reason.startsWith("Service status is")) return null;
    if (reason.startsWith("Missing approved documents:")) return null;
    if (reason === "Service is turned off by the driver") {
        return "You have turned this service off";
    }
    if (reason === "Transport mode not selected") {
        return "Choose how you will travel for deliveries";
    }
    if (
        reason ===
        "Purchase-handling policy has not been acknowledged"
    ) {
        return "Accept the purchase-handling & reimbursement policy";
    }
    if (reason === "Approved active vehicle required") {
        return "Select an approved vehicle";
    }
    if (reason === "Vehicle registration expired") {
        return "Your vehicle registration has expired";
    }
    return reason;
}

// Derives the specific pending actions shown on the driver Home from
// a GET /drivers/me/services payload. Only services the partner has
// applied for — or that are approved but blocked — produce actions,
// so a partner is never told to finish a service they never started.
export function pendingActionsFor(services) {
    const actions = [];

    for (const state of services || []) {
        const meta = SERVICE_META[state.service];
        if (!meta) continue;

        const started =
            state.applicationStatus !== "NOT_APPLIED" ||
            state.status === "APPROVED";
        if (!started) continue;

        const prefix = `${state.service}:`;
        const short = meta.short;

        if (state.status === "SUSPENDED") {
            actions.push({
                key: `${prefix}suspended`,
                text: `${short} suspended${state.suspensionReason ? ` — ${state.suspensionReason}` : ""}`,
                href: "/driver/services",
            });
            continue;
        }

        if (state.status === "REJECTED") {
            actions.push({
                key: `${prefix}rejected`,
                text: `${short} application rejected${state.rejectionReason ? ` — ${state.rejectionReason}` : ""}`,
                href: "/driver/services",
            });
            continue;
        }

        const reasons = state.blockedReasons || [];

        if (
            reasons.some((r) => r === "Vehicle registration expired")
        ) {
            actions.push({
                key: `${prefix}vehicle-expired`,
                text: `${short}: vehicle registration expired — renew it to keep earning`,
                href: "/driver/vehicles",
            });
        } else if (
            reasons.some((r) => r === "Approved active vehicle required")
        ) {
            actions.push({
                key: `${prefix}vehicle`,
                text: `${short}: select an approved vehicle`,
                href: "/driver/vehicles",
            });
        }

        for (const doc of (state.missingDocuments || []).slice(0, 2)) {
            const label = DOCUMENT_LABELS[doc] || doc.replaceAll("_", " ");
            actions.push({
                key: `${prefix}doc:${doc}`,
                text: `${short}: ${label.charAt(0).toLowerCase()}${label.slice(1)} pending`,
                href: "/driver/documents",
            });
        }

        if (state.service === "BUY_DELIVER") {
            if (!state.transportMode) {
                actions.push({
                    key: `${prefix}mode`,
                    text: "Buy & Deliver: choose how you will travel for deliveries",
                    href: "/driver/services",
                });
            }
            if (!state.policyAcknowledged) {
                actions.push({
                    key: `${prefix}policy`,
                    text: "Buy & Deliver: accept the purchase-handling policy",
                    href: "/driver/services",
                });
            }
        }
    }

    return actions;
}
