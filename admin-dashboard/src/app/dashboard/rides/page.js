
"use client";

import { useCallback, useEffect, useState } from "react";
import {
    Activity, CarFront, ChevronLeft, ChevronRight,
    Clock3, RefreshCw, Route, Wallet,
} from "lucide-react";

import AdminShell from "@/components/AdminShell";
import { authenticatedAdminRequest } from "@/lib/adminSession";

const filters = [
    { id: "ALL", label: "All Rides" },
    { id: "ACTIVE", label: "Active" },
    { id: "TRIP_COMPLETED", label: "Completed" },
    { id: "CANCELLED", label: "Cancelled" },
];

const statusNames = {
    REQUESTED: "Requested",
    SEARCHING: "Searching",
    BIDDING: "Bidding",
    DRIVER_SELECTED: "Driver Selected",
    DRIVER_EN_ROUTE: "Driver En Route",
    DRIVER_ARRIVED: "Driver Arrived",
    TRIP_STARTED: "Trip In Progress",
    TRIP_COMPLETED: "Completed",
    CANCELLED: "Cancelled",
    EXPIRED: "Expired",
    REASSIGNING: "Reassigning",
};

const money = (value) =>
    value == null
        ? "—"
        : `PKR ${Number(value).toLocaleString("en-PK")}`;

const formatDate = (date) =>
    date
        ? new Date(date).toLocaleString("en-PK", {
            dateStyle: "medium",
            timeStyle: "short",
        })
        : "—";

function StatusBadge({ status }) {
    const color =
        status === "TRIP_COMPLETED"
            ? "bg-emerald-50 text-emerald-700"
            : status === "CANCELLED" || status === "EXPIRED"
                ? "bg-red-50 text-red-600"
                : "bg-amber-50 text-amber-700";

    return (
        <span className={`inline-block rounded-lg px-3 py-1.5 text-xs font-bold ${color}`}>
            {statusNames[status] || status}
        </span>
    );
}

export default function RidesManagementPage() {
    const [rides, setRides] = useState([]);
    const [filter, setFilter] = useState("ALL");
    const [page, setPage] = useState(1);
    const [pagination, setPagination] = useState({});
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    const loadRides = useCallback(async () => {
        setLoading(true);
        setError("");

        try {
            const params = new URLSearchParams({
                page: String(page),
                status: filter,
            });

            const data = await authenticatedAdminRequest(
                `/admin/operations/rides?${params.toString()}`
            );

            setRides(data.rides || []);
            setPagination(data.pagination || {});
        } catch (err) {
            setRides([]);
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, [filter, page]);

    useEffect(() => {
        loadRides();
    }, [loadRides]);

    function changeFilter(nextFilter) {
        setFilter(nextFilter);
        setPage(1);
    }

    return (
        <AdminShell title="Ride Management">
            <div className="space-y-6">
                <section className="flex flex-wrap items-start justify-between gap-4 rounded-[24px] bg-white p-6 shadow-sm">
                    <div>
                        <p className="text-xs font-bold uppercase tracking-wider text-[#087F5B]">
                            Ride Operations
                        </p>
                        <h2 className="mt-2 text-2xl font-extrabold">
                            Ride Management
                        </h2>
                        <p className="mt-2 text-sm text-slate-500">
                            Monitor trip requests, active rides, completed
                            journeys and settlement statuses.
                        </p>
                    </div>

                    <button
                        type="button"
                        onClick={loadRides}
                        disabled={loading}
                        className="flex items-center gap-2 rounded-xl border px-4 py-3 text-sm font-bold disabled:opacity-50"
                    >
                        <RefreshCw
                            size={17}
                            className={loading ? "animate-spin" : ""}
                        />
                        Refresh
                    </button>
                </section>

                <section className="rounded-[24px] bg-white p-5 shadow-sm">
                    <div className="flex items-center gap-3">
                        <div className="rounded-xl bg-emerald-50 p-3 text-[#087F5B]">
                            <Route size={24} />
                        </div>

                        <div>
                            <p className="text-sm text-slate-500">
                                Matching Rides
                            </p>
                            <p className="text-3xl font-extrabold">
                                {loading ? "—" : pagination.total ?? 0}
                            </p>
                        </div>
                    </div>
                </section>

                <section className="overflow-hidden rounded-[24px] bg-white shadow-sm">
                    <div className="flex flex-wrap gap-2 border-b p-5">
                        {filters.map((item) => (
                            <button
                                key={item.id}
                                type="button"
                                onClick={() => changeFilter(item.id)}
                                className={`rounded-xl px-4 py-3 text-xs font-bold ${filter === item.id
                                        ? "bg-[#087F5B] text-white"
                                        : "bg-slate-100 text-slate-600"
                                    }`}
                            >
                                {item.label}
                            </button>
                        ))}
                    </div>

                    {error && (
                        <p
                            role="alert"
                            className="m-5 rounded-xl bg-red-50 p-4 text-sm text-red-600"
                        >
                            {error}
                        </p>
                    )}

                    {loading ? (
                        <p className="p-10 text-center text-sm text-slate-500">
                            Loading rides...
                        </p>
                    ) : !error && rides.length === 0 ? (
                        <div className="p-10 text-center">
                            <CarFront
                                size={36}
                                className="mx-auto text-[#087F5B]"
                            />
                            <p className="mt-3 font-bold">
                                No rides found
                            </p>
                            <p className="mt-2 text-sm text-slate-500">
                                Ride records will appear here.
                            </p>
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full min-w-[950px] text-left text-sm">
                                <thead className="bg-slate-50 text-xs text-slate-500">
                                    <tr>
                                        <th className="px-5 py-4">Ride</th>
                                        <th className="px-5 py-4">Vehicle</th>
                                        <th className="px-5 py-4">Status</th>
                                        <th className="px-5 py-4">Requested Fare</th>
                                        <th className="px-5 py-4">Final Fare</th>
                                        <th className="px-5 py-4">Settlement</th>
                                        <th className="px-5 py-4">Booked</th>
                                    </tr>
                                </thead>

                                <tbody>
                                    {rides.map((ride) => (
                                        <tr
                                            key={ride._id}
                                            className="border-t border-slate-100"
                                        >
                                            <td className="px-5 py-4">
                                                <p className="font-mono text-xs font-bold">
                                                    {String(ride._id).slice(-10)}
                                                </p>
                                                <p className="mt-1 text-xs text-slate-400">
                                                    {ride.distance != null
                                                        ? `${ride.distance} km`
                                                        : "Distance unavailable"}
                                                </p>
                                            </td>

                                            <td className="px-5 py-4">
                                                {ride.vehicleType?.replaceAll("_", " ") || "—"}
                                            </td>

                                            <td className="px-5 py-4">
                                                <StatusBadge status={ride.status} />
                                            </td>

                                            <td className="px-5 py-4">
                                                {money(ride.requestedPrice)}
                                            </td>

                                            <td className="px-5 py-4 font-semibold">
                                                {money(ride.finalPrice)}
                                            </td>

                                            <td className="px-5 py-4">
                                                <span className="flex items-center gap-1 text-xs font-semibold text-slate-600">
                                                    <Wallet size={14} />
                                                    {ride.settlementStatus || "Not Recorded"}
                                                </span>
                                            </td>

                                            <td className="px-5 py-4 text-xs text-slate-500">
                                                {formatDate(ride.createdAt)}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}

                    {pagination.pages > 1 && (
                        <div className="flex items-center justify-between gap-3 border-t p-5">
                            <button
                                type="button"
                                disabled={loading || page <= 1}
                                onClick={() => setPage((p) => p - 1)}
                                className="flex items-center gap-1 rounded-xl border px-4 py-2 text-sm disabled:opacity-40"
                            >
                                <ChevronLeft size={17} />
                                Previous
                            </button>

                            <span className="text-sm text-slate-500">
                                Page {page} / {pagination.pages}
                            </span>

                            <button
                                type="button"
                                disabled={loading || page >= pagination.pages}
                                onClick={() => setPage((p) => p + 1)}
                                className="flex items-center gap-1 rounded-xl border px-4 py-2 text-sm disabled:opacity-40"
                            >
                                Next
                                <ChevronRight size={17} />
                            </button>
                        </div>
                    )}
                </section>

                <p className="text-xs text-slate-500">
                    Ride statuses are loaded from the backend on refresh.
                    Automatic live updates and administrative interventions
                    will be added in a later phase.
                </p>
            </div>
        </AdminShell>
    );
}
