"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
    ArrowLeft,
    ChevronRight,
    Plus,
    RefreshCw,
    ShoppingBag,
} from "lucide-react";
import AuthGuard from "@/components/AuthGuard";
import MobileBottomNav from "@/components/MobileBottomNav";
import { useAuth } from "@/context/AuthContext";
import { getMyPurchaseOrders } from "@/lib/purchaseService";
import { formatPKR } from "@/lib/rideDisplay";
import {
    StatusPill,
    purchaseStatusMeta,
} from "@/components/order/PurchaseTimeline";

export default function BuyDeliverPage() {
    return (
        <AuthGuard role="PASSENGER">
            <BuyDeliverDashboard />
        </AuthGuard>
    );
}

function BuyDeliverDashboard() {
    const { token } = useAuth();
    const [orders, setOrders] = useState([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState("");

    const load = useCallback(async () => {
        if (!token) return;
        try {
            const data = await getMyPurchaseOrders(token);
            setOrders(data.orders || []);
            setError("");
        } catch (e) {
            setError(e.message);
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, [token]);

    useEffect(() => {
        let cancelled = false;
        (async () => { if (!cancelled) await load(); })();
        return () => { cancelled = true; };
    }, [load]);

    return (
        <main className="min-h-dvh bg-pd-bg pb-28 text-pd-text">
            <div className="sticky top-0 z-20 border-b border-pd-line bg-pd-elevated backdrop-blur-xl">
                <div className="mx-auto flex max-w-xl items-center gap-2 px-3 pb-3 pt-[max(12px,env(safe-area-inset-top))]">
                    <Link
                        href="/passenger"
                        aria-label="Back to home"
                        className="grid h-11 w-11 place-items-center rounded-2xl hover:bg-pd-surface-2"
                    >
                        <ArrowLeft size={21} />
                    </Link>
                    <h1 className="flex-1 text-lg font-extrabold tracking-tight">Buy & Deliver</h1>
                    <button
                        type="button"
                        aria-label="Refresh"
                        onClick={() => { setRefreshing(true); void load(); }}
                        className="grid h-11 w-11 place-items-center rounded-2xl text-pd-muted hover:bg-pd-surface-2"
                    >
                        <RefreshCw size={18} className={refreshing ? "animate-spin" : ""} />
                    </button>
                </div>
            </div>

            <div className="mx-auto max-w-xl space-y-5 px-4 pt-4">
                {/* Hero */}
                <section className="relative overflow-hidden rounded-[24px] bg-[#087F5B] p-5 text-white shadow-sm">
                    <div className="absolute -right-8 -top-10 h-40 w-40 rounded-full bg-white/10" aria-hidden="true" />
                    <div className="absolute -bottom-14 right-16 h-32 w-32 rounded-full bg-white/10" aria-hidden="true" />
                    <div className="relative">
                        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/15">
                            <ShoppingBag size={24} aria-hidden="true" />
                        </span>
                        <h2 className="mt-3 text-[22px] font-extrabold leading-tight">
                            Buy & Deliver — Kharid Kar Lao
                        </h2>
                        <p className="mt-1 max-w-sm text-sm leading-relaxed text-emerald-50/90">
                            Tell us what to buy, set your budget, and a verified Safar partner
                            will shop for you and deliver it to your door. You approve the
                            cost before anything is bought — and pay cash on delivery.
                        </p>
                        <Link
                            href="/passenger/buy-deliver/new"
                            className="mt-4 inline-flex h-12 items-center gap-2 rounded-2xl bg-pd-surface px-5 text-sm font-extrabold text-[#087F5B] transition-transform active:scale-[0.98]"
                        >
                            <Plus size={18} /> New shopping request
                        </Link>
                    </div>
                </section>

                {error && (
                    <p role="alert" className="rounded-2xl bg-pd-danger-soft px-4 py-3 text-sm font-semibold text-pd-danger">
                        {error}
                    </p>
                )}

                <section aria-labelledby="my-orders-title">
                    <h2 id="my-orders-title" className="mb-3 flex items-center gap-2 px-1 text-xs font-bold uppercase tracking-wider text-pd-muted">
                        My requests
                        {orders.length > 0 && (
                            <span className="rounded-full bg-pd-surface px-2 py-0.5 text-[10px] text-pd-text-2 shadow-sm">
                                {orders.length}
                            </span>
                        )}
                    </h2>

                    {loading ? (
                        <div className="space-y-3" aria-busy="true" aria-label="Loading">
                            {[0, 1].map((i) => (
                                <div key={i} className="rounded-[24px] bg-pd-surface p-4 shadow-sm">
                                    <div className="h-4 w-1/3 animate-pulse rounded-full bg-pd-surface-2" />
                                    <div className="mt-3 h-3 w-2/3 animate-pulse rounded-full bg-pd-surface-2" />
                                    <div className="mt-2 h-3 w-1/2 animate-pulse rounded-full bg-pd-surface-2" />
                                </div>
                            ))}
                        </div>
                    ) : orders.length === 0 ? (
                        <div className="rounded-[24px] border border-dashed border-pd-line-strong bg-pd-surface px-5 py-8 text-center shadow-sm">
                            <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-pd-success-soft text-[#087F5B]">
                                <ShoppingBag size={22} />
                            </span>
                            <h3 className="mt-3 font-extrabold">No shopping requests yet</h3>
                            <p className="mx-auto mt-1 max-w-xs text-sm text-pd-muted">
                                Groceries, pharmacy runs, market shopping — send your list and
                                partners nearby will offer their delivery fee.
                            </p>
                            <Link
                                href="/passenger/buy-deliver/new"
                                className="mt-4 inline-flex h-11 items-center gap-2 rounded-2xl bg-[#087F5B] px-4 text-sm font-extrabold text-white"
                            >
                                <Plus size={16} /> Create your first request
                            </Link>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {orders.map((order) => {
                                const meta = purchaseStatusMeta(order.status);
                                const preview = String(order.itemsText || "").split("\n")[0];
                                return (
                                    <Link
                                        key={order._id}
                                        href={`/passenger/buy-deliver/details?id=${order._id}`}
                                        className="block rounded-[24px] bg-pd-surface p-4 shadow-sm transition-transform active:scale-[0.99]"
                                    >
                                        <div className="flex items-start justify-between gap-3">
                                            <p className="min-w-0 flex-1 truncate text-[15px] font-extrabold leading-snug">
                                                {preview || "Shopping request"}
                                            </p>
                                            <StatusPill meta={meta} />
                                        </div>
                                        <p className="mt-1 line-clamp-2 text-sm text-pd-muted">
                                            {order.itemsText}
                                        </p>
                                        <div className="mt-3 flex items-center justify-between text-xs font-semibold text-pd-muted">
                                            <span>
                                                Budget <span className="font-extrabold text-pd-text">{formatPKR(order.estimatedBudget)}</span>
                                                {order.deliveryFee ? (
                                                    <> · Fee <span className="font-extrabold text-pd-text">{formatPKR(order.deliveryFee)}</span></>
                                                ) : null}
                                            </span>
                                            <span className="flex items-center gap-1">
                                                {order.createdAt
                                                    ? new Date(order.createdAt).toLocaleDateString([], { month: "short", day: "numeric" })
                                                    : ""}
                                                <ChevronRight size={14} className="text-pd-faint" />
                                            </span>
                                        </div>
                                    </Link>
                                );
                            })}
                        </div>
                    )}
                </section>
            </div>

            <MobileBottomNav role="PASSENGER" />
        </main>
    );
}
