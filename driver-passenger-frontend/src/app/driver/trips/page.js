"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
    ArrowLeft, CalendarDays, CarFront, ChevronRight,
    History, Route, Wallet, CheckCircle2
} from "lucide-react";
import AuthGuard from "@/components/AuthGuard";
import MobileBottomNav from "@/components/MobileBottomNav";
import { useAuth } from "@/context/AuthContext";
import { apiRequest } from "@/lib/api";

const money = (value) =>
    value == null ? "—" : `PKR ${Number(value).toLocaleString("en-PK")}`;

export default function DriverTripsPage() {
    return (
        <AuthGuard role="DRIVER">
            <TripsContent />
        </AuthGuard>
    );
}

function TripsContent() {
    const { token } = useAuth();
    const [rides, setRides] = useState([]);
    const [filter, setFilter] = useState("ALL");
    const [page, setPage] = useState(1);
    const [pages, setPages] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    useEffect(() => {
        if (!token) return;
        let cancelled = false;

        setLoading(true);
        setError("");

        apiRequest(`/drivers/me/history?page=${page}`, { token })
            .then((data) => {
                if (cancelled) return;
                setRides(data.rides || []);
                setPages(data.pagination?.pages || 0);
            })
            .catch((err) => {
                if (!cancelled) setError(err.message);
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });

        return () => { cancelled = true; };
    }, [token, page]);

    const visibleRides = rides.filter((ride) =>
        filter === "COMPLETED"
            ? ride.status === "TRIP_COMPLETED"
            : true
    );

    return (
        <main className="driver-subpage min-h-dvh bg-pd-bg pb-[calc(100px+env(safe-area-inset-bottom))] text-pd-text">
            <MobileBottomNav role="DRIVER" />

            <header className="bg-[#087F5B] px-5 pb-8 pt-[max(24px,env(safe-area-inset-top))] text-white">
                <div className="mx-auto flex max-w-xl items-center gap-4">
                    <Link href="/driver" aria-label="Back to home" className="rounded-xl bg-white/15 p-3">
                        <ArrowLeft size={20} />
                    </Link>
                    <h1 className="text-lg font-bold">Trip History</h1>
                </div>
                <div className="mx-auto mt-8 max-w-xl">
                    <h2 className="text-3xl font-extrabold">My Trips</h2>
                    <p className="mt-2 text-sm text-white/75">
                        Review your assigned and completed trips
                    </p>
                </div>
            </header>

            <div className="relative z-10 mx-auto mt-4 max-w-xl space-y-4 px-4">
                <div className="grid grid-cols-2 gap-3 rounded-2xl bg-pd-surface p-3 shadow-sm">
                    {[
                        ["ALL", "All Trips"],
                        ["COMPLETED", "Completed"],
                    ].map(([value, label]) => (
                        <button
                            key={value}
                            onClick={() => setFilter(value)}
                            className={`rounded-xl py-3 text-xs font-bold ${filter === value
                                ? "bg-[#087F5B] text-white"
                                : "bg-pd-surface-2 text-pd-text-2"
                                }`}
                        >
                            {label}
                        </button>
                    ))}
                </div>

                {loading && (
                    <div className="rounded-2xl bg-pd-surface p-8 text-center text-sm text-pd-muted">
                        Loading trip history...
                    </div>
                )}

                {error && (
                    <p role="alert" className="rounded-2xl bg-pd-danger-soft p-4 text-sm text-pd-danger">
                        {error}
                    </p>
                )}

                {!loading && !error && visibleRides.length === 0 && (
                    <div className="rounded-2xl bg-pd-surface p-10 text-center">
                        <History size={36} className="mx-auto text-[#087F5B]" />
                        <p className="mt-3 font-bold">No trips found</p>
                        <p className="mt-2 text-sm text-pd-muted">
                            Your driving history will appear here.
                        </p>
                    </div>
                )}

                {!loading && !error && visibleRides.map((ride) => (
                    <article key={ride._id} className="rounded-[24px] bg-pd-surface p-5 shadow-sm">
                        <div className="flex justify-between gap-3">
                            <div className="flex items-center gap-3">
                                <div className="rounded-xl bg-pd-success-soft p-3 text-[#087F5B]">
                                    <CarFront size={22} />
                                </div>
                                <div>
                                    <h3 className="text-sm font-extrabold">
                                        {ride.vehicleType?.replaceAll("_", " ") || "Ride"}
                                    </h3>
                                    <p className="mt-1 flex items-center gap-1 text-xs text-pd-muted">
                                        <CalendarDays size={13} />
                                        {new Date(ride.createdAt).toLocaleDateString("en-PK")}
                                    </p>
                                </div>
                            </div>
                            <p className="font-extrabold text-[#087F5B]">
                                {money(ride.finalPrice ?? ride.requestedPrice)}
                            </p>
                        </div>

                        <div className="mt-4 flex items-center justify-between border-t pt-4">
                            <span className={`rounded-lg px-3 py-1.5 text-xs font-bold ${ride.status === "TRIP_COMPLETED"
                                ? "bg-pd-success-soft text-[#087F5B]"
                                : "bg-pd-warning-soft text-pd-warning"
                                }`}>
                                {ride.status?.replaceAll("_", " ")}
                            </span>
                            <span className="flex items-center gap-1 text-xs text-pd-muted">
                                <Route size={14} />
                                {ride.distance != null ? `${ride.distance} km` : "—"}
                            </span>
                        </div>

                        {ride.status === "TRIP_COMPLETED" && (
                            <p className="mt-4 flex items-center gap-2 rounded-xl bg-pd-success-soft p-3 text-xs font-semibold text-[#087F5B]">
                                <CheckCircle2 size={17} />
                                Trip completed · Cash fare {money(ride.finalPrice)}
                            </p>
                        )}
                    </article>
                ))}

                {pages > 1 && !error && (
                    <div className="flex items-center justify-between rounded-2xl bg-pd-surface p-3">
                        <button
                            disabled={loading || page <= 1}
                            onClick={() => setPage((p) => p - 1)}
                            className="rounded-xl border px-4 py-2 text-sm disabled:opacity-40"
                        >
                            Previous
                        </button>
                        <span className="text-xs text-pd-muted">{page} / {pages}</span>
                        <button
                            disabled={loading || page >= pages}
                            onClick={() => setPage((p) => p + 1)}
                            className="rounded-xl border px-4 py-2 text-sm disabled:opacity-40"
                        >
                            Next
                        </button>
                    </div>
                )}
            </div>
        </main>
    );
}
