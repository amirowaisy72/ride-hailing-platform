"use client";

import { useEffect, useState } from "react";
import {
    Check, Clock3, ShieldCheck, X, Star,
} from "lucide-react";

const getId = (offer) => String(offer?._id || offer?.offerId || "");

const getName = (offer) => {
    const user = offer?.driverId?.userId;

    return [user?.firstName, user?.lastName]
        .filter(Boolean)
        .join(" ") || "Nearby Driver";
};

export default function LiveOfferNotifications({
    offers = [],
    onAccept,
    onReject,
    busyId = null,
}) {
    const [now, setNow] = useState(Date.now());
    const [dismissed, setDismissed] = useState({});

    useEffect(() => {
        const timer = setInterval(() => {
            setNow(Date.now());
        }, 1000);

        return () => clearInterval(timer);
    }, []);

    const active = offers
        .filter((offer) =>
            offer &&
            getId(offer) &&
            offer.status !== "REJECTED" &&
            offer.status !== "ACCEPTED" &&
            (!offer.expiresAt ||
                new Date(offer.expiresAt).getTime() > now)
        )
        .slice()
        .reverse();

    // Showing maximum three cards at once avoids screen overload.
    const visible = active
        .filter((offer) =>
            !dismissed[
            `${getId(offer)}:${offer.expiresAt || ""}`
            ]
        )
        .slice(0, 3);

    if (!visible.length) return null;

    return (
        <div
            aria-label="Driver offers"
            className="pointer-events-none absolute inset-x-3 top-[calc(80px+env(safe-area-inset-top))] z-30 mx-auto max-w-md space-y-2"
        >
            {visible.map((offer) => {
                const id = getId(offer);
                const remaining = offer.expiresAt
                    ? Math.max(
                        0,
                        Math.ceil(
                            (new Date(offer.expiresAt).getTime() - now) / 1000
                        )
                    )
                    : null;

                const rating = offer.driverId?.rating;
                const ratingCount = offer.driverId?.ratingCount;
                const key = `${id}:${offer.expiresAt || ""}`;

                return (
                    <article
                        key={key}
                        className="pointer-events-auto overflow-hidden rounded-[22px] border border-emerald-100 bg-pd-elevated p-4 shadow-2xl backdrop-blur-xl"
                    >
                        <div className="flex items-start justify-between gap-3">
                            <div className="flex items-center gap-3">
                                <div className="flex h-11 w-11 items-center justify-center rounded-full bg-pd-success-soft font-black text-[#087F5B]">
                                    {getName(offer)[0]}
                                </div>

                                <div>
                                    <p className="text-sm font-extrabold">
                                        {getName(offer)}
                                    </p>
                                    <p className="flex items-center gap-1 text-xs text-pd-muted">
                                        <ShieldCheck size={13} />
                                        New fare offer
                                    </p>
                                </div>
                            </div>

                            <button
                                type="button"
                                aria-label="Dismiss notification"
                                onClick={() =>
                                    setDismissed((prev) => ({
                                        ...prev,
                                        [key]: true,
                                    }))
                                }
                                className="rounded-lg p-2 text-pd-faint"
                            >
                                <X size={17} />
                            </button>
                        </div>

                        <div className="mt-3 flex items-center justify-between">
                            <p className="text-2xl font-black text-[#087F5B]">
                                PKR {Number(offer.price).toLocaleString("en-PK")}
                            </p>

                            <div className="text-right text-xs">
                                {rating != null && (
                                    <p className="flex items-center justify-end gap-1 font-bold">
                                        <Star size={13} className="text-amber-500" />
                                        {rating}
                                        {ratingCount != null &&
                                            ` (${ratingCount})`}
                                    </p>
                                )}

                                {remaining != null && (
                                    <p className="mt-1 flex items-center justify-end gap-1 text-pd-muted">
                                        <Clock3 size={13} />
                                        {Math.floor(remaining / 60)}:
                                        {String(remaining % 60).padStart(2, "0")}
                                    </p>
                                )}
                            </div>
                        </div>

                        <div className="mt-4 grid grid-cols-2 gap-2">
                            <button
                                type="button"
                                disabled={Boolean(busyId)}
                                onClick={() => onReject(id)}
                                className="rounded-xl border border-red-200 bg-pd-danger-soft py-3 text-sm font-bold text-pd-danger disabled:opacity-50"
                            >
                                Reject
                            </button>

                            <button
                                type="button"
                                disabled={Boolean(busyId)}
                                onClick={() => onAccept(id)}
                                className="flex items-center justify-center gap-2 rounded-xl bg-[#087F5B] py-3 text-sm font-bold text-white disabled:opacity-50"
                            >
                                <Check size={17} />
                                Accept Offer
                            </button>
                        </div>
                    </article>
                );
            })}
        </div>
    );
}
