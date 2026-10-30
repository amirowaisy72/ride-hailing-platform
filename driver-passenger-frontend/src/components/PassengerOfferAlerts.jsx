"use client";

import { useLanguage } from "@/components/i18n/LanguageProvider";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, X } from "lucide-react";

import { useAuth } from "@/context/AuthContext";
import { apiRequest } from "@/lib/api";
import { getMyPurchaseOrders, getPurchaseOffers } from "@/lib/purchaseService";

// ---------------------------------------------------------------------------
// Passenger offer-arrival pill (Amir review A7, extended).
//
// Phase 1 put an "Active requests" strip on the passenger home page, so
// an offer arriving while the passenger is on another screen was
// invisible. This is the proportionate passenger counterpart to the
// driver alert layer: passengers do not need a persistent banner stack
// for work they must action — they need one lightweight nudge when a
// driver bids on THEIR request. So: a single slim floating pill per
// order whose live offer count increased, linking to that order's
// details page. Same data sources as the home strip (getMyPurchaseOrders
// + getPurchaseOffers for BIDDING orders; /parcels/my + /parcels/:id/offers
// for REQUESTED parcels, the parcel bidding state).
//
// Suppressed on the passenger home itself (the strip already shows the
// counts there) and on order details pages (the offers are on screen).
// First successful poll seeds the remembered counts silently.
// ---------------------------------------------------------------------------

const POLL_MS = 20000;
const COUNTS_KEY = "safar:passenger-offer-counts:v1";
const BD_TERMINAL = ["COMPLETED", "CANCELLED", "DELIVERED", "FAILED"];

function readCounts() {
    try {
        const raw = sessionStorage.getItem(COUNTS_KEY);
        const parsed = raw ? JSON.parse(raw) : null;
        return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
        return null;
    }
}

function writeCounts(counts) {
    try {
        sessionStorage.setItem(COUNTS_KEY, JSON.stringify(counts));
    } catch {
        /* Storage unavailable — in-memory ref still applies. */
    }
}

const liveOfferCount = (offers) =>
    (offers || []).filter(
        (offer) => !offer.expiresAt || new Date(offer.expiresAt).getTime() > Date.now()
    ).length;

export default function PassengerOfferAlerts() {
    const { t } = useLanguage();
    const { token } = useAuth();
    const pathname = usePathname();
    const [pills, setPills] = useState([]);
    const countsRef = useRef(undefined); // undefined = not seeded yet

    const onHome = pathname === "/passenger" || pathname === "/passenger/";
    const onDetails =
        pathname?.startsWith("/passenger/buy-deliver/details") ||
        pathname?.startsWith("/passenger/parcels/details");
    const suppressed = onHome || onDetails;

    const poll = useCallback(async () => {
        if (!token) return;
        if (typeof document !== "undefined" && document.visibilityState !== "visible") {
            return;
        }

        const current = {}; // key -> { count, href, kind }
        try {
            const data = await getMyPurchaseOrders(token);
            const live = (data.orders || []).filter(
                (order) => !BD_TERMINAL.includes(order.status)
            );
            for (const order of live) {
                if (order.status !== "BIDDING") continue;
                try {
                    const offersData = await getPurchaseOffers(order._id, token);
                    current[`bd:${order._id}`] = {
                        count: liveOfferCount(offersData.offers),
                        href: `/passenger/buy-deliver/details?id=${order._id}`,
                        kind: "shopping",
                    };
                } catch {
                    /* Keep this order out of this round's diff. */
                }
            }
        } catch {
            /* Buy & Deliver unavailable this round. */
        }
        try {
            const data = await apiRequest("/parcels/my", { token });
            for (const order of data.orders || []) {
                // REQUESTED is the parcel bidding state (offers land here).
                if (order.status !== "REQUESTED") continue;
                try {
                    const offerResult = await apiRequest(
                        `/parcels/${order._id}/offers`,
                        { token }
                    );
                    current[`parcel:${order._id}`] = {
                        count: (offerResult.offers || []).length,
                        href: `/passenger/parcels/details?parcelId=${order._id}`,
                        kind: "parcel",
                    };
                } catch {
                    /* Keep this order out of this round's diff. */
                }
            }
        } catch {
            /* Parcels unavailable this round. */
        }

        if (Object.keys(current).length === 0) {
            // Nothing is in a bidding state right now (or every source
            // failed this round): forget remembered counts so an order
            // that returns later re-seeds instead of alerting on stale
            // numbers. No pill can come out of an empty round.
            if (countsRef.current !== undefined && countsRef.current !== null) {
                countsRef.current = {};
                writeCounts({});
            }
            return;
        }

        if (countsRef.current === undefined) {
            countsRef.current = readCounts();
        }
        const previous = countsRef.current;

        if (previous === null) {
            // First successful poll ever (this session): seed silently.
            const seeded = {};
            for (const [key, value] of Object.entries(current)) {
                seeded[key] = value.count;
            }
            countsRef.current = seeded;
            writeCounts(seeded);
            return;
        }

        const next = { ...previous };
        const increased = [];
        for (const [key, value] of Object.entries(current)) {
            const before = previous[key];
            next[key] = value.count;
            // A brand-new key (order created after seeding) seeds at its
            // current count rather than alerting for pre-existing offers.
            if (typeof before === "number" && value.count > before) {
                increased.push({ key, delta: value.count - before, ...value });
            }
        }
        // Forget orders that left the bidding state.
        for (const key of Object.keys(next)) {
            if (!(key in current)) delete next[key];
        }
        countsRef.current = next;
        writeCounts(next);

        if (increased.length) {
            setPills((prev) => {
                const byKey = new Map(prev.map((pill) => [pill.key, pill]));
                for (const pill of increased) byKey.set(pill.key, pill);
                return [...byKey.values()];
            });
        }
    }, [token]);

    useEffect(() => {
        if (!token) return undefined;
        void poll();
        const timer = setInterval(() => void poll(), POLL_MS);
        const onVisible = () => {
            if (document.visibilityState === "visible") void poll();
        };
        document.addEventListener("visibilitychange", onVisible);
        return () => {
            clearInterval(timer);
            document.removeEventListener("visibilitychange", onVisible);
        };
    }, [token, poll]);

    if (!token || suppressed || pills.length === 0) return null;

    const dismiss = (key) =>
        setPills((prev) => prev.filter((pill) => pill.key !== key));

    return (
        <div className="fixed inset-x-0 bottom-[calc(84px+env(safe-area-inset-bottom))] z-[110] mx-auto w-full max-w-xl space-y-2 px-3">
            {pills.map((pill) => (
                <div
                    key={pill.key}
                    role="status"
                    className="flex items-center gap-2.5 rounded-full border border-pd-line bg-pd-elevated py-2 pl-3.5 pr-2 shadow-pd-lg backdrop-blur"
                >
                    <Bell size={15} className="shrink-0 text-pd-accent-text" />
                    <p className="min-w-0 flex-1 truncate text-[13px] font-bold text-pd-text">
                        {t("alerts.newOffers", { count: pill.delta, plural: pill.delta === 1 ? "" : "s", kind: t(`alerts.kind${pill.kind === "shopping" ? "Shopping" : pill.kind === "parcel" ? "Parcel" : "Ride"}`) })}
                    </p>
                    <Link
                        href={pill.href}
                        onClick={() => dismiss(pill.key)}
                        className="shrink-0 rounded-full bg-pd-accent px-3.5 py-1.5 text-[13px] font-bold text-pd-accent-ink"
                    >
                        {t("alerts.view")}
                    </Link>
                    <button
                        type="button"
                        onClick={() => dismiss(pill.key)}
                        aria-label={t("alerts.dismissOffer")}
                        className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-pd-surface-2 text-pd-muted"
                    >
                        <X size={14} />
                    </button>
                </div>
            ))}
        </div>
    );
}
