
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
    ArrowLeft, CarFront, Clock3, History,
    LogOut, ShieldCheck, Star, UserRound,
    Wallet, Settings2,
} from "lucide-react";
import AuthGuard from "@/components/AuthGuard";
import { useAuth } from "@/context/AuthContext";
import { apiRequest } from "@/lib/api";
import { BRAND } from "@/config/brand";
import MobileBottomNav from "@/components/MobileBottomNav";

export default function DriverAccountPage() {
    return (
        <AuthGuard role="DRIVER">
            <DriverAccount />
        </AuthGuard>
    );
}

function DriverAccount() {
    const { user, token, logout } = useAuth();
    const [accountUser, setAccountUser] = useState(null);
    const [rides, setRides] = useState([]);
    const [page, setPage] = useState(1);
    const [pages, setPages] = useState(0);
    const [driver, setDriver] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    const displayUser = accountUser || user;

    const name = [displayUser?.firstName, displayUser?.lastName]
        .filter(Boolean)
        .join(" ") || displayUser?.name || "Driver";

    useEffect(() => {
        if (!token) return;
        let cancelled = false;
        setLoading(true);

        Promise.all([
            apiRequest(`/drivers/me/history?page=${page}`, { token }),
            apiRequest("/drivers/me/status", { token }),
            apiRequest("/account/me", { token }),
        ])
            .then(([history, status, account]) => {
                if (cancelled) return;
                setRides(history.rides || []);
                setPages(history.pagination?.pages || 0);
                setDriver(status.driver);
                setAccountUser(account.user);
                setError("");
            })
            .catch((err) => {
                if (!cancelled) setError(err.message);
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });

        return () => { cancelled = true; };
    }, [token, page]);

    const completed = rides.filter(
        (ride) => ride.status === "TRIP_COMPLETED"
    );

    return (
        <main className="min-h-dvh bg-[#F8FAF9] pb-[calc(100px+env(safe-area-inset-bottom))] text-slate-900">
            <MobileBottomNav role="DRIVER" />
            <header className="bg-[#087F5B] px-5 pb-24 pt-[max(24px,env(safe-area-inset-top))] text-white">
                <div className="mx-auto flex max-w-xl items-center justify-between">
                    <Link href="/driver" aria-label="Back" className="rounded-xl bg-white/15 p-3">
                        <ArrowLeft size={20} />
                    </Link>
                    <h1 className="font-bold">Driver Account</h1>
                    <UserRound size={22} />
                </div>
                <div className="mx-auto mt-8 max-w-xl">
                    <p className="text-sm text-white/75">{BRAND.name}</p>
                    <h2 className="text-3xl font-extrabold">My Profile</h2>
                </div>
            </header>

            <div className="mx-auto -mt-16 max-w-xl space-y-5 px-4">
                <section className="rounded-[26px] bg-white p-5 shadow-lg shadow-slate-900/5">
                    <div className="flex items-center gap-4">
                        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-100 text-2xl font-bold text-[#087F5B]">
                            {name.charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                            <h3 className="truncate text-xl font-extrabold">{name}</h3>
                            <p className="truncate text-sm text-slate-500">{user?.email}</p>
                            <p className="mt-2 flex items-center gap-1 text-xs font-semibold text-[#087F5B]">
                                <ShieldCheck size={14} />
                                {driver?.verificationStatus || "Driver"}
                            </p>
                        </div>
                    </div>
                </section>

                <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-2xl bg-white p-4 shadow-sm">
                        <Star size={22} className="text-amber-500" />
                        <p className="mt-2 text-xl font-extrabold">
                            {driver?.ratingCount
                                ? Number(driver.rating).toFixed(1)
                                : "—"}
                        </p>
                        <p className="text-xs text-slate-500">Driver Rating</p>
                    </div>
                    <div className="rounded-2xl bg-white p-4 shadow-sm">
                        <CarFront size={22} className="text-[#087F5B]" />
                        <p className="mt-2 text-xl font-extrabold">
                            {driver?.isOnline ? "Online" : "Offline"}
                        </p>
                        <p className="text-xs text-slate-500">Current Status</p>
                    </div>
                </div>

                <section className="rounded-2xl bg-white p-5 shadow-sm">
                    <h3 className="mb-3 flex items-center gap-2 font-extrabold">
                        <History size={20} className="text-[#087F5B]" />
                        Ride History
                    </h3>

                    {loading && <p className="text-sm text-slate-500">Loading...</p>}
                    {error && <p role="alert" className="text-sm text-red-600">{error}</p>}

                    {!loading && !error && rides.length === 0 && (
                        <p className="py-6 text-center text-sm text-slate-500">
                            No trips yet.
                        </p>
                    )}

                    {rides.map((ride) => (
                        <div key={ride._id} className="border-b py-4 last:border-0">
                            <div className="flex justify-between gap-3">
                                <div>
                                    <p className="font-bold">
                                        {ride.vehicleType?.replaceAll("_", " ")}
                                    </p>
                                    <p className="mt-1 flex items-center gap-1 text-xs text-slate-500">
                                        <Clock3 size={13} />
                                        {new Date(ride.createdAt).toLocaleDateString("en-PK")}
                                    </p>
                                </div>
                                <p className="font-bold text-[#087F5B]">
                                    PKR {Number(ride.finalPrice ?? ride.requestedPrice).toLocaleString("en-PK")}
                                </p>
                            </div>
                            <p className="mt-2 text-xs text-slate-500">
                                {ride.status.replaceAll("_", " ")}
                                {" · "}
                                {ride.distance} km
                            </p>
                        </div>
                    ))}

                    {pages > 1 && (
                        <div className="mt-4 flex items-center justify-between">
                            <button disabled={page <= 1 || loading} onClick={() => setPage(page - 1)} className="rounded-xl border px-4 py-2 disabled:opacity-40">
                                Previous
                            </button>
                            <span className="text-xs">Page {page} / {pages}</span>
                            <button disabled={page >= pages || loading} onClick={() => setPage(page + 1)} className="rounded-xl border px-4 py-2 disabled:opacity-40">
                                Next
                            </button>
                        </div>
                    )}
                </section>

                <section className="rounded-2xl bg-white p-5 shadow-sm">
                    <h3 className="mb-4 font-extrabold">Account & Settings</h3>
                    <div className="flex items-center gap-3 border-b py-3">
                        <Wallet size={20} className="text-[#087F5B]" />
                        <span className="text-sm">Wallet & Earnings — Coming Soon</span>
                    </div>
                    <Link
                        href="/driver/profile"
                        className="flex items-center gap-3 py-3"
                    >
                        <Settings2 size={20} className="text-[#087F5B]" />
                        <span className="flex-1 text-sm font-semibold">
                            Edit Personal Information
                        </span>
                        <span className="text-xs text-[#087F5B]">Edit →</span>
                    </Link>
                </section>

                <button
                    type="button"
                    onClick={logout}
                    className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl border border-red-100 bg-white font-bold text-red-600"
                >
                    <LogOut size={18} /> Sign Out
                </button>
            </div>
        </main>
    );
}
