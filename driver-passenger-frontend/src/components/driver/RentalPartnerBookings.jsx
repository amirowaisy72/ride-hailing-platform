"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, CalendarClock, ChevronRight, KeyRound } from "lucide-react";

import { getPartnerRentalBookings } from "@/lib/rentalService";

// Rental Partner bookings list — every booking on the partner's
// vehicles, newest first, linking into the execution screen.

const money = (value) =>
    value == null ? "—" : `PKR ${Number(value).toLocaleString("en-PK")}`;

const fmtDateTime = (value) =>
    value
        ? new Date(value).toLocaleString("en-PK", {
              day: "numeric",
              month: "short",
              hour: "numeric",
              minute: "2-digit",
          })
        : "—";

export const RENTAL_BOOKING_META = {
    REQUESTED: { label: "New request", pill: "bg-pd-warning-soft text-pd-warning" },
    PROVIDER_ACCEPTED: { label: "Accepted", pill: "bg-pd-info-soft text-pd-info" },
    PAYMENT_PENDING: { label: "Fee payment pending", pill: "bg-pd-info-soft text-pd-info" },
    CONFIRMED: { label: "Confirmed", pill: "bg-pd-success-soft text-[#087F5B]" },
    PICKUP_VERIFIED: { label: "Pickup verified", pill: "bg-pd-success-soft text-[#087F5B]" },
    RENTAL_ACTIVE: { label: "Rental active", pill: "bg-[#087F5B] text-white" },
    RETURN_PENDING: { label: "Return pending", pill: "bg-pd-warning-soft text-pd-warning" },
    COMPLETED: { label: "Completed", pill: "bg-pd-surface-3 text-pd-muted" },
    CANCELLED: { label: "Cancelled", pill: "bg-pd-surface-3 text-pd-faint" },
    NO_SHOW: { label: "No show", pill: "bg-pd-danger-soft text-pd-danger" },
    DISPUTED: { label: "Disputed", pill: "bg-pd-danger-soft text-pd-danger" },
};

// The one thing the partner does next on each booking. `urgent` ones
// need the partner; the rest are simply waiting on someone else.
const NEXT_ACTION = {
    REQUESTED: { text: "Accept or reject this request", urgent: true },
    PROVIDER_ACCEPTED: { text: "Waiting for the customer's booking fee", urgent: false },
    PAYMENT_PENDING: { text: "Waiting for Safar to verify the fee", urgent: false },
    CONFIRMED: { text: "Hand over the car — verify pickup", urgent: true },
    PICKUP_VERIFIED: { text: "Start the rental", urgent: true },
    RENTAL_ACTIVE: { text: "Record the return when the car is back", urgent: true },
    RETURN_PENDING: { text: "Waiting for the customer to confirm the return", urgent: false },
    DISPUTED: { text: "Under dispute — open to see details", urgent: true },
};

export default function RentalPartnerBookings({ token }) {
    const [bookings, setBookings] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [statusFilter, setStatusFilter] = useState("");

    useEffect(() => {
        if (!token) return;
        let cancelled = false;
        // The partner bookings wrapper takes no status parameter —
        // the status filter is applied client-side over the full list.
        getPartnerRentalBookings(token)
            .then((data) => {
                if (!cancelled) setBookings(data.bookings || []);
            })
            .catch((err) => {
                if (!cancelled) setError(err.message);
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [token]);

    const visibleBookings = statusFilter
        ? bookings.filter((b) => b.status === statusFilter)
        : bookings;

    const needsYou = visibleBookings.filter(
        (b) => NEXT_ACTION[b.status]?.urgent
    );
    const others = visibleBookings.filter(
        (b) => !NEXT_ACTION[b.status]?.urgent
    );

    function renderBooking(booking) {
        const meta =
            RENTAL_BOOKING_META[booking.status] || {
                label: booking.status,
                pill: "bg-pd-surface-3 text-pd-muted",
            };
        const next = NEXT_ACTION[booking.status];
        return (
            <Link
                key={booking._id}
                href={`/driver/rentals/bookings/details?id=${booking._id}`}
                className="block rounded-[24px] bg-pd-surface p-5 shadow-sm"
            >
                <div className="flex items-center gap-2">
                    <span className="text-sm font-extrabold">
                        {booking.bookingRef}
                    </span>
                    <span
                        className={`rounded-full px-2.5 py-1 text-[11px] font-extrabold ${meta.pill}`}
                    >
                        {meta.label}
                    </span>
                    <ChevronRight size={16} className="ml-auto text-pd-faint" />
                </div>
                <p className="mt-2 text-sm font-bold">
                    {booking.vehicle
                        ? `${booking.vehicle.brand} ${booking.vehicle.model} (${booking.vehicle.year})`
                        : "Vehicle"}
                    <span className="ml-2 text-xs font-semibold text-pd-faint">
                        {booking.mode === "WITH_DRIVER"
                            ? "With Driver"
                            : "Self-Drive"}
                    </span>
                </p>
                <p className="mt-1 flex items-center gap-1 text-xs font-semibold text-pd-muted">
                    <CalendarClock size={13} />
                    {fmtDateTime(booking.startAt)} →{" "}
                    {fmtDateTime(booking.endAt)}
                </p>
                <p className="mt-1.5 text-xs font-semibold text-pd-muted">
                    Rental {money(booking.rentalCharges)} · Deposit{" "}
                    {money(booking.securityDeposit)}
                </p>
                {next && (
                    <p
                        className={`mt-3 flex min-h-11 items-center gap-2 rounded-xl px-3 text-xs font-extrabold ${
                            next.urgent
                                ? "bg-[#087F5B] text-white"
                                : "bg-pd-surface-2 text-pd-muted"
                        }`}
                    >
                        <span className="min-w-0 flex-1">{next.text}</span>
                        {next.urgent && <ArrowRight size={15} className="shrink-0" />}
                    </p>
                )}
            </Link>
        );
    }

    return (
        <section>
            <div className="flex items-center gap-2 px-1">
                <h3 className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-wider text-pd-muted">
                    <KeyRound size={14} /> Bookings ({visibleBookings.length})
                </h3>
                <select
                    value={statusFilter}
                    onChange={(e) => {
                        setLoading(true);
                        setStatusFilter(e.target.value);
                    }}
                    aria-label="Filter bookings by status"
                    className="ml-auto h-11 rounded-xl border bg-pd-surface px-2 text-xs font-bold text-pd-text-2"
                >
                    <option value="">All statuses</option>
                    {Object.entries(RENTAL_BOOKING_META).map(([key, meta]) => (
                        <option key={key} value={key}>
                            {meta.label}
                        </option>
                    ))}
                </select>
            </div>

            {error && (
                <p role="alert" className="mt-3 rounded-xl bg-pd-danger-soft p-4 text-sm font-semibold text-pd-danger">
                    {error}
                </p>
            )}

            <div className="mt-3 space-y-3">
                {loading ? (
                    <div className="h-40 animate-pulse rounded-[24px] bg-pd-surface shadow-sm" aria-busy="true" />
                ) : visibleBookings.length === 0 ? (
                    <div className="rounded-[24px] bg-pd-surface p-6 text-center shadow-sm">
                        <KeyRound size={30} className="mx-auto text-[#087F5B]" />
                        <p className="mt-2 text-sm font-bold">No bookings yet</p>
                        <p className="mt-1 text-xs text-pd-muted">
                            Bookings for your vehicles will appear here.
                        </p>
                    </div>
                ) : (
                    <>
                        {needsYou.length > 0 && (
                            <>
                                <p className="px-1 text-xs font-extrabold uppercase tracking-wider text-[#087F5B]">
                                    Needs you ({needsYou.length})
                                </p>
                                {needsYou.map(renderBooking)}
                            </>
                        )}
                        {others.length > 0 && (
                            <>
                                {needsYou.length > 0 && (
                                    <p className="px-1 pt-2 text-xs font-extrabold uppercase tracking-wider text-pd-muted">
                                        Everything else ({others.length})
                                    </p>
                                )}
                                {others.map(renderBooking)}
                            </>
                        )}
                    </>
                )}
            </div>
        </section>
    );
}
