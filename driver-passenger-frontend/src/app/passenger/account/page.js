
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
    ArrowLeft, ChevronRight, Clock3, History,
    LogOut, Mail, ShieldCheck, UserRound,
    CarFront, Star, Settings2, Headphones,
} from "lucide-react";

import AuthGuard from "@/components/AuthGuard";
import { useAuth } from "@/context/AuthContext";
import { apiRequest } from "@/lib/api";
import { BRAND } from "@/config/brand";
import MobileBottomNav from "@/components/MobileBottomNav";

const formatFare = (ride) =>
    `PKR ${Number(ride.finalPrice ?? ride.requestedPrice ?? 0).toLocaleString("en-PK")}`;

const formatDate = (value) =>
    new Date(value).toLocaleDateString("en-PK", {
        day: "numeric",
        month: "short",
        year: "numeric",
    });

export default function PassengerAccountPage() {
    return (
        <AuthGuard role="PASSENGER">
            <AccountScreen />
        </AuthGuard>
    );
}

function AccountScreen() {
    const { user, token, logout } = useAuth();
    const [accountUser, setAccountUser] = useState(null);

    useEffect(() => {
        if (!token) return;

        let cancelled = false;

        apiRequest("/account/me", { token })
            .then((data) => {
                if (!cancelled) setAccountUser(data.user);
            })
            .catch((error) => {
                console.error("Unable to refresh account:", error.message);
            });

        return () => {
            cancelled = true;
        };
    }, [token]);

    const [rides, setRides] = useState([]);
    const [page, setPage] = useState(1);
    const [pages, setPages] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    const displayUser = accountUser || user;

    const fullName =
        [displayUser?.firstName, displayUser?.lastName]
            .filter(Boolean)
            .join(" ") ||
        displayUser?.name ||
        "Passenger";

    useEffect(() => {
        if (!token) return;

        let cancelled = false;
        setLoading(true);

        apiRequest(`/rides/history?page=${page}`, { token })
            .then((data) => {
                if (cancelled) return;
                setRides(data.rides || []);
                setPages(data.pagination?.pages || 0);
                setError("");
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
    }, [token, page]);

    return (
        <main className="min-h-dvh bg-[#F8FAF9] pb-[calc(100px+env(safe-area-inset-bottom))] text-slate-900">
            <MobileBottomNav role="PASSENGER" />
            <header className="bg-[#087F5B] px-5 pb-24 pt-[max(24px,env(safe-area-inset-top))] text-white">
                <div className="mx-auto flex max-w-xl items-center justify-between">
                    <Link
                        href="/passenger"
                        aria-label="Back to rides"
                        className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/15"
                    >
                        <ArrowLeft size={21} />
                    </Link>

                    <h1 className="text-lg font-bold">My Account</h1>

                    <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/15">
                        <UserRound size={21} />
                    </div>
                </div>

                <div className="mx-auto mt-8 max-w-xl">
                    <p className="text-sm text-white/75">{BRAND.name}</p>
                    <h2 className="mt-1 text-3xl font-extrabold">
                        Your profile
                    </h2>
                </div>
            </header>

            <div className="mx-auto -mt-16 max-w-xl space-y-5 px-4">
                <section className="rounded-[28px] bg-white p-5 shadow-lg shadow-slate-900/5">
                    <div className="flex items-center gap-4">
                        <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-emerald-100 text-2xl font-extrabold text-[#087F5B]">
                            {fullName.charAt(0).toUpperCase()}
                        </div>

                        <div className="min-w-0">
                            <h3 className="truncate text-xl font-extrabold">
                                {fullName}
                            </h3>
                            <p className="mt-1 truncate text-sm text-slate-500">
                                {user?.email}
                            </p>
                            <div className="mt-2 flex items-center gap-1 text-xs font-semibold text-[#087F5B]">
                                <ShieldCheck size={14} />
                                Passenger Account
                            </div>
                        </div>
                    </div>
                </section>

                <section className="rounded-[24px] bg-white p-5 shadow-sm">
                    <div className="mb-5 flex items-center gap-3">
                        <History size={22} className="text-[#087F5B]" />
                        <h3 className="text-lg font-extrabold">Ride History</h3>
                    </div>

                    {loading && (
                        <p className="py-5 text-center text-sm text-slate-500">
                            Loading rides...
                        </p>
                    )}

                    {error && (
                        <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-600">
                            {error}
                        </p>
                    )}

                    {!loading && !error && rides.length === 0 && (
                        <div className="py-8 text-center">
                            <CarFront className="mx-auto text-[#087F5B]" size={34} />
                            <p className="mt-3 font-semibold">No rides yet</p>
                            <p className="mt-1 text-sm text-slate-500">
                                Your trips will appear here.
                            </p>
                        </div>
                    )}

                    {!loading && rides.map((ride) => (
                        <div
                            key={ride._id}
                            className="border-b border-slate-100 py-4 last:border-0"
                        >
                            {ride.status === "TRIP_COMPLETED" && (
                                <Link
                                    href={`/passenger/receipt?rideId=${encodeURIComponent(ride._id)}`}
                                    className="mb-3 flex items-center justify-between rounded-xl bg-emerald-50 px-4 py-3 text-sm font-bold text-[#087F5B]"
                                >
                                    <span>View Trip Receipt</span>
                                    <ChevronRight size={18} />
                                </Link>
                            )}
                            <div className="flex items-start justify-between gap-3">
                                <div>
                                    <p className="font-bold">
                                        {ride.vehicleType?.replaceAll("_", " ")}
                                    </p>
                                    <p className="mt-1 flex items-center gap-1 text-xs text-slate-500">
                                        <Clock3 size={13} />
                                        {formatDate(ride.createdAt)}
                                    </p>
                                </div>

                                <p className="font-extrabold text-[#087F5B]">
                                    {formatFare(ride)}
                                </p>
                            </div>

                            <div className="mt-3 flex items-center justify-between">
                                <span className="rounded-lg bg-slate-100 px-3 py-1 text-xs font-semibold">
                                    {ride.status?.replaceAll("_", " ")}
                                </span>
                                <span className="text-xs text-slate-500">
                                    {ride.distance ?? "—"} km
                                </span>
                            </div>
                        </div>
                    ))}

                    {pages > 1 && (
                        <div className="mt-5 flex items-center justify-between">
                            <button
                                type="button"
                                disabled={loading || page === 1}
                                onClick={() => setPage((p) => p - 1)}
                                className="rounded-xl border px-4 py-2 text-sm disabled:opacity-40"
                            >
                                Previous
                            </button>

                            <span className="text-xs text-slate-500">
                                Page {page} of {pages}
                            </span>

                            <button
                                type="button"
                                disabled={loading || page >= pages}
                                onClick={() => setPage((p) => p + 1)}
                                className="rounded-xl border px-4 py-2 text-sm disabled:opacity-40"
                            >
                                Next
                            </button>
                        </div>
                    )}
                </section>

                <section className="rounded-[24px] bg-white p-5 shadow-sm">
                    <h3 className="mb-4 text-lg font-extrabold">
                        Account Settings
                    </h3>

                    <div className="flex items-center gap-3 border-b py-4">
                        <Mail size={20} className="text-[#087F5B]" />
                        <div className="min-w-0 flex-1">
                            <p className="text-sm font-semibold">Email Address</p>
                            <p className="truncate text-xs text-slate-500">
                                {user?.email}
                            </p>
                        </div>
                    </div>

                    <div className="flex items-center gap-3 border-b py-4">
                        <Star size={20} className="text-[#087F5B]" />
                        <div className="flex-1">
                            <p className="text-sm font-semibold">My Ratings & Reviews</p>
                            <p className="text-xs text-slate-500">
                                Available after ratings integration
                            </p>
                        </div>
                    </div>

                    <Link
                        href="/passenger/profile"
                        className="flex items-center gap-3 border-b py-4"
                    >
                        <Settings2 size={20} className="text-[#087F5B]" />
                        <div className="flex-1">
                            <p className="text-sm font-semibold">Personal Information</p>
                            <p className="text-xs text-slate-500">
                                Edit your name and account details
                            </p>
                        </div>
                        <ChevronRight size={18} className="text-slate-400" />
                    </Link>

                    <div className="flex items-center gap-3 py-4">
                        <Headphones size={20} className="text-[#087F5B]" />
                        <div className="flex-1">
                            <p className="text-sm font-semibold">Help & Support</p>
                            <p className="text-xs text-slate-500">
                                Support centre integration pending
                            </p>
                        </div>
                    </div>
                </section>

                <button
                    type="button"
                    onClick={logout}
                    className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl border border-red-100 bg-white font-bold text-red-600"
                >
                    <LogOut size={19} />
                    Sign Out
                </button>
            </div>
        </main>
    );
}
