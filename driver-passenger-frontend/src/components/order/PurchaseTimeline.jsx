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
    REQUESTED: { label: "Requested", labelUr: "درخواست دی گئی", pill: "bg-pd-warning-soft text-pd-warning" },
    BIDDING: { label: "Waiting for offers", labelUr: "آفرز کا انتظار", pill: "bg-pd-warning-soft text-pd-warning" },
    DRIVER_SELECTED: { label: "Partner selected", labelUr: "ساتھی منتخب ہو گیا", pill: "bg-sky-50 text-sky-700" },
    SHOPPING: { label: "Shopping in progress", labelUr: "خریداری جاری ہے", pill: "bg-sky-50 text-sky-700" },
    AWAITING_APPROVAL: { label: "Awaiting your approval", labelUr: "آپ کی منظوری کا انتظار", pill: "bg-orange-50 text-orange-700" },
    PURCHASE_APPROVED: { label: "Amount approved", labelUr: "رقم منظور ہو گئی", pill: "bg-pd-success-soft text-[#087F5B]" },
    PURCHASED: { label: "Items purchased", labelUr: "سامان خرید لیا گیا", pill: "bg-pd-success-soft text-[#087F5B]" },
    OUT_FOR_DELIVERY: { label: "Out for delivery", labelUr: "ڈیلیوری کے لیے نکل پڑا", pill: "bg-sky-50 text-sky-700" },
    ARRIVED: { label: "Partner arrived", labelUr: "ساتھی پہنچ گیا", pill: "bg-pd-success-soft text-[#087F5B]" },
    DELIVERED: { label: "Delivered", labelUr: "پہنچا دیا گیا", pill: "bg-pd-success-soft text-[#087F5B]" },
    COMPLETED: { label: "Completed", labelUr: "مکمل", pill: "bg-pd-success-soft text-[#087F5B]" },
    CANCELLED: { label: "Cancelled", labelUr: "منسوخ", pill: "bg-pd-danger-soft text-pd-danger" },
    FAILED: { label: "Failed", labelUr: "ناکام", pill: "bg-pd-danger-soft text-pd-danger" },
    DISPUTED: { label: "Disputed", labelUr: "تنازعہ", pill: "bg-pd-danger-soft text-pd-danger" },
};

const PURCHASE_STEPS = [
    ["REQUESTED", "Request placed", "درخواست دے دی گئی"],
    ["BIDDING", "Partner offers", "ساتھیوں کی آفرز"],
    ["DRIVER_SELECTED", "Partner selected", "ساتھی منتخب ہو گیا"],
    ["SHOPPING", "Shopping", "خریداری"],
    ["AWAITING_APPROVAL", "Your approval", "آپ کی منظوری"],
    ["PURCHASE_APPROVED", "Amount approved", "رقم منظور ہو گئی"],
    ["PURCHASED", "Items purchased", "سامان خرید لیا گیا"],
    ["OUT_FOR_DELIVERY", "Out for delivery", "ڈیلیوری کے لیے نکل پڑا"],
    ["ARRIVED", "Partner arrived", "ساتھی پہنچ گیا"],
    ["DELIVERED", "Delivered", "پہنچا دیا گیا"],
    ["COMPLETED", "Completed", "مکمل"],
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
    REQUESTED: { label: "Requested", labelUr: "درخواست دی گئی", pill: "bg-pd-warning-soft text-pd-warning" },
    PROVIDER_ACCEPTED: { label: "Accepted — pay booking fee", labelUr: "قبول ہو گئی — بکنگ فیس ادا کریں", pill: "bg-orange-50 text-orange-700" },
    PAYMENT_PENDING: { label: "Fee verification pending", labelUr: "فیس کی تصدیق باقی ہے", pill: "bg-pd-warning-soft text-pd-warning" },
    CONFIRMED: { label: "Confirmed", labelUr: "تصدیق ہو گئی", pill: "bg-pd-success-soft text-[#087F5B]" },
    PICKUP_VERIFIED: { label: "Pickup verified", labelUr: "پک اپ کی تصدیق ہو گئی", pill: "bg-sky-50 text-sky-700" },
    RENTAL_ACTIVE: { label: "Rental active", labelUr: "کرایہ جاری ہے", pill: "bg-sky-50 text-sky-700" },
    RETURN_PENDING: { label: "Return — confirm to finish", labelUr: "واپسی — ختم کرنے کے لیے تصدیق کریں", pill: "bg-orange-50 text-orange-700" },
    COMPLETED: { label: "Completed", labelUr: "مکمل", pill: "bg-pd-success-soft text-[#087F5B]" },
    CANCELLED: { label: "Cancelled", labelUr: "منسوخ", pill: "bg-pd-danger-soft text-pd-danger" },
    NO_SHOW: { label: "No show", labelUr: "نہیں آئے", pill: "bg-pd-danger-soft text-pd-danger" },
    DISPUTED: { label: "Disputed", labelUr: "تنازعہ", pill: "bg-pd-danger-soft text-pd-danger" },
};

const RENTAL_STEPS = [
    ["REQUESTED", "Booking requested", "بکنگ کی درخواست"],
    ["PROVIDER_ACCEPTED", "Provider accepted", "فراہم کنندہ نے قبول کیا"],
    ["PAYMENT_PENDING", "Booking fee", "بکنگ فیس"],
    ["CONFIRMED", "Booking confirmed", "بکنگ کی تصدیق ہو گئی"],
    ["PICKUP_VERIFIED", "Pickup verified", "پک اپ کی تصدیق ہو گئی"],
    ["RENTAL_ACTIVE", "Rental active", "کرایہ جاری ہے"],
    ["RETURN_PENDING", "Vehicle returned", "گاڑی واپس ہو گئی"],
    ["COMPLETED", "Completed", "مکمل"],
];

function isUrduUi() {
    try {
        return window.localStorage.getItem("app-language") === "ur";
    } catch {
        return false;
    }
}

function localize(meta) {
    if (!meta) return meta;
    try {
        if (window.localStorage.getItem("app-language") === "ur" && meta.labelUr) {
            return { ...meta, label: meta.labelUr };
        }
    } catch { /* SSR / storage blocked — English label */ }
    return meta;
}

export function purchaseStatusMeta(status) {
    return localize(PURCHASE_STATUS_META[status]) || {
        label: String(status || "Unknown").replaceAll("_", " "),
        pill: "bg-pd-surface-2 text-pd-text-2",
    };
}

export function rentalStatusMeta(status) {
    return localize(RENTAL_STATUS_META[status]) || {
        label: String(status || "Unknown").replaceAll("_", " "),
        pill: "bg-pd-surface-2 text-pd-text-2",
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
            <div className="flex items-center gap-2.5 rounded-2xl bg-pd-danger-soft px-4 py-3 text-sm font-bold text-pd-danger">
                <AlertTriangle size={18} className="shrink-0" aria-hidden="true" />
                {isUrduUi() ? "یہ آرڈر " : "This order is "}{isUrduUi() ? (purchaseStatusMeta(status)?.label || status) : String(status).replaceAll("_", " ").toLowerCase()}{isUrduUi() ? " ہے۔" : "."}
            </div>
        );
    }

    const current = flow.indexOf(status);

    return (
        <ol className="relative space-y-0" aria-label={isUrduUi() ? "آرڈر کی پیش رفت" : "Order progress"}>
            {steps.map(([value, labelEn, labelUr], index) => {
                const label = isUrduUi() && labelUr ? labelUr : labelEn;
                const done = current > index || status === "COMPLETED";
                const now = current === index && status !== "COMPLETED";
                const last = index === steps.length - 1;
                return (
                    <li key={value} className="relative flex gap-3 pb-3 last:pb-0">
                        {!last && (
                            <span
                                className={`absolute left-[11px] top-6 h-[calc(100%-16px)] w-0.5 rounded ${done ? "bg-[#087F5B]" : "bg-pd-surface-3"}`}
                                aria-hidden="true"
                            />
                        )}
                        <span
                            className={`relative z-10 grid h-6 w-6 shrink-0 place-items-center rounded-full text-[10px] font-extrabold ${done
                                ? "bg-[#087F5B] text-white"
                                : now
                                    ? "border-2 border-[#087F5B] bg-pd-surface text-[#087F5B]"
                                    : "border-2 border-pd-line bg-pd-surface text-pd-faint"
                                }`}
                        >
                            {done ? <Check size={13} strokeWidth={3} /> : index + 1}
                        </span>
                        <span className={`pt-0.5 text-sm ${done || now ? "font-bold text-pd-text" : "text-pd-faint"}`}>
                            {label}
                            {now && <span className="ml-2 text-[11px] font-semibold text-[#087F5B]">{isUrduUi() ? "ابھی" : "Now"}</span>}
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
