"use client";

import { AlertTriangle, Check } from "lucide-react";

// Phase 6 — shared status presentation for Buy & Deliver purchases
// and Safar Rentals bookings: labels, pills and vertical steppers.
// The main happy-path lives on the stepper; terminal off-path states
// (CANCELLED / FAILED / DISPUTED / NO_SHOW) render as a banner badge
// so a cancelled order never looks "stuck" mid-flow.

export const PURCHASE_FLOW = [
    "REQUESTED",
    "BIDDING",
    "DRIVER_SELECTED",
    "SHOPPING",
    "AWAITING_APPROVAL",
    "PURCHASE_APPROVED",
    "PURCHASED",
    "OUT_FOR_DELIVERY",
    "ARRIVED",
    "DELIVERED",
    "COMPLETED",
];

export const PURCHASE_STATUS_META = {
    REQUESTED: { label: "Requested", pill: "bg-amber-50 text-amber-700" },
    BIDDING: { label: "Waiting for offers", pill: "bg-amber-50 text-amber-700" },
    DRIVER_SELECTED: { label: "Partner selected", pill: "bg-sky-50 text-sky-700" },
    SHOPPING: { label: "Shopping in progress", pill: "bg-sky-50 text-sky-700" },
    AWAITING_APPROVAL: { label: "Awaiting your approval", pill: "bg-orange-50 text-orange-700" },
    PURCHASE_APPROVED: { label: "Amount approved", pill: "bg-emerald-50 text-[#087F5B]" },
    PURCHASED: { label: "Items purchased", pill: "bg-emerald-50 text-[#087F5B]" },
    OUT_FOR_DELIVERY: { label: "Out for delivery", pill: "bg-sky-50 text-sky-700" },
    ARRIVED: { label: "Partner arrived", pill: "bg-emerald-50 text-[#087F5B]" },
    DELIVERED: { label: "Delivered", pill: "bg-emerald-50 text-[#087F5B]" },
    COMPLETED: { label: "Completed", pill: "bg-emerald-50 text-[#087F5B]" },
    CANCELLED: { label: "Cancelled", pill: "bg-red-50 text-red-600" },
    FAILED: { label: "Failed", pill: "bg-red-50 text-red-600" },
    DISPUTED: { label: "Disputed", pill: "bg-red-50 text-red-600" },
};

const PURCHASE_STEPS = [
    ["REQUESTED", "Request placed"],
    ["BIDDING", "Partner offers"],
    ["DRIVER_SELECTED", "Partner selected"],
    ["SHOPPING", "Shopping"],
    ["AWAITING_APPROVAL", "Your approval"],
    ["PURCHASE_APPROVED", "Amount approved"],
    ["PURCHASED", "Items purchased"],
    ["OUT_FOR_DELIVERY", "Out for delivery"],
    ["ARRIVED", "Partner arrived"],
    ["DELIVERED", "Delivered"],
    ["COMPLETED", "Completed"],
];

export const RENTAL_FLOW = [
    "REQUESTED",
    "PROVIDER_ACCEPTED",
    "PAYMENT_PENDING",
    "CONFIRMED",
    "PICKUP_VERIFIED",
    "RENTAL_ACTIVE",
    "RETURN_PENDING",
    "COMPLETED",
];

export const RENTAL_STATUS_META = {
    REQUESTED: { label: "Requested", pill: "bg-amber-50 text-amber-700" },
    PROVIDER_ACCEPTED: { label: "Accepted — pay booking fee", pill: "bg-orange-50 text-orange-700" },
    PAYMENT_PENDING: { label: "Fee verification pending", pill: "bg-amber-50 text-amber-700" },
    CONFIRMED: { label: "Confirmed", pill: "bg-emerald-50 text-[#087F5B]" },
    PICKUP_VERIFIED: { label: "Pickup verified", pill: "bg-sky-50 text-sky-700" },
    RENTAL_ACTIVE: { label: "Rental active", pill: "bg-sky-50 text-sky-700" },
    RETURN_PENDING: { label: "Return — confirm to finish", pill: "bg-orange-50 text-orange-700" },
    COMPLETED: { label: "Completed", pill: "bg-emerald-50 text-[#087F5B]" },
    CANCELLED: { label: "Cancelled", pill: "bg-red-50 text-red-600" },
    NO_SHOW: { label: "No show", pill: "bg-red-50 text-red-600" },
    DISPUTED: { label: "Disputed", pill: "bg-red-50 text-red-600" },
};

const RENTAL_STEPS = [
    ["REQUESTED", "Booking requested"],
    ["PROVIDER_ACCEPTED", "Provider accepted"],
    ["PAYMENT_PENDING", "Booking fee"],
    ["CONFIRMED", "Booking confirmed"],
    ["PICKUP_VERIFIED", "Pickup verified"],
    ["RENTAL_ACTIVE", "Rental active"],
    ["RETURN_PENDING", "Vehicle returned"],
    ["COMPLETED", "Completed"],
];

export function purchaseStatusMeta(status) {
    return PURCHASE_STATUS_META[status] || {
        label: String(status || "Unknown").replaceAll("_", " "),
        pill: "bg-slate-100 text-slate-600",
    };
}

export function rentalStatusMeta(status) {
    return RENTAL_STATUS_META[status] || {
        label: String(status || "Unknown").replaceAll("_", " "),
        pill: "bg-slate-100 text-slate-600",
    };
}

export function StatusPill({ meta }) {
    if (!meta) return null;
    return (
        <span className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-[11px] font-extrabold ${meta.pill}`}>
            {meta.label}
        </span>
    );
}

function Stepper({ status, flow, steps, offPath }) {
    if (offPath.includes(status)) {
        return (
            <div className="flex items-center gap-2.5 rounded-2xl bg-red-50 px-4 py-3 text-sm font-bold text-red-700">
                <AlertTriangle size={18} className="shrink-0" aria-hidden="true" />
                This order is {String(status).replaceAll("_", " ").toLowerCase()}.
            </div>
        );
    }

    const current = flow.indexOf(status);

    return (
        <ol className="relative space-y-0" aria-label="Order progress">
            {steps.map(([value, label], index) => {
                const done = current > index || status === "COMPLETED";
                const now = current === index && status !== "COMPLETED";
                const last = index === steps.length - 1;
                return (
                    <li key={value} className="relative flex gap-3 pb-3 last:pb-0">
                        {!last && (
                            <span
                                className={`absolute left-[11px] top-6 h-[calc(100%-16px)] w-0.5 rounded ${done ? "bg-[#087F5B]" : "bg-slate-200"}`}
                                aria-hidden="true"
                            />
                        )}
                        <span
                            className={`relative z-10 grid h-6 w-6 shrink-0 place-items-center rounded-full text-[10px] font-extrabold ${done
                                ? "bg-[#087F5B] text-white"
                                : now
                                    ? "border-2 border-[#087F5B] bg-white text-[#087F5B]"
                                    : "border-2 border-slate-200 bg-white text-slate-400"
                                }`}
                        >
                            {done ? <Check size={13} strokeWidth={3} /> : index + 1}
                        </span>
                        <span className={`pt-0.5 text-sm ${done || now ? "font-bold text-slate-900" : "text-slate-400"}`}>
                            {label}
                            {now && <span className="ml-2 text-[11px] font-semibold text-[#087F5B]">Now</span>}
                        </span>
                    </li>
                );
            })}
        </ol>
    );
}

export default function PurchaseTimeline({ status }) {
    return (
        <Stepper
            status={status}
            flow={PURCHASE_FLOW}
            steps={PURCHASE_STEPS}
            offPath={["CANCELLED", "FAILED", "DISPUTED"]}
        />
    );
}

export function RentalTimeline({ status }) {
    return (
        <Stepper
            status={status}
            flow={RENTAL_FLOW}
            steps={RENTAL_STEPS}
            offPath={["CANCELLED", "NO_SHOW", "DISPUTED"]}
        />
    );
}
