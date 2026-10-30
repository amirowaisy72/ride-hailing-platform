"use client";

import { useLanguage, storedLanguage } from "@/components/i18n/LanguageProvider";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bell, CarFront, KeyRound, Package, ShoppingBag, X } from "lucide-react";

import { useAuth } from "@/context/AuthContext";
import { apiRequest } from "@/lib/api";
import { getAvailablePurchaseRequests } from "@/lib/purchaseService";
import { getPartnerRentalBookings } from "@/lib/rentalService";
import { placeLabel } from "@/lib/rideDisplay";
import { categoryLabel } from "@/components/parcel/parcelUi";

// ---------------------------------------------------------------------------
// Driver global alert layer (Amir review A6).
//
// Mounted once by src/app/driver/layout.js, so it watches for new work
// on EVERY driver screen — not just Home / Tasks.
//
// Why polling, not sockets: the realtime trees carry a byte-identical
// mirror constraint and purchase fan-out already exists, but a socket
// event can announce a request this driver may not actually be eligible
// for (stale GPS, offline, wrong service). Polling reuses the exact
// eligibility-gated available feeds the Tasks page uses
// (/drivers/me/available-rides, /parcels/available,
// getAvailablePurchaseRequests, getPartnerRentalBookings), so an alert
// can only ever announce a request the driver can actually take.
// Feed failures — 403 GPS_STALE included — are swallowed silently:
// ineligibility simply means "no alerts right now", never an error.
// ---------------------------------------------------------------------------

const POLL_MS = 20000;
const SEEN_KEY = "safar:driver-alert-seen:v1";
const SEEDED_KEY = "safar:driver-alert-seeded:v1";
const MAX_BANNERS = 4;

const SERVICE_META = {
    RIDE: { labelKey: "alerts.newRide", Icon: CarFront },
    PARCEL: { labelKey: "alerts.newParcel", Icon: Package },
    BUY_DELIVER: { labelKey: "alerts.newBd", Icon: ShoppingBag },
    RENTAL: { labelKey: "alerts.newRental", Icon: KeyRound },
};

function readSeen() {
    try {
        const raw = sessionStorage.getItem(SEEN_KEY);
        const list = raw ? JSON.parse(raw) : [];
        return new Set(Array.isArray(list) ? list.map(String) : []);
    } catch {
        return new Set();
    }
}

function writeSeen(seen) {
    try {
        sessionStorage.setItem(SEEN_KEY, JSON.stringify([...seen]));
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
        href: `/driver/parcels/details?parcelId=${id}`,
    };
}

function purchaseAlert(order) {
    const id = String(order._id || "");
    if (!id) return null;
    return {
        key: `BUY_DELIVER:${id}`,
        service: "BUY_DELIVER",
        summary: firstLine(order.itemsText) || (storedLanguage() === "ur" ? "خریداری کی درخواست" : "Shopping request"),
        href: `/driver/buy-deliver/details?id=${id}`,
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
        href: `/driver/rentals/bookings/details?id=${id}`,
    };
}

export default function DriverRequestAlerts() {
    const { t } = useLanguage();
    const { token } = useAuth();
    const [alerts, setAlerts] = useState([]);
    const seenRef = useRef(null);
    const seededRef = useRef(false);
    const audioRef = useRef(null);
    const audioArmedRef = useRef(false);

    if (seenRef.current === null) {
        // Lazy one-time init (client only — this component never SSRs
        // meaningfully because it renders nothing without a token).
        seenRef.current = typeof window !== "undefined" ? readSeen() : new Set();
        seededRef.current =
            typeof window !== "undefined" &&
            (() => {
                try {
                    return sessionStorage.getItem(SEEDED_KEY) === "1";
                } catch {
                    return false;
                }
            })();
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
            /* Audio unavailable — the banner still shows. */
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
        // partner...) there is nothing trustworthy to diff — stay quiet
        // and, importantly, do not seed on an empty failure.
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

        const seen = seenRef.current;
        const arrivals = fresh.filter((item) => !seen.has(item.key));
        for (const item of fresh) seen.add(item.key);
        writeSeen(seen);

        if (!seededRef.current) {
            // First successful poll of the session seeds the seen-set
            // silently — requests already waiting when the app opened
            // must not trigger an alert storm.
            seededRef.current = true;
            try {
                sessionStorage.setItem(SEEDED_KEY, "1");
            } catch {
                /* In-memory flag still applies. */
            }
            return;
        }

        if (arrivals.length) {
            setAlerts((prev) => {
                const known = new Set(prev.map((item) => item.key));
                const added = arrivals.filter((item) => !known.has(item.key));
                return added.length ? [...added, ...prev].slice(0, MAX_BANNERS + 4) : prev;
            });
            beep();
        }
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

    if (!token || alerts.length === 0) return null;

    const dismiss = (key) =>
        setAlerts((prev) => prev.filter((item) => item.key !== key));

    return (
        <div className="pointer-events-none fixed inset-x-0 top-[max(10px,env(safe-area-inset-top))] z-[120] mx-auto w-full max-w-xl space-y-2 px-3">
            <div className="flex justify-center">
                <span className="pointer-events-auto inline-flex items-center gap-1.5 rounded-full bg-pd-ink px-3 py-1.5 text-xs font-extrabold text-pd-ink-text shadow-pd-lg">
                    <Bell size={13} />
                    {t("dHome.newRequests", { count: alerts.length, plural: alerts.length === 1 ? "" : "s" })}
                </span>
            </div>
            {alerts.slice(0, MAX_BANNERS).map((item) => {
                const { labelKey, Icon } = SERVICE_META[item.service];
                const label = t(labelKey);
                return (
                    <div
                        key={item.key}
                        role="status"
                        className="pointer-events-auto flex items-center gap-3 rounded-2xl border border-pd-line bg-pd-elevated p-3 shadow-pd-lg backdrop-blur"
                    >
                        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-pd-accent-soft text-pd-accent-text">
                            <Icon size={19} />
                        </span>
                        <span className="min-w-0 flex-1">
                            <span className="block text-[13px] font-extrabold text-pd-text">
                                {label}
                            </span>
                            <span className="block truncate text-xs text-pd-muted">
                                {item.summary}
                            </span>
                        </span>
                        <Link
                            href={item.href}
                            onClick={() => dismiss(item.key)}
                            className="shrink-0 rounded-xl bg-pd-accent px-3.5 py-2.5 text-sm font-bold text-pd-accent-ink"
                        >
                            {t("alerts.view")}
                        </Link>
                        <button
                            type="button"
                            onClick={() => dismiss(item.key)}
                            aria-label={t("alerts.dismissAlert", { label })}
                            className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-pd-surface-2 text-pd-muted"
                        >
                            <X size={16} />
                        </button>
                    </div>
                );
            })}
        </div>
    );
}
