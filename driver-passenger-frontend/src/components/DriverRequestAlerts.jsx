"use client";

import { useLanguage, storedLanguage } from "@/components/i18n/LanguageProvider";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, CarFront, KeyRound, Package, ShoppingBag } from "lucide-react";

import { useAuth } from "@/context/AuthContext";
import { useActionDialog } from "@/components/ActionDialog";
import { apiRequest } from "@/lib/api";
import { getAvailablePurchaseRequests } from "@/lib/purchaseService";
import { getPartnerRentalBookings } from "@/lib/rentalService";
import { placeLabel } from "@/lib/rideDisplay";
import { categoryLabel } from "@/components/parcel/parcelUi";

// ---------------------------------------------------------------------------
// Driver global request popups (Amir review A6; popup behaviour
// rebuilt in the Amir-test fix round, T-9).
//
// Mounted once by src/app/driver/layout.js, so it watches for new work
// on EVERY driver screen — not just Home / Tasks.
//
// Why polling, not sockets: a socket event can announce a request this
// driver may not actually be eligible for (stale GPS, offline, wrong
// service). Polling reuses the exact eligibility-gated available feeds
// the Tasks page uses (/drivers/me/available-rides, /parcels/available,
// getAvailablePurchaseRequests, getPartnerRentalBookings), so a popup
// can only ever announce a request the driver can actually take. Feed
// failures — 403 GPS_STALE included — are swallowed silently.
//
// T-9 behaviour (Amir's spec):
//  * Every pending request gets a proper modal popup, on any page.
//  * Pending requests are re-fetched on app load / refresh and the
//    popups are shown again — nothing is silently seeded away.
//  * A popup leaves ONLY when (a) the request itself leaves the feeds
//    (taken by someone, cancelled, expired), (b) the driver taps View
//    and goes to handle it (it stays listed on its own screen), or
//    (c) the driver explicitly chooses "Miss this request" — which
//    first shows a warning that missing it means losing the ride /
//    request. There is no passive X-dismiss.
// ---------------------------------------------------------------------------

const POLL_MS = 20000;
const DISMISSED_KEY = "safar:driver-alert-dismissed:v2";
const VIEWED_KEY = "safar:driver-alert-viewed:v2";

const SERVICE_META = {
    RIDE: { labelKey: "alerts.newRide", Icon: CarFront },
    PARCEL: { labelKey: "alerts.newParcel", Icon: Package },
    BUY_DELIVER: { labelKey: "alerts.newBd", Icon: ShoppingBag },
    RENTAL: { labelKey: "alerts.newRental", Icon: KeyRound },
};

function readSet(key) {
    try {
        const raw = sessionStorage.getItem(key);
        const list = raw ? JSON.parse(raw) : [];
        return new Set(Array.isArray(list) ? list.map(String) : []);
    } catch {
        return new Set();
    }
}

function writeSet(key, set) {
    try {
        sessionStorage.setItem(key, JSON.stringify([...set]));
    } catch {
        /* Storage unavailable (private mode) — in-memory set still works. */
    }
}

const firstLine = (text) =>
    String(text || "").split("\n").map((line) => line.trim()).find(Boolean) || "";

const fmtDay = (value) =>
    value
        ? new Date(value).toLocaleDateString("en-PK", {
              day: "numeric",
              month: "short",
          })
        : "";

function rideAlert(ride) {
    const id = String(ride._id || ride.rideId || "");
    if (!id) return null;
    const from = placeLabel(ride.pickup, storedLanguage() === "ur" ? "اٹھانے کی جگہ" : "Pickup");
    const to = placeLabel(ride.destination, storedLanguage() === "ur" ? "منزل" : "Destination");
    return {
        key: `RIDE:${id}`,
        service: "RIDE",
        summary: `${from} → ${to}`,
        // Ride offers are actioned on the driver home surface.
        href: "/driver",
    };
}

function parcelAlert(order) {
    const id = String(order._id || "");
    if (!id) return null;
    const from = order.pickup?.address || order.pickup?.name || "";
    const to = order.destination?.address || order.destination?.name || "";
    return {
        key: `PARCEL:${id}`,
        service: "PARCEL",
        summary:
            from || to
                ? `${from || (storedLanguage() === "ur" ? "اٹھانے کی جگہ" : "Pickup")} → ${to || (storedLanguage() === "ur" ? "پہنچانے کی جگہ" : "Drop-off")}`
                : categoryLabel(order.parcel?.category),
        // T-8 fix: this feed is UNASSIGNED requests. The old href sent
        // the driver to the assigned-only execution screen, which
        // 404s ("Assigned parcel not found") for anything not yet
        // accepted. The parcels screen is where unassigned requests
        // are viewed and offered on.
        href: "/driver/parcels",
    };
}

function purchaseAlert(order) {
    const id = String(order._id || "");
    if (!id) return null;
    return {
        key: `BUY_DELIVER:${id}`,
        service: "BUY_DELIVER",
        summary: firstLine(order.itemsText) || (storedLanguage() === "ur" ? "خریداری کی درخواست" : "Shopping request"),
        // T-12 fix: same defect as T-8 — unassigned BIDDING orders
        // were linked into the assigned-only details screen
        // ("Assigned purchase order not found"). New Buy & Deliver
        // requests are handled on the Tasks screen.
        href: "/driver/tasks",
    };
}

function rentalAlert(booking) {
    // Only a fresh REQUESTED booking is a new arrival; later statuses
    // are work already in hand, not something to announce.
    if (booking.status !== "REQUESTED") return null;
    const id = String(booking._id || "");
    if (!id) return null;
    const vehicle = booking.vehicle
        ? `${booking.vehicle.brand || ""} ${booking.vehicle.model || ""}`.trim()
        : "";
    const dates = [fmtDay(booking.startAt), fmtDay(booking.endAt)]
        .filter(Boolean)
        .join(" → ");
    return {
        key: `RENTAL:${id}`,
        service: "RENTAL",
        summary: [vehicle || (storedLanguage() === "ur" ? "کرائے کی گاڑی" : "Rental vehicle"), dates].filter(Boolean).join(" · "),
        // Rental bookings are addressed to THIS partner, so the
        // partner booking screen is the right (and permitted) target.
        href: `/driver/rentals/bookings/details?id=${id}`,
    };
}

export default function DriverRequestAlerts() {
    const { t } = useLanguage();
    const { token } = useAuth();
    const dialog = useActionDialog();
    const pathname = usePathname();
    const [pending, setPending] = useState([]);
    const dismissedRef = useRef(null);
    const viewedRef = useRef(null);
    const [, setSessionTick] = useState(0);
    const firstPollDoneRef = useRef(false);
    const knownKeysRef = useRef(new Set());
    const audioRef = useRef(null);
    const audioArmedRef = useRef(false);

    if (dismissedRef.current === null) {
        // Lazy one-time init (client only — this component never SSRs
        // meaningfully because it renders nothing without a token).
        dismissedRef.current = typeof window !== "undefined" ? readSet(DISMISSED_KEY) : new Set();
        viewedRef.current = typeof window !== "undefined" ? readSet(VIEWED_KEY) : new Set();
    }

    // Sound: the AudioContext is created/resumed lazily and only after
    // the first user interaction, per autoplay policies. Fail silently.
    useEffect(() => {
        if (typeof window === "undefined") return undefined;
        const arm = () => {
            try {
                if (!audioRef.current) {
                    const Ctor =
                        window.AudioContext || window.webkitAudioContext;
                    if (Ctor) audioRef.current = new Ctor();
                }
                if (audioRef.current?.state === "suspended") {
                    void audioRef.current.resume();
                }
                audioArmedRef.current = Boolean(audioRef.current);
            } catch {
                audioArmedRef.current = false;
            }
        };
        window.addEventListener("pointerdown", arm, { passive: true });
        return () => window.removeEventListener("pointerdown", arm);
    }, []);

    const beep = useCallback(() => {
        if (!audioArmedRef.current || !audioRef.current) return;
        try {
            const ctx = audioRef.current;
            if (ctx.state === "suspended") void ctx.resume();
            const play = (frequency, startOffset, duration) => {
                const oscillator = ctx.createOscillator();
                const gain = ctx.createGain();
                const start = ctx.currentTime + startOffset;
                oscillator.type = "sine";
                oscillator.frequency.value = frequency;
                gain.gain.setValueAtTime(0.0001, start);
                gain.gain.exponentialRampToValueAtTime(0.18, start + 0.02);
                gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
                oscillator.connect(gain).connect(ctx.destination);
                oscillator.start(start);
                oscillator.stop(start + duration + 0.02);
            };
            // Short two-tone cue.
            play(880, 0, 0.14);
            play(1318, 0.16, 0.18);
        } catch {
            /* Audio unavailable — the popup still shows. */
        }
    }, []);

    const poll = useCallback(async () => {
        if (!token) return;
        if (typeof document !== "undefined" && document.visibilityState !== "visible") {
            return;
        }

        // Eligibility gate: only alert while the driver is online and
        // available. A failed status read falls through to the feeds
        // themselves, which are eligibility-gated on the server anyway.
        try {
            const status = await apiRequest("/drivers/me/status", { token });
            const driver = status?.driver || {};
            if (status?.driver && !(driver.isOnline && driver.isAvailable)) {
                setPending([]);
                return;
            }
        } catch {
            /* Status unreachable — let the gated feeds decide. */
        }

        const [rides, parcels, purchases, rentals] = await Promise.allSettled([
            apiRequest("/drivers/me/available-rides", { token }),
            apiRequest("/parcels/available", { token }),
            getAvailablePurchaseRequests(token),
            getPartnerRentalBookings(token),
        ]);

        // If every feed failed (offline, GPS_STALE 403s, not a rental
        // partner...) there is nothing trustworthy to show — keep the
        // previous state rather than flashing popups away.
        const anySuccess = [rides, parcels, purchases, rentals].some(
            (result) => result.status === "fulfilled"
        );
        if (!anySuccess) return;

        const fresh = [];
        if (rides.status === "fulfilled") {
            fresh.push(...(rides.value.rides || []).map(rideAlert).filter(Boolean));
        }
        if (parcels.status === "fulfilled") {
            fresh.push(...(parcels.value.orders || []).map(parcelAlert).filter(Boolean));
        }
        if (purchases.status === "fulfilled") {
            const orders = purchases.value.orders || purchases.value.requests || [];
            fresh.push(...orders.map(purchaseAlert).filter(Boolean));
        }
        if (rentals.status === "fulfilled") {
            fresh.push(
                ...(rentals.value.bookings || []).map(rentalAlert).filter(Boolean)
            );
        }

        // T-9: beep only for requests that arrive AFTER the first
        // poll of the session. The first poll (app open / refresh)
        // re-shows everything pending — silently, so reopening the
        // app is not a siren — but it DOES show them.
        const arrivals = fresh.filter((item) => !knownKeysRef.current.has(item.key));
        if (firstPollDoneRef.current && arrivals.length) beep();
        for (const item of fresh) knownKeysRef.current.add(item.key);
        firstPollDoneRef.current = true;

        setPending(fresh);
    }, [token, beep]);

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

    if (!token) return null;

    const dismissed = dismissedRef.current;
    const viewed = viewedRef.current;
    // On driver home, ride requests already get that screen's own
    // full-screen offer overlay — the global popup would double up.
    // Other services still pop up there; rides pop up everywhere else.
    const actionable = pending.filter(
        (item) =>
            !dismissed.has(item.key) &&
            !(pathname === "/driver" && item.service === "RIDE")
    );
    const queue = actionable.filter((item) => !viewed.has(item.key));
    const current = queue[0] || null;

    const markViewed = (key) => {
        viewed.add(key);
        writeSet(VIEWED_KEY, viewed);
        setSessionTick((n) => n + 1);
    };

    const missRequest = async (item) => {
        // The ONLY way a popup is dismissed (T-9): an explicit choice,
        // preceded by the warning that missing it means losing it.
        const confirmed = await dialog.confirm({
            title: t("alerts.missWarningTitle"),
            message: t("alerts.missWarningBody"),
            confirmLabel: t("alerts.yesMiss"),
            cancelLabel: t("alerts.keepWaiting"),
            danger: true,
        });
        if (!confirmed) return;
        dismissed.add(item.key);
        writeSet(DISMISSED_KEY, dismissed);
        setSessionTick((n) => n + 1);
    };

    if (!current) {
        // Nothing left to pop up. If work is still pending but the
        // driver already viewed it, keep a slim reminder chip that
        // reopens the popups — pending work is never hidden away.
        if (actionable.length === 0) return null;
        return (
            <div className="pointer-events-none fixed inset-x-0 top-[max(10px,env(safe-area-inset-top))] z-[120] mx-auto w-full max-w-xl px-3">
                <div className="flex justify-center">
                    <button
                        type="button"
                        onClick={() => {
                            viewed.clear();
                            writeSet(VIEWED_KEY, viewed);
                            setSessionTick((n) => n + 1);
                        }}
                        className="pointer-events-auto inline-flex items-center gap-1.5 rounded-full bg-pd-ink px-3 py-1.5 text-xs font-extrabold text-pd-ink-text shadow-pd-lg"
                    >
                        <Bell size={13} />
                        {t("dHome.newRequests", { count: actionable.length, plural: actionable.length === 1 ? "" : "s" })}
                    </button>
                </div>
            </div>
        );
    }

    const { labelKey, Icon } = SERVICE_META[current.service];
    const label = t(labelKey);

    return (
        <div
            className="fixed inset-0 z-[130] flex items-end justify-center bg-black/45 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:items-center"
            role="alertdialog"
            aria-modal="true"
            aria-label={label}
        >
            <div className="pd-rise w-full max-w-md rounded-[24px] border border-pd-line bg-pd-elevated p-5 shadow-pd-lg">
                <div className="flex items-start gap-3">
                    <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-pd-accent-soft text-pd-accent-text">
                        <Icon size={22} />
                    </span>
                    <span className="min-w-0 flex-1">
                        <span className="block text-base font-extrabold text-pd-text">
                            {label}
                        </span>
                        <span className="mt-0.5 block text-sm leading-snug text-pd-muted">
                            {current.summary}
                        </span>
                    </span>
                    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-pd-ink px-2.5 py-1 text-[11px] font-extrabold text-pd-ink-text">
                        <Bell size={11} />
                        {actionable.length}
                    </span>
                </div>

                {queue.length > 1 && (
                    <p className="mt-3 text-xs font-semibold text-pd-muted">
                        {t("alerts.moreWaiting", { count: queue.length - 1, plural: queue.length - 1 === 1 ? "" : "s" })}
                    </p>
                )}

                <div className="mt-4 flex gap-2">
                    <Link
                        href={current.href}
                        onClick={() => markViewed(current.key)}
                        className="flex h-12 flex-1 items-center justify-center rounded-xl bg-pd-accent text-sm font-extrabold text-pd-accent-ink"
                    >
                        {t("alerts.view")}
                    </Link>
                    <button
                        type="button"
                        onClick={() => void missRequest(current)}
                        className="flex h-12 flex-1 items-center justify-center rounded-xl bg-pd-surface-2 text-sm font-bold text-pd-danger ring-1 ring-pd-line"
                    >
                        {t("alerts.missRequest")}
                    </button>
                </div>
            </div>
        </div>
    );
}
