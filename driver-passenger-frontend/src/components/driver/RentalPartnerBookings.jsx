"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CalendarClock, ChevronRight, KeyRound } from "lucide-react";

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
    REQUESTED: { label: "New request", pill: "bg-amber-50 text-amber-700" },
    PROVIDER_ACCEPTED: { label: "Accepted", pill: "bg-blue-50 text-blue-700" },
    PAYMENT_PENDING: { label: "Fee payment pending", pill: "bg-blue-50 text-blue-700" },
    CONFIRMED: { label: "Confirmed", pill: "bg-emerald-50 text-[#087F5B]" },
    PICKUP_VERIFIED: { label: "Pickup verified", pill: "bg-emerald-50 text-[#087F5B]" },
    RENTAL_ACTIVE: { label: "Rental active", pill: "bg-[#087F5B] text-white" },
    RETURN_PENDING: { label: "Return pending", pill: "bg-amber-50 text-amber-700" },
    COMPLETED: { label: "Completed", pill: "bg-slate-100 text-slate-600" },
    CANCELLED: { label: "Cancelled", pill: "bg-slate-100 text-slate-500" },
    NO_SHOW: { label: "No show", pill: "bg-red-50 text-red-600" },
    DISPUTED: { label: "Disputed", pill: "bg-red-50 text-red-600" },
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

    return (
        <section>
            <div className="flex items-center gap-2 px-1">
                <h3 className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-wider text-slate-500">
                    <KeyRound size={14} /> Bookings ({visibleBookings.length})
                </h3>
                <select
                    value={statusFilter}
                    onChange={(e) => {
                        setLoading(true);
                        setStatusFilter(e.target.value);
                    }}
                    aria-label="Filter bookings by status"
                    className="ml-auto h-9 rounded-xl border bg-white px-2 text-xs font-bold text-slate-600"
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
                <p role="alert" className="mt-3 rounded-xl bg-red-50 p-4 text-sm font-semibold text-red-600">
                    {error}
                </p>
            )}

            <div className="mt-3 space-y-3">
                {loading ? (
                    <div className="h-40 animate-pulse rounded-[24px] bg-white shadow-sm" aria-busy="true" />
                ) : visibleBookings.length === 0 ? (
                    <div className="rounded-[24px] bg-white p-6 text-center shadow-sm">
                        <KeyRound size={30} className="mx-auto text-[#087F5B]" />
                        <p className="mt-2 text-sm font-bold">No bookings yet</p>
                        <p className="mt-1 text-xs text-slate-500">
                            Bookings for your vehicles will appear here.
                        </p>
                    </div>
                ) : (
                    visibleBookings.map((booking) => {
                        const meta =
                            RENTAL_BOOKING_META[booking.status] || {
                                label: booking.status,
                                pill: "bg-slate-100 text-slate-600",
                            };
                        return (
                            <Link
                                key={booking._id}
                                href={`/driver/rentals/bookings/details?id=${booking._id}`}
                                className="block rounded-[24px] bg-white p-5 shadow-sm"
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
                                    <ChevronRight size={16} className="ml-auto text-slate-400" />
                                </div>
                                <p className="mt-2 text-sm font-bold">
                                    {booking.vehicle
                                        ? `${booking.vehicle.brand} ${booking.vehicle.model} (${booking.vehicle.year})`
                                        : "Vehicle"}
                                    <span className="ml-2 text-xs font-semibold text-slate-400">
                                        {booking.mode === "WITH_DRIVER"
                                            ? "With Driver"
                                            : "Self-Drive"}
                                    </span>
                                </p>
                                <p className="mt-1 flex items-center gap-1 text-xs font-semibold text-slate-500">
                                    <CalendarClock size={13} />
                                    {fmtDateTime(booking.startAt)} →{" "}
                                    {fmtDateTime(booking.endAt)}
                                </p>
                                <p className="mt-1.5 text-xs font-semibold text-slate-500">
                                    Rental {money(booking.rentalCharges)} ·
                                    Deposit {money(booking.securityDeposit)}
                                </p>
                            </Link>
                        );
                    })
                )}
            </div>
        </section>
    );
}
