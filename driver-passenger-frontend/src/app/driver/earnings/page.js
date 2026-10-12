"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
    ArrowLeft,
    ArrowDownRight,
    ArrowUpRight,
    CheckCircle2,
    Clock3,
    RefreshCw,
    Wallet,
    Banknote,
    CarFront,
    ReceiptText,
    TrendingUp,
    ShieldCheck,
} from "lucide-react";

import AuthGuard from "@/components/AuthGuard";
import MobileBottomNav from "@/components/MobileBottomNav";
import { useAuth } from "@/context/AuthContext";
import { apiRequest } from "@/lib/api";

const money = (amount) =>
    `PKR ${Number(amount ?? 0).toLocaleString("en-PK")}`;

const formatDate = (value) =>
    value
        ? new Date(value).toLocaleString("en-PK", {
            day: "numeric",
            month: "short",
            hour: "numeric",
            minute: "2-digit",
        })
        : "—";

const transactionLabels = {
    TOP_UP: "Wallet Top-up",
    COMMISSION_DEBIT: "Ride Commission",
    REFUND: "Wallet Refund",
    ADMIN_ADJUSTMENT: "Admin Adjustment",
};

export default function DriverEarningsPage() {
    return (
        <AuthGuard role="DRIVER">
            <EarningsScreen />
        </AuthGuard>
    );
}

function EarningsScreen() {
    const { token } = useAuth();

    const [wallet, setWallet] = useState(null);
    const [transactions, setTransactions] = useState([]);
    const [summary, setSummary] = useState(null);
    const [recentTrips, setRecentTrips] = useState([]);

    const [activeTab, setActiveTab] = useState("transactions");
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState("");

    const loadData = useCallback(async (initial = false) => {
        if (!token) return;

        if (initial) setLoading(true);
        else setRefreshing(true);

        setError("");

        try {
            const [walletData, earningsData] = await Promise.all([
                apiRequest("/drivers/me/wallet", { token }),
                apiRequest("/drivers/me/earnings", { token }),
            ]);

            setWallet(walletData.wallet);
            setTransactions(walletData.transactions || []);
            setSummary(earningsData.summary);
            setRecentTrips(earningsData.recentTrips || []);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, [token]);

    useEffect(() => {
        loadData(true);
    }, [loadData]);

    const isCredit = (type, tx) =>
        type === "TOP_UP" ||
        type === "REFUND" ||
        (type === "ADMIN_ADJUSTMENT" &&
            Number(tx.balanceAfter) > Number(tx.balanceBefore));

    return (
        <main className="driver-subpage min-h-dvh bg-[#F7F9F8] pb-[calc(100px+env(safe-area-inset-bottom))] text-slate-900">
            <MobileBottomNav role="DRIVER" />

            <header className="bg-[#087F5B] px-5 pb-32 pt-[max(24px,env(safe-area-inset-top))] text-white">
                <div className="mx-auto flex max-w-xl items-center justify-between">
                    <Link
                        href="/driver"
                        aria-label="Back to dashboard"
                        className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/15"
                    >
                        <ArrowLeft size={20} />
                    </Link>

                    <h1 className="text-lg font-bold">Wallet & Earnings</h1>

                    <button
                        type="button"
                        onClick={() => loadData()}
                        disabled={refreshing || loading}
                        aria-label="Refresh wallet"
                        className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/15 disabled:opacity-50"
                    >
                        <RefreshCw size={20} className={refreshing ? "animate-spin" : ""} />
                    </button>
                </div>

                <div className="mx-auto mt-8 max-w-xl">
                    <p className="text-sm text-white/70">Your driving finances</p>
                    <h2 className="mt-1 text-3xl font-extrabold">
                        Earnings Overview
                    </h2>
                </div>
            </header>

            <div className="mx-auto -mt-24 max-w-xl space-y-5 px-4">
                <section className="relative overflow-hidden rounded-[28px] bg-white p-6 shadow-lg shadow-slate-900/10">
                    <div className="flex items-center justify-between">
                        <span className="flex items-center gap-2 text-sm font-semibold text-slate-500">
                            <Wallet size={19} className="text-[#087F5B]" />
                            Available Wallet Balance
                        </span>

                        <span className="rounded-full bg-emerald-50 px-3 py-1 text-[11px] font-bold text-[#087F5B]">
                            PKR
                        </span>
                    </div>

                    <p className="mt-5 text-4xl font-extrabold tracking-tight">
                        {loading ? "Loading..." : money(wallet?.balance)}
                    </p>

                    <p className="mt-2 text-xs text-slate-500">
                        Prepaid balance for platform commissions
                    </p>

                    <div className="mt-6 rounded-xl bg-emerald-50 p-4">
                        <p className="flex items-center gap-2 text-xs font-semibold text-[#065F46]">
                            <ShieldCheck size={16} />
                            Wallet transactions are recorded by the platform
                        </p>
                    </div>
                </section>

                {error && (
                    <div
                        role="alert"
                        className="rounded-2xl border border-red-100 bg-red-50 p-4 text-sm text-red-600"
                    >
                        <p>{error}</p>
                        <button
                            type="button"
                            onClick={() => loadData()}
                            className="mt-2 font-bold underline"
                        >
                            Try Again
                        </button>
                    </div>
                )}

                <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-[22px] bg-white p-5 shadow-sm">
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-[#087F5B]">
                            <TrendingUp size={21} />
                        </div>
                        <p className="mt-4 text-xs text-slate-500">
                            Net Trip Earnings
                        </p>
                        <p className="mt-1 text-xl font-extrabold">
                            {money(summary?.netEarnings)}
                        </p>
                    </div>

                    <div className="rounded-[22px] bg-white p-5 shadow-sm">
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
                            <CarFront size={21} />
                        </div>
                        <p className="mt-4 text-xs text-slate-500">
                            Settled Trips
                        </p>
                        <p className="mt-1 text-xl font-extrabold">
                            {summary?.completedTrips ?? 0}
                        </p>
                    </div>

                    <div className="rounded-[22px] bg-white p-5 shadow-sm">
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                            <Banknote size={21} />
                        </div>
                        <p className="mt-4 text-xs text-slate-500">
                            Total Cash Fares
                        </p>
                        <p className="mt-1 text-xl font-extrabold">
                            {money(summary?.totalFares)}
                        </p>
                    </div>

                    <div className="rounded-[22px] bg-white p-5 shadow-sm">
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-50 text-red-500">
                            <ReceiptText size={21} />
                        </div>
                        <p className="mt-4 text-xs text-slate-500">
                            Platform Commission
                        </p>
                        <p className="mt-1 text-xl font-extrabold">
                            {money(summary?.totalCommission)}
                        </p>
                    </div>
                </div>

                <section className="overflow-hidden rounded-[26px] bg-white p-5 shadow-sm">
                    <h3 className="mb-4 text-lg font-extrabold">Financial Activity</h3>

                    <div className="mb-5 grid grid-cols-2 gap-2 rounded-xl bg-slate-100 p-1">
                        <button
                            type="button"
                            onClick={() => setActiveTab("transactions")}
                            className={`rounded-lg py-3 text-xs font-bold ${activeTab === "transactions"
                                    ? "bg-white text-[#087F5B] shadow-sm"
                                    : "text-slate-500"
                                }`}
                        >
                            Wallet Transactions
                        </button>

                        <button
                            type="button"
                            onClick={() => setActiveTab("rides")}
                            className={`rounded-lg py-3 text-xs font-bold ${activeTab === "rides"
                                    ? "bg-white text-[#087F5B] shadow-sm"
                                    : "text-slate-500"
                                }`}
                        >
                            Trip Earnings
                        </button>
                    </div>

                    {loading ? (
                        <p className="py-8 text-center text-sm text-slate-500">
                            Loading financial records...
                        </p>
                    ) : activeTab === "transactions" ? (
                        transactions.length === 0 ? (
                            <div className="py-10 text-center">
                                <Wallet size={32} className="mx-auto text-[#087F5B]" />
                                <p className="mt-3 font-bold">No transactions yet</p>
                                <p className="mt-2 text-sm text-slate-500">
                                    Wallet activity will appear here.
                                </p>
                            </div>
                        ) : (
                            <div className="divide-y divide-slate-100">
                                {transactions.map((tx) => {
                                    const credit = isCredit(tx.type, tx);

                                    return (
                                        <div key={tx._id} className="flex items-center gap-3 py-4">
                                            <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${credit
                                                    ? "bg-emerald-50 text-[#087F5B]"
                                                    : "bg-red-50 text-red-500"
                                                }`}>
                                                {credit
                                                    ? <ArrowDownRight size={22} />
                                                    : <ArrowUpRight size={22} />}
                                            </div>

                                            <div className="min-w-0 flex-1">
                                                <p className="text-sm font-bold">
                                                    {transactionLabels[tx.type] || tx.type}
                                                </p>
                                                <p className="mt-1 text-xs text-slate-500">
                                                    {formatDate(tx.createdAt)}
                                                </p>
                                            </div>

                                            <p className={`text-sm font-extrabold ${credit ? "text-[#087F5B]" : "text-red-500"
                                                }`}>
                                                {credit ? "+" : "-"}{money(tx.amount)}
                                            </p>
                                        </div>
                                    );
                                })}
                            </div>
                        )
                    ) : (
                        recentTrips.length === 0 ? (
                            <div className="py-10 text-center">
                                <CarFront size={32} className="mx-auto text-[#087F5B]" />
                                <p className="mt-3 font-bold">No settled trips yet</p>
                                <p className="mt-2 text-sm text-slate-500">
                                    Completed and settled trips will appear here.
                                </p>
                            </div>
                        ) : (
                            <div className="divide-y divide-slate-100">
                                {recentTrips.map((trip) => (
                                    <div key={trip._id} className="py-4">
                                        <div className="flex justify-between gap-3">
                                            <div>
                                                <p className="flex items-center gap-2 text-sm font-bold">
                                                    <CheckCircle2 size={17} className="text-[#087F5B]" />
                                                    Settled Ride
                                                </p>
                                                <p className="mt-1 flex items-center gap-1 text-xs text-slate-500">
                                                    <Clock3 size={13} />
                                                    {formatDate(trip.createdAt)}
                                                </p>
                                            </div>

                                            <p className="text-sm font-extrabold text-[#087F5B]">
                                                {money(trip.driverEarnings)}
                                            </p>
                                        </div>

                                        <div className="mt-3 grid grid-cols-2 gap-2 rounded-xl bg-slate-50 p-3 text-xs">
                                            <div>
                                                <p className="text-slate-500">Cash fare</p>
                                                <p className="mt-1 font-bold">{money(trip.fare)}</p>
                                            </div>
                                            <div>
                                                <p className="text-slate-500">Commission</p>
                                                <p className="mt-1 font-bold">{money(trip.commission)}</p>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )
                    )}
                </section>

                <p className="px-2 text-center text-xs leading-5 text-slate-500">
                    Trip earnings reflect recorded cash fares minus platform commission.
                    Wallet balance represents prepaid funds, not cash collected.
                </p>
            </div>
        </main>
    );
}
