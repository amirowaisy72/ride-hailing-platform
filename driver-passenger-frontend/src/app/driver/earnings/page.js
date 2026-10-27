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

const shortMoney = (amount) => {
    const value = Number(amount) || 0;
    return value >= 1000 ? `${(value / 1000).toFixed(1)}k` : `${value}`;
};

const dayLabel = (dateKey) =>
    new Date(`${dateKey}T12:00:00`).toLocaleDateString("en-PK", {
        weekday: "short",
    });

/** Plain-SVG bar chart of the last 7 days of settled earnings. */
function WeekChart({ days, todayKey }) {
    const max = Math.max(1, ...days.map((d) => Number(d.earnings) || 0));
    const width = 300;
    const height = 132;
    const baseline = 104;
    const barWidth = 26;
    const gap = (width - days.length * barWidth) / (days.length + 1);

    return (
        <svg
            viewBox={`0 0 ${width} ${height}`}
            className="mt-4 w-full"
            role="img"
            aria-label="Earnings for the last 7 days"
        >
            <line x1="0" y1={baseline} x2={width} y2={baseline} stroke="#E2E8F0" strokeWidth="1" />
            {days.map((day, index) => {
                const earnings = Number(day.earnings) || 0;
                const barHeight = Math.max(earnings > 0 ? 4 : 0, (earnings / max) * 72);
                const x = gap + index * (barWidth + gap);
                const y = baseline - barHeight;
                const isToday = day.date === todayKey;
                return (
                    <g key={day.date}>
                        <rect
                            x={x}
                            y={y}
                            width={barWidth}
                            height={barHeight}
                            rx="6"
                            fill={isToday ? "#087F5B" : "#A7D8C3"}
                        />
                        <text
                            x={x + barWidth / 2}
                            y={y - 6}
                            textAnchor="middle"
                            fontSize="9"
                            fontWeight="700"
                            fill={isToday ? "#087F5B" : "#64748B"}
                        >
                            {earnings > 0 ? shortMoney(earnings) : ""}
                        </text>
                        <text
                            x={x + barWidth / 2}
                            y={baseline + 16}
                            textAnchor="middle"
                            fontSize="10"
                            fontWeight={isToday ? "800" : "600"}
                            fill={isToday ? "#087F5B" : "#64748B"}
                        >
                            {dayLabel(day.date)}
                        </text>
                        {isToday && (
                            <circle cx={x + barWidth / 2} cy={baseline + 25} r="2.2" fill="#087F5B" />
                        )}
                    </g>
                );
            })}
        </svg>
    );
}

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
    const [paymentMethods, setPaymentMethods] = useState([]);
    const [topUpAmount, setTopUpAmount] = useState("500");
    const [topUpLoading, setTopUpLoading] = useState(false);
    const [topUpMessage, setTopUpMessage] = useState("");
    const [bankTransfer, setBankTransfer] = useState(null);
    const [paymentNotice, setPaymentNotice] = useState("");
    const [selectedPaymentMethod, setSelectedPaymentMethod] = useState("");
    const [walletMessage, setWalletMessage] = useState("");
    const [topUpRequired, setTopUpRequired] = useState(false);
    const [transactions, setTransactions] = useState([]);
    const [summary, setSummary] = useState(null);
    const [daily, setDaily] = useState(null);
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
            setWalletMessage(walletData.walletMessage || "");
            setTopUpRequired(walletData.topUpRequired === true);
            setTransactions(walletData.transactions || []);
            setSummary(earningsData.summary);
            setDaily(earningsData.daily || null);
            setRecentTrips(earningsData.recentTrips || []);

            try {
                const paymentData = await apiRequest(
                    "/drivers/me/wallet/payment-methods",
                    { token }
                );
                setPaymentMethods(paymentData.methods || []);
            } catch {
                setPaymentMethods([]);
            }
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, [token]);

    useEffect(() => {
        loadData(true);

        const params = new URLSearchParams(window.location.search);
        const status = params.get("paymentStatus");
        const orderId = params.get("paymentOrderId");

        if (status === "success" && orderId && token) {
            apiRequest(`/drivers/me/wallet/top-up/${encodeURIComponent(orderId)}`, { token })
                .then(async (result) => {
                    if (result.order?.status === "CREDITED") {
                        setPaymentNotice("Payment verified. Wallet successfully credited.");
                        await loadData();
                    } else {
                        setPaymentNotice(`Payment status: ${result.order?.status || "PENDING"}. Wallet credit confirmation is pending.`);
                    }
                })
                .catch(() => {
                    setPaymentNotice("Payment received. Wallet status check karne ke liye refresh karein.");
                });
        } else if (status === "failed") {
            setPaymentNotice("Payment failed. Wallet balance change nahi hua.");
        }

        if (status) {
            window.history.replaceState({}, "", window.location.pathname);
        }
    }, [loadData, token]);

    async function submitTopUp(event) {
        event.preventDefault();
        const amount = Number(topUpAmount);

        if (!Number.isSafeInteger(amount) || amount < 100 || amount > 1000000) {
            setTopUpMessage("Amount PKR 100 se 1,000,000 ke darmiyan hona chahiye.");
            return;
        }

        if (!selectedPaymentMethod) {
            setTopUpMessage("Payment method select karein.");
            return;
        }

        setTopUpLoading(true);
        setTopUpMessage("");
        setBankTransfer(null);

        try {
            const result = await apiRequest("/drivers/me/wallet/top-up", {
                method: "POST",
                token,
                body: JSON.stringify({
                    amount,
                    provider: selectedPaymentMethod,
                }),
            });

            if (result.bankTransfer) {
                setBankTransfer(result.bankTransfer);
                setTopUpMessage(
                    result.message || "Bank transfer details neeche diye gaye hain."
                );
                return;
            }

            if (
                result.checkout?.paymentUrl &&
                result.checkout?.fields &&
                result.order?.id
            ) {
                const form = document.createElement("form");
                form.method = "POST";
                form.action = result.checkout.paymentUrl;

                Object.entries(result.checkout.fields).forEach(([name, value]) => {
                    const input = document.createElement("input");
                    input.type = "hidden";
                    input.name = name;
                    input.value = String(value);
                    form.appendChild(input);
                });

                document.body.appendChild(form);
                form.submit();
                return;
            }

            setTopUpMessage(
                result.message || `Payment order status: ${result.order?.status || "PENDING"}`
            );
        } catch (err) {
            setTopUpMessage(err.message);
        } finally {
            setTopUpLoading(false);
        }
    }

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
                        {topUpRequired
                            ? "Prepaid balance for platform commissions"
                            : "Free Mode — No wallet top-up required"}
                    </p>

                    {walletMessage && (
                        <p className="mt-3 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">
                            {walletMessage}
                        </p>
                    )}

                    <div className="mt-6 rounded-xl bg-emerald-50 p-4">
                        <p className="flex items-center gap-2 text-xs font-semibold text-[#065F46]">
                            <ShieldCheck size={16} />
                            Wallet transactions are recorded by the platform
                        </p>
                    </div>
                </section>

                {paymentMethods.length > 0 && (
                    <section className="rounded-2xl bg-white p-5 shadow-sm">
                        <h2 className="text-lg font-extrabold">Top Up Wallet</h2>
                        <p className="mt-2 text-sm text-slate-500">
                            Top-up amount future ride commissions ke liye wallet balance mein add hogi.
                        </p>

                        <form onSubmit={submitTopUp} className="mt-4 space-y-3">
                            <label className="block text-sm font-semibold">
                                Amount (PKR)
                                <input
                                    type="number"
                                    min="100"
                                    max="1000000"
                                    step="1"
                                    required
                                    value={topUpAmount}
                                    onChange={(e) => setTopUpAmount(e.target.value)}
                                    className="mt-1 w-full rounded-xl border p-3"
                                />
                            </label>

                            <label className="block text-sm font-semibold">
                                Payment Method
                                <select
                                    required
                                    value={selectedPaymentMethod}
                                    onChange={(e) => setSelectedPaymentMethod(e.target.value)}
                                    className="mt-1 w-full rounded-xl border p-3"
                                >
                                    <option value="">Select method</option>
                                    {paymentMethods.map((item) => (
                                        <option key={item.provider} value={item.provider}>
                                            {item.provider.replaceAll("_", " ")}
                                        </option>
                                    ))}
                                </select>
                            </label>

                            {paymentMethods.length === 0 && (
                                <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
                                    Online payments abhi configure aur verify nahi huin.
                                </p>
                            )}

                            {paymentNotice && (
                                <p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">
                                    {paymentNotice}
                                </p>
                            )}

                            {topUpMessage && (
                                <p role="status" className="rounded-xl bg-slate-50 p-3 text-sm text-slate-700">
                                    {topUpMessage}
                                </p>
                            )}

                            {bankTransfer && (
                                <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-4 text-sm text-slate-800">
                                    <p className="mb-2 font-bold">Bank Transfer Details</p>
                                    <p>Bank: <strong>{bankTransfer.bankName}</strong></p>
                                    <p>Account Title: <strong>{bankTransfer.accountTitle}</strong></p>
                                    <p>Account Number: <strong>{bankTransfer.accountNumber}</strong></p>
                                    <p>Reference: <strong>{bankTransfer.reference}</strong></p>
                                    {bankTransfer.note && <p className="mt-2">{bankTransfer.note}</p>}
                                    <p className="mt-2 text-slate-600">
                                        Isi amount ki transfer karein aur reference lazmi
                                        likhein. Admin verification ke baad wallet credit
                                        ho jayega.
                                    </p>
                                </div>
                            )}

                            <button
                                type="submit"
                                disabled={topUpLoading || paymentMethods.length === 0}
                                className="w-full rounded-xl bg-[#087F5B] p-3 font-bold text-white disabled:opacity-50"
                            >
                                {topUpLoading ? "Creating..." : "Continue to Top Up"}
                            </button>
                        </form>
                    </section>
                )}

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
                            Completed Trips
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

                {daily && (
                    <section className="overflow-hidden rounded-[26px] bg-white p-5 shadow-sm">
                        <div className="flex items-start justify-between gap-3">
                            <div>
                                <h3 className="text-lg font-extrabold">This Week</h3>
                                <p className="mt-0.5 text-xs text-slate-500">
                                    Settled earnings, last 7 days
                                </p>
                            </div>
                            <div className="text-right">
                                <p className="text-[11px] font-semibold text-slate-500">
                                    Today · {daily.today.trips} trips
                                </p>
                                <p className="text-base font-extrabold text-[#087F5B]">
                                    {money(daily.today.earnings)}
                                </p>
                                <p className="mt-0.5 text-[11px] font-semibold text-slate-500">
                                    Week · {daily.week.trips} trips · {money(daily.week.earnings)}
                                </p>
                            </div>
                        </div>

                        <WeekChart days={daily.days} todayKey={daily.today.date} />
                    </section>
                )}

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
                                <p className="mt-3 font-bold">No Completed Trips yet</p>
                                <p className="mt-2 text-sm text-slate-500">
                                    Completed Trips will appear here.
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
