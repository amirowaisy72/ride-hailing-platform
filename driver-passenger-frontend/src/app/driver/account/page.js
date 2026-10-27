"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
    ArrowLeft, CarFront, Clock3, History, LifeBuoy,
    LogOut, ShieldCheck, Star, UserRound,
    Wallet, Settings2,
} from "lucide-react";
import AuthGuard from "@/components/AuthGuard";
import { useAuth } from "@/context/AuthContext";
import { apiRequest } from "@/lib/api";
import { BRAND } from "@/config/brand";
import MobileBottomNav from "@/components/MobileBottomNav";
import ThemeSelector from "@/components/theme/ThemeSelector";
import ProfilePicture from "@/components/ProfilePicture";

export default function DriverAccountPage() {
    return (
        <AuthGuard role="DRIVER">
            <DriverAccount />
        </AuthGuard>
    );
}

function DriverAccount() {
    const { user, token, logout, switchMode } = useAuth();
    const [switchingMode, setSwitchingMode] = useState(false);
    const [modeError, setModeError] = useState("");
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
            apiRequest("/drivers/me/status", { token }),
            apiRequest("/account/me", { token }),
        ])
            .then(([status, account]) => {
                if (cancelled) return;
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
    }, [token]);

    const completed = rides.filter(
        (ride) => ride.status === "TRIP_COMPLETED"
    );

    return (
        <main className="driver-subpage min-h-dvh bg-[#F8FAF9] pb-[calc(100px+env(safe-area-inset-bottom))] text-slate-900">
            <MobileBottomNav role="DRIVER" />
            <header className="bg-[#087F5B] px-5 pb-8 pt-[max(24px,env(safe-area-inset-top))] text-white">
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

            <div className="relative z-10 mx-auto mt-4 max-w-xl space-y-5 px-4">
                <section className="rounded-[26px] bg-white p-5 shadow-lg shadow-slate-900/5">
                    <div className="flex items-center gap-4">
                        <ProfilePicture
                            token={token}
                            user={displayUser}
                            onUploaded={(profileImage) =>
                                setAccountUser((previous) => ({
                                    ...(previous || user),
                                    profileImage,
                                }))
                            }
                        />
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

                {false && (
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
                )}

                <section className="rounded-2xl bg-white p-5 shadow-sm">
                    <h3 className="mb-4 font-extrabold">Account & Settings</h3>
                    <Link
                        href="/driver/earnings"
                        className="flex items-center gap-3 border-b py-3"
                    >
                        <Wallet size={20} className="text-[#087F5B]" />
                        <span className="flex-1 text-sm font-semibold">
                            Wallet & Earnings
                        </span>
                        <span className="text-xs text-[#087F5B]">Open →</span>
                    </Link>
                    <Link
                        href="/driver/profile"
                        className="flex items-center gap-3 border-b py-3"
                    >
                        <Settings2 size={20} className="text-[#087F5B]" />
                        <span className="flex-1 text-sm font-semibold">
                            Edit Personal Information
                        </span>
                        <span className="text-xs text-[#087F5B]">Edit →</span>
                    </Link>
                    <Link
                        href="/driver/complaints"
                        className="flex items-center gap-3 py-3"
                    >
                        <LifeBuoy size={20} className="text-[#087F5B]" />
                        <span className="flex-1 text-sm font-semibold">
                            Help & Complaints
                        </span>
                        <span className="text-xs text-[#087F5B]">Open →</span>
                    </Link>
                </section>

                <section className="rounded-2xl bg-white p-5 shadow-sm">
                    <h3 className="font-extrabold">Account Mode</h3>

                    {modeError && (
                        <div
                            role="alert"
                            className="fixed left-1/2 top-6 z-[9999] w-max max-w-[90vw] -translate-x-1/2 rounded-xl bg-red-600 px-5 py-3 text-sm font-bold text-white shadow-xl"
                        >
                            {modeError}
                        </div>
                    )}

                    <button
                        type="button"
                        disabled={switchingMode}
                        onClick={async () => {
                            if (driver?.isOnline) {
                                setModeError("⚠️ Go Offline First");
                                return;
                            }

                            setSwitchingMode(true);
                            setSwitchingMode(true);
                            setModeError("");
                            try {
                                await switchMode("PASSENGER");
                                window.location.replace("/passenger");
                            } catch (error) {
                                setModeError(error.message);
                                setSwitchingMode(false);
                            }
                        }}
                        className="mt-4 w-full rounded-xl bg-[#087F5B] p-3 font-bold text-white disabled:opacity-50"
                    >
                        {switchingMode
                            ? "Switching..."
                            : "Switch to Passenger"}
                    </button>
                </section>

                <ThemeSelector />

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
