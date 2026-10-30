"use client";

import {
    ArrowLeftRight,
    ArrowRight,
    BadgeCheck,
    Banknote,
    Info,
    KeyRound,
    Landmark,
    PackageCheck,
    ReceiptText,
    RotateCcw,
    TrendingUp,
} from "lucide-react";

// Phase 6 — read-only rendering of a structured EVENT chat message.
// Chat NEVER edits amounts: these cards are snapshots written by the
// order REST APIs (offer, estimate, approval, handover...). Any
// action (approve, pay, confirm) happens on the order screen itself.

export const EVENT_META = {
    OFFER: { title: "Delivery fee offer", Icon: Banknote },
    ESTIMATE: { title: "Shopping cost estimate", Icon: ReceiptText },
    PRICE_INCREASE: { title: "Price increase requested", Icon: TrendingUp },
    APPROVAL: { title: "Purchase amount decision", Icon: BadgeCheck },
    SUBSTITUTION: { title: "Item substitution", Icon: ArrowLeftRight },
    PURCHASE_CONFIRMATION: { title: "Purchase confirmed", Icon: PackageCheck },
    BOOKING_FEE: { title: "Booking fee", Icon: Landmark },
    HANDOVER: { title: "Vehicle handover", Icon: KeyRound },
    RETURN: { title: "Vehicle return", Icon: RotateCcw },
    STATUS: { title: "Status update", Icon: Info },
};

export function formatPKR(value) {
    const amount = Number(value);
    if (!Number.isFinite(amount)) return null;
    return `PKR ${Math.round(amount).toLocaleString("en-PK")}`;
}

function statusLabel(status) {
    return String(status || "").replaceAll("_", " ").toLowerCase();
}

export default function StructuredEventCard({ message }) {
    const event = message?.event || {};
    const eventType = message?.eventType || event.type || "STATUS";
    const meta = EVENT_META[eventType] || EVENT_META.STATUS;
    const Icon = meta.Icon;
    const amount = event.amount ?? message?.amount;
    const amountText = amount !== null && amount !== undefined ? formatPKR(amount) : null;
    const note = event.note || message?.body || "";
    const createdAt = event.createdAt || message?.createdAt;

    return (
        <div className="flex justify-center px-2">
            <div className="w-full max-w-[86%] rounded-[20px] border border-pd-line bg-pd-surface px-4 py-3 shadow-sm">
                <div className="flex items-center gap-2.5">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-pd-success-soft text-[#087F5B]">
                        <Icon size={17} aria-hidden="true" />
                    </span>
                    <p className="min-w-0 flex-1 text-[13px] font-extrabold leading-tight text-pd-text">
                        {meta.title}
                    </p>
                    {amountText && (
                        <span className="shrink-0 rounded-full bg-pd-ink px-2.5 py-1 text-[12px] font-extrabold text-pd-ink-text">
                            {amountText}
                        </span>
                    )}
                </div>

                {eventType === "STATUS" && (event.fromStatus || event.toStatus) && (
                    <p className="mt-2 flex items-center gap-1.5 text-xs font-semibold capitalize text-pd-text-2">
                        <span>{statusLabel(event.fromStatus) || "—"}</span>
                        <ArrowRight size={13} className="shrink-0 text-pd-faint" aria-hidden="true" />
                        <span>{statusLabel(event.toStatus) || "—"}</span>
                    </p>
                )}

                {note ? (
                    <p className="mt-1.5 whitespace-pre-wrap break-words text-[13px] leading-relaxed text-pd-text-2">
                        {note}
                    </p>
                ) : null}

                {createdAt && (
                    <p className="mt-1.5 text-right text-[10px] font-medium text-pd-faint">
                        {new Date(createdAt).toLocaleString([], {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                        })}
                    </p>
                )}
            </div>
        </div>
    );
}
