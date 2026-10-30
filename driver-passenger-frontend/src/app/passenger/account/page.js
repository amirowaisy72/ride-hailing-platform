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
import { useLanguage } from "@/components/i18n/LanguageProvider";
import { apiRequest } from "@/lib/api";
import { BRAND } from "@/config/brand";
import MobileBottomNav from "@/components/MobileBottomNav";
import ThemeSelector from "@/components/theme/ThemeSelector";
import LanguageSelector from "@/components/i18n/LanguageSelector";
import ProfilePicture from "@/components/ProfilePicture";

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
    const { user, token, logout, switchMode } = useAuth();
    const { t } = useLanguage();
    const [driver, setDriver] = useState(null);
    const [switching, setSwitching] = useState(false);
    const [driverError, setDriverError] = useState("");
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

    useEffect(() => {
        if (!token) return;

        apiRequest("/drivers/me/status", { token })
            .then((data) => setDriver(data.driver))
            .catch((error) => {
                if (error.status !== 404) {
                    console.error("Driver status:", error.message);
                }
            });
    }, [token]);

    async function handleDriverAction() {
        setSwitching(true);
        setDriverError("");

        try {
            if (!driver) {
                const data = await apiRequest("/drivers/register", {
                    method: "POST",
                    token,
                });
                setDriver(data.driver);
            } else if (driver.verificationStatus === "APPROVED") {
                await switchMode("DRIVER");
                window.location.replace("/driver");
            }
        } catch (error) {
            setDriverError(error.message);
        } finally {
            setSwitching(false);
        }
    }

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
        t("account.passengerFallback");

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
        <main className="min-h-dvh bg-pd-bg pb-[calc(100px+env(safe-area-inset-bottom))] text-pd-text">
            <MobileBottomNav role="PASSENGER" />
            <header className="bg-[#087F5B] px-5 pb-24 pt-[max(24px,env(safe-area-inset-top))] text-white">
                <div className="mx-auto flex max-w-xl items-center justify-between">
                    <Link
                        href="/passenger"
                        aria-label={t("account.backToRides")}
                        className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/15"
                    >
                        <ArrowLeft size={21} />
                    </Link>

                    <h1 className="text-lg font-bold">{t("account.myAccount")}</h1>

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
                <section className="rounded-[28px] bg-pd-surface p-5 shadow-lg shadow-slate-900/5">
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
                            <h3 className="truncate text-xl font-extrabold">
                                {fullName}
                            </h3>
                            <p className="mt-1 truncate text-sm text-pd-muted">
                                {user?.email}
                            </p>
                            <div className="mt-2 flex items-center gap-1 text-xs font-semibold text-[#087F5B]">
                                <ShieldCheck size={14} />
                                Passenger Account
                            </div>
                        </div>
                    </div>
                </section>

                <section className="rounded-2xl bg-pd-surface p-5 shadow-sm">
                    <h3 className="font-bold">{t("account.driverAccount")}</h3>
                    <p className="mt-2 text-sm text-pd-muted">
                        {driver
                            ? `Status: ${driver.verificationStatus}`
                            : t("account.earnDriver")}
                    </p>

                    {driver?.rejectionReason && (
                        <p className="mt-2 text-sm text-pd-danger">
                            {driver.rejectionReason}
                        </p>
                    )}

                    {driverError && (
                        <p className="mt-2 text-sm text-pd-danger">
                            {driverError}
                        </p>
                    )}

                    {(!driver || driver.verificationStatus === "APPROVED") && (
                        <button
                            type="button"
                            disabled={switching}
                            onClick={handleDriverAction}
                            className="mt-4 w-full rounded-xl bg-[#087F5B] p-3 font-bold text-white disabled:opacity-50"
                        >
                            {switching
                                ? t("account.pleaseWait")
                                : driver
                                    ? t("account.switchToDriver")
                                    : t("account.becomeDriver")}
                        </button>
                    )}

                    {driver && driver.verificationStatus !== "APPROVED" && (
                        <Link
                            href="/driver/documents"
                            className="mt-4 block rounded-xl bg-pd-success-soft p-3 text-center font-bold text-[#087F5B]"
                        >
                            Manage Driver Documents
                        </Link>
                    )}
                </section>

                <section className="rounded-[24px] bg-pd-surface p-5 shadow-sm">
                    <div className="mb-5 flex items-center gap-3">
                        <History size={22} className="text-[#087F5B]" />
                        <h3 className="text-lg font-extrabold">{t("account.rideHistory")}</h3>
                    </div>

                    {loading && (
                        <p className="py-5 text-center text-sm text-pd-muted">
                            Loading rides...
                        </p>
                    )}

                    {error && (
                        <p role="alert" className="rounded-xl bg-pd-danger-soft p-3 text-sm text-pd-danger">
                            {error}
                        </p>
                    )}

                    {!loading && !error && rides.length === 0 && (
                        <div className="py-8 text-center">
                            <CarFront className="mx-auto text-[#087F5B]" size={34} />
                            <p className="mt-3 font-semibold">{t("account.noRides")}</p>
                            <p className="mt-1 text-sm text-pd-muted">
                                Your trips will appear here.
                            </p>
                        </div>
                    )}

                    {!loading && rides.map((ride) => (
                        <div
                            key={ride._id}
                            className="border-b border-pd-line py-4 last:border-0"
                        >
                            {ride.status === "TRIP_COMPLETED" && (
                                <Link
                                    href={`/passenger/receipt?rideId=${encodeURIComponent(ride._id)}`}
                                    className="mb-3 flex items-center justify-between rounded-xl bg-pd-success-soft px-4 py-3 text-sm font-bold text-[#087F5B]"
                                >
                                    <span>{t("account.viewReceipt")}</span>
                                    <ChevronRight size={18} />
                                </Link>
                            )}
                            <div className="flex items-start justify-between gap-3">
                                <div>
                                    <p className="font-bold">
                                        {ride.vehicleType?.replaceAll("_", " ")}
                                    </p>
                                    <p className="mt-1 flex items-center gap-1 text-xs text-pd-muted">
                                        <Clock3 size={13} />
                                        {formatDate(ride.createdAt)}
                                    </p>
                                </div>

                                <p className="font-extrabold text-[#087F5B]">
                                    {formatFare(ride)}
                                </p>
                            </div>

                            <div className="mt-3 flex items-center justify-between">
                                <span className="rounded-lg bg-pd-surface-2 px-3 py-1 text-xs font-semibold">
                                    {ride.status?.replaceAll("_", " ")}
                                </span>
                                <span className="text-xs text-pd-muted">
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

                            <span className="text-xs text-pd-muted">
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

                <section className="rounded-[24px] bg-pd-surface p-5 shadow-sm">
                    <h3 className="mb-4 text-lg font-extrabold">
                        Account Settings
                    </h3>

                    <div className="flex items-center gap-3 border-b py-4">
                        <Mail size={20} className="text-[#087F5B]" />
                        <div className="min-w-0 flex-1">
                            <p className="text-sm font-semibold">{t("account.email")}</p>
                            <p className="truncate text-xs text-pd-muted">
                                {user?.email}
                            </p>
                        </div>
                    </div>

                    <div className="flex items-center gap-3 border-b py-4">
                        <Star size={20} className="text-[#087F5B]" />
                        <div className="flex-1">
                            <p className="text-sm font-semibold">{t("account.myRatings")}</p>
                            <p className="text-xs text-pd-muted">
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
                            <p className="text-sm font-semibold">{t("account.personalInfo")}</p>
                            <p className="text-xs text-pd-muted">
                                Edit your name and account details
                            </p>
                        </div>
                        <ChevronRight size={18} className="text-pd-faint" />
                    </Link>

                    <Link
                        href="/passenger/complaints"
                        className="flex items-center gap-3 py-4"
                    >
                        <Headphones size={20} className="text-[#087F5B]" />
                        <div className="flex-1">
                            <p className="text-sm font-semibold">{t("account.helpComplaints")}</p>
                            <p className="text-xs text-pd-muted">
                                File a complaint or track an existing one
                            </p>
                        </div>
                        <ChevronRight size={18} className="text-pd-faint" />
                    </Link>
                </section>

                <ThemeSelector />
                <LanguageSelector />

                <button
                    type="button"
                    onClick={logout}
                    className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl border border-red-100 bg-pd-surface font-bold text-pd-danger"
                >
                    <LogOut size={19} />
                    {t("account.signOut")}
                </button>
            </div>
        </main>
    );
}
