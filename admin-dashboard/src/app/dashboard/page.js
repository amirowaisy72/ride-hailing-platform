
"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
    Activity, ArrowUpRight, Bike, CarFront, CheckCircle2,
    CircleDollarSign, Clock3, LayoutDashboard,
    RefreshCw, Route, ShieldCheck, Users, Wallet,
} from "lucide-react";

import AdminShell from "@/components/AdminShell";
import { authenticatedAdminRequest } from "@/lib/adminSession";

const money = (value) =>
    `PKR ${Number(value ?? 0).toLocaleString("en-PK")}`;

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
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadOverview();
    }, [loadOverview]);

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
