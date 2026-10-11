
"use client";

import { useCallback, useEffect, useState } from "react";
import {
    ChevronLeft, ChevronRight, Mail,
    RefreshCw, Search, UserRound, Users,
} from "lucide-react";

import AdminShell from "@/components/AdminShell";
import { authenticatedAdminRequest } from "@/lib/adminSession";

const formatDate = (value) =>
    value
        ? new Date(value).toLocaleDateString("en-PK", {
            day: "numeric",
            month: "short",
            year: "numeric",
        })
        : "—";

const displayName = (user) =>
    [user.firstName, user.lastName].filter(Boolean).join(" ") ||
    user.name ||
    "Passenger";

export default function PassengersPage() {
    const [passengers, setPassengers] = useState([]);
    const [searchInput, setSearchInput] = useState("");
    const [search, setSearch] = useState("");
    const [page, setPage] = useState(1);
    const [pagination, setPagination] = useState({});
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    const loadPassengers = useCallback(async () => {
        setLoading(true);
        setError("");

        try {
            const params = new URLSearchParams({
                page: String(page),
            });

            if (search) params.set("search", search);

            const data = await authenticatedAdminRequest(
                `/admin/operations/passengers?${params.toString()}`
            );

            setPassengers(data.passengers || []);
            setPagination(data.pagination || {});
        } catch (err) {
            setPassengers([]);
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, [page, search]);

    useEffect(() => {
        loadPassengers();
    }, [loadPassengers]);

    function submitSearch(event) {
        event.preventDefault();
        setPage(1);
        setSearch(searchInput.trim());
    }

    return (
        <AdminShell title="Passenger Management">
            <div className="space-y-6">
                <section className="flex flex-wrap items-start justify-between gap-4 rounded-[24px] bg-white p-6 shadow-sm">
                    <div>
                        <p className="text-xs font-bold uppercase tracking-wider text-[#087F5B]">
                            Account Management
                        </p>
                        <h2 className="mt-2 text-2xl font-extrabold">
                            Passenger Accounts
                        </h2>
                        <p className="mt-2 text-sm text-slate-500">
                            View and search registered platform passengers.
                        </p>
                    </div>

                    <button
                        type="button"
                        disabled={loading}
                        onClick={loadPassengers}
                        className="flex items-center gap-2 rounded-xl border px-4 py-3 text-sm font-bold disabled:opacity-50"
                    >
                        <RefreshCw
                            size={17}
                            className={loading ? "animate-spin" : ""}
                        />
                        Refresh
                    </button>
                </section>

                <div className="rounded-2xl bg-white p-5 shadow-sm">
                    <Users size={25} className="text-[#087F5B]" />
                    <p className="mt-3 text-sm text-slate-500">
                        Registered Passengers
                    </p>
                    <p className="mt-1 text-3xl font-extrabold">
                        {loading ? "—" : pagination.total ?? 0}
                    </p>
                    <p className="mt-1 text-xs text-slate-400">
                        Total matching current search
                    </p>
                </div>

                <section className="overflow-hidden rounded-[24px] bg-white shadow-sm">
                    <form
                        onSubmit={submitSearch}
                        className="flex flex-col gap-3 border-b p-5 sm:flex-row"
                    >
                        <div className="flex flex-1 items-center gap-3 rounded-xl border px-4">
                            <Search size={19} className="text-slate-400" />

                            <input
                                type="search"
                                value={searchInput}
                                onChange={(e) => setSearchInput(e.target.value)}
                                placeholder="Search by name or email"
                                className="h-12 min-w-0 flex-1 bg-transparent text-sm outline-none"
                            />
                        </div>

                        <button
                            type="submit"
                            className="rounded-xl bg-[#087F5B] px-6 py-3 text-sm font-bold text-white"
                        >
                            Search
                        </button>
                    </form>

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
                            Loading passenger accounts...
                        </p>
                    ) : !error && passengers.length === 0 ? (
                        <div className="p-10 text-center">
                            <UserRound
                                size={36}
                                className="mx-auto text-[#087F5B]"
                            />
                            <p className="mt-3 font-bold">
                                No passengers found
                            </p>
                        </div>
                    ) : (
                        <div className="divide-y divide-slate-100">
                            {passengers.map((passenger) => (
                                <article
                                    key={passenger._id}
                                    className="flex flex-wrap items-center gap-4 p-5"
                                >
                                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-50 font-extrabold text-[#087F5B]">
                                        {displayName(passenger).charAt(0).toUpperCase()}
                                    </div>

                                    <div className="min-w-0 flex-1">
                                        <p className="font-bold">
                                            {displayName(passenger)}
                                        </p>

                                        <p className="mt-1 flex items-center gap-1.5 truncate text-sm text-slate-500">
                                            <Mail size={14} />
                                            {passenger.email}
                                        </p>
                                    </div>

                                    <div>
                                        <p className="text-xs text-slate-400">
                                            Registered
                                        </p>
                                        <p className="mt-1 text-sm font-semibold">
                                            {formatDate(passenger.createdAt)}
                                        </p>
                                    </div>
                                </article>
                            ))}
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
                                {page} / {pagination.pages}
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
            </div>
        </AdminShell>
    );
}
