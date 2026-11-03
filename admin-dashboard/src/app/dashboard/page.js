"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
    Activity, ArrowUpRight, Bike, CarFront, CheckCircle2,
    CircleDollarSign, Clock3, FileCheck, Flag, LayoutDashboard,
    MessageSquare, RefreshCw, Route, ShieldCheck, Smartphone,
    Users, Wallet,
} from "lucide-react";

import AdminShell from "@/components/AdminShell";
import { authenticatedAdminRequest } from "@/lib/adminSession";

const money = (value) =>
    `PKR ${Number(value ?? 0).toLocaleString("en-PK")}`;

const snippet = (text, length = 70) => {
    const value = String(text || "");
    return value.length > length ? `${value.slice(0, length)}…` : value;
};

// Freshness of a driver's last location update ("1 min ago"),
// for the Drivers Online Now card.
const timeAgo = (value) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const minutes = Math.floor((Date.now() - date.getTime()) / 60000);
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.floor(minutes / 60);
    return `${hours} hour${hours === 1 ? "" : "s"} ago`;
};

// "More people on latest version" is measured against the last
// time THIS browser loaded the Important section — stored
// locally, never sent anywhere. A new latest version resets it.
const VERSION_SEEN_KEY = "important_last_version";

// Important-section "only new items" tracking, localStorage only,
// never sent to the server (same pattern as VERSION_SEEN_KEY).
// A card click marks its currently shown recent items as seen;
// Refresh never marks anything as seen.
const COMPLAINTS_SEEN_KEY = "important_seen_complaints";
const FEEDBACK_SEEN_KEY = "important_seen_feedback";

function readSeenIds(key) {
    if (typeof window === "undefined") return [];
    try {
        const raw = window.localStorage.getItem(key);
        const parsed = raw ? JSON.parse(raw) : null;
        return Array.isArray(parsed) ? parsed.map((id) => String(id)) : [];
    } catch {
        return [];
    }
}

function markSeen(key, items) {
    if (typeof window === "undefined") return;
    try {
        window.localStorage.setItem(
            key,
            JSON.stringify((items || []).map((item) => String(item.id)))
        );
    } catch {
        // Seen state is best-effort only.
    }
}

function unseenItems(items, seenIds) {
    const seen = new Set(seenIds || []);
    return (items || []).filter((item) => !seen.has(String(item.id)));
}

// Registration cards use a "last clicked" timestamp instead of an
// id list: registrations can be dozens per day, and an id list
// capped at the 5 recent items would hide the rest. A card click
// stamps now; the backend then counts only registrations after
// that stamp, so a viewed card shows 0 until a new registration
// arrives. Refresh never stamps anything.
const PASSENGERS_SEEN_AT_KEY = "important_seen_passengers_at";
const DRIVERS_SEEN_AT_KEY = "important_seen_drivers_at";

function readSeenAt(key) {
    if (typeof window === "undefined") return null;
    try {
        return window.localStorage.getItem(key);
    } catch {
        return null;
    }
}

function markSeenAt(key) {
    if (typeof window === "undefined") return;
    try {
        window.localStorage.setItem(key, new Date().toISOString());
    } catch {
        // Seen state is best-effort only.
    }
}

function timeAgo(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const minutes = Math.floor((Date.now() - date.getTime()) / 60000);
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
    const days = Math.floor(hours / 24);
    return `${days} day${days === 1 ? "" : "s"} ago`;
}

function versionDelta(latest) {
    if (typeof window === "undefined" || !latest) return null;

    try {
        const raw = window.localStorage.getItem(VERSION_SEEN_KEY);
        const seen = raw ? JSON.parse(raw) : null;
        window.localStorage.setItem(
            VERSION_SEEN_KEY,
            JSON.stringify({
                code: latest.latestVersionCode,
                count: latest.latestUsers,
            })
        );

        if (!seen || seen.code !== latest.latestVersionCode) return null;

        const delta = latest.latestUsers - Number(seen.count || 0);
        return delta > 0 ? delta : null;
    } catch {
        return null;
    }
}

const statCards = [
    { key: "passengers", label: "Passengers", icon: Users },
    { key: "drivers", label: "Registered Drivers", icon: CarFront },
    { key: "approvedDrivers", label: "Approved Drivers", icon: ShieldCheck },
    { key: "pendingDrivers", label: "Pending Drivers", icon: Clock3 },
    { key: "vehicles", label: "Registered Vehicles", icon: Bike },
    { key: "pendingVehicles", label: "Pending Vehicles", icon: Clock3 },
    { key: "totalRides", label: "Total Rides", icon: Route },
    { key: "activeRides", label: "Active Rides", icon: Activity },
    { key: "completedRides", label: "Completed Rides", icon: CheckCircle2 },
];

const modules = [
    {
        title: "Driver Management",
        description: "Review driver accounts and documents",
        href: "/dashboard/drivers",
        icon: CarFront,
    },
    {
        title: "Vehicle Approvals",
        description: "Manage registered vehicles",
        href: "/dashboard/vehicles",
        icon: Bike,
    },
    {
        title: "Passengers",
        description: "Search passenger accounts",
        href: "/dashboard/passengers",
        icon: Users,
    },
    {
        title: "Ride Management",
        description: "Monitor bookings and trip statuses",
        href: "/dashboard/rides",
        icon: Route,
    },
    {
        title: "Driver Wallets",
        description: "Inspect balances and ledger records",
        href: "/dashboard/wallets",
        icon: Wallet,
    },
    {
        title: "Commission Settings",
        description: "Configure platform commission",
        href: "/dashboard/commission",
        icon: CircleDollarSign,
    },
    {
        title: "Settlements & Audit",
        description: "Track pending and settled commissions",
        href: "/dashboard/settlements",
        icon: ShieldCheck,
    },
];

export default function DashboardPage() {
    const [overview, setOverview] = useState(null);
    const [important, setImportant] = useState(null);
    const [importantDelta, setImportantDelta] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [lastUpdated, setLastUpdated] = useState(null);

    const loadOverview = useCallback(async () => {
        setLoading(true);
        setError("");

        try {
            const result = await authenticatedAdminRequest(
                "/admin/operations/overview"
            );

            setOverview(result.overview);
            setLastUpdated(new Date());
        } catch (err) {
            setError(err.message);
        }

        // Important items load independently: if they fail, the
        // rest of the overview still shows.
        try {
            // Registration windows: last card click, or 24h ago on
            // first visit (backend falls back the same way).
            const dayAgo = new Date(
                Date.now() - 24 * 60 * 60 * 1000
            ).toISOString();
            const params = new URLSearchParams({
                passengerSince: readSeenAt(PASSENGERS_SEEN_AT_KEY) || dayAgo,
                driverSince: readSeenAt(DRIVERS_SEEN_AT_KEY) || dayAgo,
            });
            const result = await authenticatedAdminRequest(
                `/admin/operations/important?${params.toString()}`
            );

            setImportant(result.important);
            setImportantDelta(versionDelta(result.important?.appVersion));
        } catch {
            setImportant(null);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadOverview();
    }, [loadOverview]);

    // Only items not seen on the last card click count as "new".
    // On first visit (nothing stored) every recent item is new.
    const complaintRecent = important?.openComplaints?.recent || [];
    const feedbackRecent = important?.newFeedback?.recent || [];
    const newComplaints = unseenItems(
        complaintRecent,
        readSeenIds(COMPLAINTS_SEEN_KEY)
    );
    const newFeedback = unseenItems(
        feedbackRecent,
        readSeenIds(FEEDBACK_SEEN_KEY)
    );

    // Pending-review driver documents only. Prefer the new additive
    // backend field; fall back to the old pending total (no driver
    // list) so an older backend never shows approved documents here.
    const pendingDocData = important?.pendingDriverDocuments || {
        count: important?.newDriverDocuments?.pendingCount ?? 0,
        drivers: [],
    };

    return (
        <AdminShell title="Overview">
            <div className="space-y-7">
                <section className="rounded-[26px] bg-[#087F5B] p-7 text-white lg:p-9">
                    <div className="flex flex-wrap items-start justify-between gap-5">
                        <div>
                            <p className="flex items-center gap-2 text-sm font-semibold text-white/75">
                                <LayoutDashboard size={18} />
                                Platform Operations
                            </p>

                            <h2 className="mt-4 text-3xl font-extrabold">
                                Platform Control Centre
                            </h2>

                            <p className="mt-3 max-w-xl text-sm leading-6 text-white/75">
                                Monitor passengers, drivers, vehicles, rides
                                and recorded platform finances.
                            </p>
                        </div>

                        <button
                            type="button"
                            onClick={loadOverview}
                            disabled={loading}
                            className="flex items-center gap-2 rounded-xl bg-white/15 px-5 py-3 text-sm font-bold disabled:opacity-50"
                        >
                            <RefreshCw
                                size={18}
                                className={loading ? "animate-spin" : ""}
                            />
                            Refresh Statistics
                        </button>
                    </div>

                    {lastUpdated && (
                        <p className="mt-6 text-xs text-white/60">
                            Last refreshed: {lastUpdated.toLocaleTimeString("en-PK")}
                        </p>
                    )}
                </section>

                {error && (
                    <p
                        role="alert"
                        className="rounded-2xl border border-red-100 bg-red-50 p-4 text-sm text-red-600"
                    >
                        Unable to load overview: {error}
                    </p>
                )}

                {important && (
                    <section>
                        <div className="mb-4 flex items-center justify-between gap-4">
                            <h3 className="text-xl font-extrabold">
                                Important
                            </h3>

                            <button
                                type="button"
                                onClick={loadOverview}
                                disabled={loading}
                                className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-[#087F5B] shadow-sm disabled:opacity-50"
                            >
                                <RefreshCw
                                    size={15}
                                    className={loading ? "animate-spin" : ""}
                                />
                                Refresh
                            </button>
                        </div>

                        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                            <Link
                                href="/dashboard/complaints"
                                onClick={() =>
                                    markSeen(COMPLAINTS_SEEN_KEY, complaintRecent)
                                }
                                className="group rounded-[22px] border border-red-100 bg-white p-4 shadow-sm transition hover:border-red-200 hover:shadow-md"
                            >
                                <div className="flex items-start justify-between">
                                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-50 text-red-600">
                                        <Flag size={20} />
                                    </div>
                                    <ArrowUpRight size={16} className="text-slate-400 group-hover:text-red-600" />
                                </div>
                                <p className="mt-3 text-sm text-slate-500">
                                    Open Complaints
                                </p>
                                <p className="mt-1 text-2xl font-extrabold">
                                    {important.openComplaints.count}
                                </p>
                                <p className="mt-2 text-xs leading-5 text-slate-500">
                                    {newComplaints.length > 0 ? (
                                        <>
                                            <span className="block font-bold text-red-600">
                                                +{newComplaints.length} new complaint
                                                {newComplaints.length === 1 ? "" : "s"}
                                            </span>
                                            {newComplaints.slice(0, 2).map((item) => (
                                                <span key={item.id} className="block truncate">
                                                    {item.name} · {item.category}
                                                </span>
                                            ))}
                                        </>
                                    ) : (
                                        "No new complaints yet."
                                    )}
                                </p>
                            </Link>

                            <Link
                                href="/dashboard/feedbacks"
                                onClick={() =>
                                    markSeen(FEEDBACK_SEEN_KEY, feedbackRecent)
                                }
                                className="group rounded-[22px] border border-slate-100 bg-white p-4 shadow-sm transition hover:border-emerald-200 hover:shadow-md"
                            >
                                <div className="flex items-start justify-between">
                                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                                        <MessageSquare size={20} />
                                    </div>
                                    <ArrowUpRight size={16} className="text-slate-400 group-hover:text-[#087F5B]" />
                                </div>
                                <p className="mt-3 text-sm text-slate-500">
                                    New Feedback
                                </p>
                                <p className="mt-1 text-2xl font-extrabold">
                                    {important.newFeedback.count}
                                </p>
                                <p className="mt-2 text-xs leading-5 text-slate-500">
                                    {newFeedback.length > 0 ? (
                                        <>
                                            <span className="block font-bold text-[#087F5B]">
                                                +{newFeedback.length} new feedback
                                            </span>
                                            {newFeedback.slice(0, 2).map((item) => (
                                                <span key={item.id} className="block truncate">
                                                    {item.name}: {snippet(item.message, 60)}
                                                </span>
                                            ))}
                                        </>
                                    ) : (
                                        "No new feedback yet."
                                    )}
                                </p>
                            </Link>

                            <Link
                                href="/dashboard/vehicles"
                                className="group rounded-[22px] border border-slate-100 bg-white p-4 shadow-sm transition hover:border-emerald-200 hover:shadow-md"
                            >
                                <div className="flex items-start justify-between">
                                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-[#087F5B]">
                                        <Bike size={20} />
                                    </div>
                                    <ArrowUpRight size={16} className="text-slate-400 group-hover:text-[#087F5B]" />
                                </div>
                                <p className="mt-3 text-sm text-slate-500">
                                    Vehicles Pending Verification
                                </p>
                                <p className="mt-1 text-2xl font-extrabold">
                                    {overview?.pendingVehicles ?? "—"}
                                </p>
                                <p className="mt-2 text-xs leading-5 text-slate-500">
                                    Vehicles waiting for verification.
                                </p>
                            </Link>

                            <Link
                                href="/dashboard/drivers"
                                className="group rounded-[22px] border border-slate-100 bg-white p-4 shadow-sm transition hover:border-emerald-200 hover:shadow-md"
                            >
                                <div className="flex items-start justify-between">
                                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
                                        <FileCheck size={20} />
                                    </div>
                                    <ArrowUpRight size={16} className="text-slate-400 group-hover:text-[#087F5B]" />
                                </div>
                                <p className="mt-3 text-sm text-slate-500">
                                    Driver Documents Pending Review
                                </p>
                                <p className="mt-1 text-2xl font-extrabold">
                                    {pendingDocData.count}
                                </p>
                                <p className="mt-2 text-xs leading-5 text-slate-500">
                                    {pendingDocData.count === 0 ? (
                                        "No documents pending review."
                                    ) : (
                                        <>
                                            {pendingDocData.drivers.slice(0, 2).map((driver, index) => (
                                                <span key={`${driver.name}-${index}`} className="block truncate">
                                                    {driver.name} · {driver.count} document(s)
                                                </span>
                                            ))}
                                            <span className="block">
                                                {pendingDocData.count} document(s) pending review.
                                            </span>
                                        </>
                                    )}
                                </p>
                            </Link>

                            <Link
                                href="/dashboard/passengers"
                                onClick={() => markSeenAt(PASSENGERS_SEEN_AT_KEY)}
                                className="group rounded-[22px] border border-slate-100 bg-white p-4 shadow-sm transition hover:border-emerald-200 hover:shadow-md"
                            >
                                <div className="flex items-start justify-between">
                                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                                        <Users size={20} />
                                    </div>
                                    <ArrowUpRight size={16} className="text-slate-400 group-hover:text-[#087F5B]" />
                                </div>
                                <p className="mt-3 text-sm text-slate-500">
                                    New Passengers
                                </p>
                                <p className="mt-1 text-2xl font-extrabold">
                                    {important.newPassengers?.count ?? 0}
                                </p>
                                <p className="mt-2 text-xs leading-5 text-slate-500">
                                    {(important.newPassengers?.count ?? 0) === 0 ? (
                                        "No new passengers yet."
                                    ) : (
                                        <>
                                            <span className="block font-bold text-[#087F5B]">
                                                +{important.newPassengers.count} new passenger
                                                {important.newPassengers.count === 1 ? "" : "s"} registered
                                            </span>
                                            {(important.newPassengers?.recent || []).slice(0, 2).map((item) => (
                                                <span key={item.id} className="block truncate">
                                                    {item.name} · {timeAgo(item.createdAt)}
                                                </span>
                                            ))}
                                        </>
                                    )}
                                </p>
                            </Link>

                            <Link
                                href="/dashboard/drivers"
                                onClick={() => markSeenAt(DRIVERS_SEEN_AT_KEY)}
                                className="group rounded-[22px] border border-slate-100 bg-white p-4 shadow-sm transition hover:border-emerald-200 hover:shadow-md"
                            >
                                <div className="flex items-start justify-between">
                                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-[#087F5B]">
                                        <CarFront size={20} />
                                    </div>
                                    <ArrowUpRight size={16} className="text-slate-400 group-hover:text-[#087F5B]" />
                                </div>
                                <p className="mt-3 text-sm text-slate-500">
                                    New Drivers
                                </p>
                                <p className="mt-1 text-2xl font-extrabold">
                                    {important.newDrivers?.count ?? 0}
                                </p>
                                <p className="mt-2 text-xs leading-5 text-slate-500">
                                    {(important.newDrivers?.count ?? 0) === 0 ? (
                                        "No new drivers yet."
                                    ) : (
                                        <>
                                            <span className="block font-bold text-[#087F5B]">
                                                +{important.newDrivers.count} new driver
                                                {important.newDrivers.count === 1 ? "" : "s"} registered
                                            </span>
                                            {(important.newDrivers?.recent || []).slice(0, 2).map((item) => (
                                                <span key={item.id} className="block truncate">
                                                    {item.name} · {item.verificationStatus} · {timeAgo(item.createdAt)}
                                                </span>
                                            ))}
                                        </>
                                    )}
                                </p>
                            </Link>

                            <Link
                                href="/dashboard/rides"
                                className="group rounded-[22px] border border-slate-100 bg-white p-4 shadow-sm transition hover:border-emerald-200 hover:shadow-md"
                            >
                                <div className="flex items-start justify-between">
                                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-[#087F5B]">
                                        <Activity size={20} />
                                    </div>
                                    <ArrowUpRight size={16} className="text-slate-400 group-hover:text-[#087F5B]" />
                                </div>
                                <p className="mt-3 text-sm text-slate-500">
                                    Active Rides Right Now
                                </p>
                                <p className="mt-1 text-2xl font-extrabold">
                                    {important.activeRides.count}
                                </p>
                                <p className="mt-2 text-xs text-slate-500">
                                    Rides currently in progress.
                                </p>
                            </Link>

                            <Link
                                href="/dashboard/today-rides"
                                className="group rounded-[22px] border border-slate-100 bg-white p-4 shadow-sm transition hover:border-emerald-200 hover:shadow-md"
                            >
                                <div className="flex items-start justify-between">
                                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-[#087F5B]">
                                        <CheckCircle2 size={20} />
                                    </div>
                                    <ArrowUpRight size={16} className="text-slate-400 group-hover:text-[#087F5B]" />
                                </div>
                                <p className="mt-3 text-sm text-slate-500">
                                    Today&apos;s Completed Rides
                                </p>
                                <p className="mt-1 text-2xl font-extrabold">
                                    {important.todayCompletedRides?.count ?? 0}
                                </p>
                                <p className="mt-2 text-xs leading-5 text-slate-500">
                                    <span className="block">
                                        {(important.todayCompletedRides?.count ?? 0) === 0
                                            ? "No rides completed yet today."
                                            : `${important.todayCompletedRides.count} ride${important.todayCompletedRides.count === 1 ? "" : "s"} completed today.`}
                                    </span>
                                    <span className="block">
                                        {new Date().toLocaleDateString("en-PK", {
                                            timeZone: "Asia/Karachi",
                                            day: "numeric",
                                            month: "short",
                                            year: "numeric",
                                        })}
                                    </span>
                                </p>
                            </Link>

                            <Link
                                href="/dashboard/today-rides"
                                className="group rounded-[22px] border border-slate-100 bg-white p-4 shadow-sm transition hover:border-emerald-200 hover:shadow-md"
                            >
                                <div className="flex items-start justify-between">
                                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-50 text-violet-600">
                                        <CarFront size={20} />
                                    </div>
                                    <ArrowUpRight size={16} className="text-slate-400 group-hover:text-[#087F5B]" />
                                </div>
                                <p className="mt-3 text-sm text-slate-500">
                                    Drivers Online Now
                                </p>
                                <p className="mt-1 text-2xl font-extrabold">
                                    {important.onlineDrivers?.count ?? 0}
                                </p>
                                <p className="mt-2 text-xs leading-5 text-slate-500">
                                    {(important.onlineDrivers?.count ?? 0) === 0 ? (
                                        "No drivers online right now."
                                    ) : (
                                        <>
                                            <span className="block font-bold text-[#087F5B]">
                                                {important.onlineDrivers.availableCount} available for rides now.
                                            </span>
                                            {(important.onlineDrivers?.recent || []).slice(0, 2).map((item) => (
                                                <span key={item.id} className="block truncate">
                                                    {item.name} · {timeAgo(item.lastLocationUpdate)}
                                                </span>
                                            ))}
                                        </>
                                    )}
                                </p>
                            </Link>

                            <Link
                                href="/dashboard/app-version"
                                className="group rounded-[22px] border border-slate-100 bg-white p-4 shadow-sm transition hover:border-emerald-200 hover:shadow-md"
                            >
                                <div className="flex items-start justify-between">
                                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-50 text-violet-600">
                                        <Smartphone size={20} />
                                    </div>
                                    <ArrowUpRight size={16} className="text-slate-400 group-hover:text-[#087F5B]" />
                                </div>
                                <p className="mt-3 text-sm text-slate-500">
                                    Latest App Version
                                </p>
                                {important.appVersion ? (
                                    <>
                                        <p className="mt-1 text-2xl font-extrabold">
                                            {important.appVersion.latestVersionName}
                                        </p>
                                        <p className="mt-2 text-xs leading-5 text-slate-500">
                                            <span className="block">
                                                {important.appVersion.latestUsers} users on latest
                                                · {important.appVersion.unknownUsers} unknown.
                                            </span>
                                            {importantDelta !== null && (
                                                <span className="block font-bold text-[#087F5B]">
                                                    +{importantDelta} more people are on latest version now.
                                                </span>
                                            )}
                                        </p>
                                    </>
                                ) : (
                                    <p className="mt-2 text-xs text-slate-500">
                                        No latest version configured yet.
                                    </p>
                                )}
                            </Link>
                        </div>
                    </section>
                )}

                <section>
                    <h3 className="mb-4 text-xl font-extrabold">
                        Platform Statistics
                    </h3>

                    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                        {statCards.map(({ key, label, icon: Icon }) => (
                            <div
                                key={key}
                                className="rounded-[22px] border border-slate-100 bg-white p-5 shadow-sm"
                            >
                                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-50 text-[#087F5B]">
                                    <Icon size={24} />
                                </div>

                                <p className="mt-4 text-sm text-slate-500">
                                    {label}
                                </p>

                                <p className="mt-1 text-3xl font-extrabold">
                                    {loading || !overview ? "—" : overview[key] ?? 0}
                                </p>
                            </div>
                        ))}
                    </div>
                </section>

                <section>
                    <h3 className="mb-4 text-xl font-extrabold">
                        Recorded Financial Activity
                    </h3>

                    <div className="grid gap-4 md:grid-cols-2">
                        <div className="rounded-[24px] bg-white p-6 shadow-sm">
                            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                                <Wallet size={24} />
                            </div>

                            <p className="mt-4 text-sm text-slate-500">
                                Total Settled Cash Fares
                            </p>

                            <p className="mt-2 text-3xl font-extrabold">
                                {loading || !overview
                                    ? "—"
                                    : money(overview.totalSettledFares)}
                            </p>
                        </div>

                        <div className="rounded-[24px] bg-white p-6 shadow-sm">
                            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-50 text-[#087F5B]">
                                <CircleDollarSign size={24} />
                            </div>

                            <p className="mt-4 text-sm text-slate-500">
                                Total Recorded Commission
                            </p>

                            <p className="mt-2 text-3xl font-extrabold">
                                {loading || !overview
                                    ? "—"
                                    : money(overview.totalCommission)}
                            </p>
                        </div>
                    </div>

                    <p className="mt-3 text-xs text-slate-500">
                        Financial totals include SETTLED records only.
                        Pending commissions are excluded.
                    </p>
                </section>

                <section>
                    <h3 className="mb-4 text-xl font-extrabold">
                        Management Modules
                    </h3>

                    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                        {modules.map(({ title, description, href, icon: Icon }) => (
                            <Link
                                key={href}
                                href={href}
                                className="group rounded-[22px] border border-slate-100 bg-white p-6 shadow-sm transition hover:border-emerald-200 hover:shadow-md"
                            >
                                <div className="flex items-start justify-between">
                                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-50 text-[#087F5B]">
                                        <Icon size={23} />
                                    </div>

                                    <ArrowUpRight
                                        size={20}
                                        className="text-slate-400 group-hover:text-[#087F5B]"
                                    />
                                </div>

                                <h4 className="mt-5 font-extrabold">{title}</h4>

                                <p className="mt-2 text-sm leading-6 text-slate-500">
                                    {description}
                                </p>
                            </Link>
                        ))}
                    </div>
                </section>
            </div>
        </AdminShell>
    );
}

