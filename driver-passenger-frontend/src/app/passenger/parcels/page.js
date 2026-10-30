"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ChevronRight, Package, RefreshCw, ShoppingBag, WifiOff } from "lucide-react";
import AuthGuard from "@/components/AuthGuard";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/components/i18n/LanguageProvider";
import { apiRequest } from "@/lib/api";
import {
    CardSkeleton, EmptyState, InlineError, ParcelProgress, ParcelStatusBadge, RouteSummary,
} from "@/components/parcel/ParcelKit";
import {
    categoryLabel, formatPKR, formatWhen, isActive, orderPrice, serviceLabel, statusMeta,
} from "@/components/parcel/parcelUi";

export default function PassengerParcelsPage() {
    return (
        <AuthGuard role="PASSENGER">
            <ParcelDashboard />
        </AuthGuard>
    );
}

function ParcelDashboard() {
    const { token } = useAuth();
    const { t } = useLanguage();
    const [orders, setOrders] = useState([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState("");
    const [offline, setOffline] = useState(false);

    const load = useCallback(async (signal) => {
        if (!token) return;
        try {
            const data = await apiRequest("/parcels/my", { token });
            if (signal?.cancelled) return;
            setOrders(data.orders || []);
            setError("");
        } catch (err) {
            if (!signal?.cancelled) setError(err.message);
        } finally {
            if (!signal?.cancelled) {
                setLoading(false);
                setRefreshing(false);
            }
        }
    }, [token]);

    useEffect(() => {
        const signal = { cancelled: false };
        load(signal);
        return () => { signal.cancelled = true; };
    }, [load]);

    useEffect(() => {
        const update = () => setOffline(typeof navigator !== "undefined" && navigator.onLine === false);
        update();
        window.addEventListener("online", update);
        window.addEventListener("offline", update);
        return () => {
            window.removeEventListener("online", update);
            window.removeEventListener("offline", update);
        };
    }, []);

    const { active, history } = useMemo(() => ({
        active: orders.filter(isActive),
        history: orders.filter((o) => !isActive(o)),
    }), [orders]);

    return (
        <main className="min-h-dvh bg-pd-bg text-pd-text">
            <div className="sticky top-0 z-20 border-b border-pd-line bg-pd-elevated backdrop-blur-xl pd-safe-top">
                <div className="mx-auto flex max-w-xl items-center gap-2 px-3 pb-2.5">
                    <Link href="/passenger" aria-label={t("parcels.backHome")} className="grid h-11 w-11 place-items-center rounded-2xl text-pd-text">
                        <ArrowLeft size={21} />
                    </Link>
                    <h1 className="flex-1 text-lg font-extrabold tracking-tight">{t("parcels.title")}</h1>
                    <button
                        type="button"
                        aria-label={t("common.refresh")}
                        onClick={() => { setRefreshing(true); load(); }}
                        className="grid h-11 w-11 place-items-center rounded-2xl text-pd-muted"
                    >
                        <RefreshCw size={18} className={refreshing ? "animate-spin" : ""} />
                    </button>
                </div>
            </div>

            <div className="mx-auto max-w-xl space-y-6 px-4 pb-[calc(32px+env(safe-area-inset-bottom))] pt-4">
                {offline && (
                    <p className="flex items-center gap-2 rounded-2xl bg-pd-warning-soft p-3 text-sm font-semibold text-pd-warning">
                        <WifiOff size={16} /> You are offline. Showing last loaded deliveries.
                    </p>
                )}

                {/* Entry points */}
                <section className="grid grid-cols-2 gap-3">
                    <Link
                        href="/passenger/parcels/new"
                        className="group relative overflow-hidden rounded-3xl bg-pd-accent p-4 text-pd-accent-ink shadow-pd active:scale-[.98]"
                    >
                        <Package size={24} strokeWidth={2.2} />
                        <p className="mt-6 text-base font-extrabold leading-tight">{t("parcels.sendParcel")}</p>
                        <p className="mt-0.5 text-xs font-semibold opacity-70">{t("parcels.doorToDoor")}</p>
                        <ChevronRight size={18} className="absolute right-3 top-4 opacity-60" />
                    </Link>
                    <Link
                        href="/passenger/parcels/new?service=SHOP_PICKUP"
                        className="group relative overflow-hidden rounded-3xl border border-pd-line bg-pd-surface p-4 shadow-pd active:scale-[.98]"
                    >
                        <ShoppingBag size={24} strokeWidth={2} />
                        <p className="mt-6 text-base font-extrabold leading-tight">{t("parcels.shopPickup")}</p>
                        <p className="mt-0.5 text-xs font-semibold text-pd-muted">{t("parcels.collectOrder")}</p>
                        <ChevronRight size={18} className="absolute right-3 top-4 text-pd-faint" />
                    </Link>
                </section>

                <InlineError>{error}</InlineError>

                {loading ? (
                    <CardSkeleton count={2} />
                ) : (
                    <>
                        <section aria-labelledby="active-title">
                            <SectionTitle id="active-title" count={active.length}>{t("parcels.active")}</SectionTitle>
                            {active.length === 0 ? (
                                <EmptyState
                                    title={t("parcels.noActiveTitle")}
                                    body={t("parcels.noActiveBody")}
                                />
                            ) : (
                                <div className="space-y-3">
                                    {active.map((order) => <ActiveCard key={order._id} order={order} />)}
                                </div>
                            )}
                        </section>

                        {history.length > 0 && (
                            <section aria-labelledby="history-title">
                                <SectionTitle id="history-title" count={history.length}>{t("parcels.history")}</SectionTitle>
                                <div className="divide-y divide-pd-line overflow-hidden rounded-3xl border border-pd-line bg-pd-surface">
                                    {history.map((order) => <HistoryRow key={order._id} order={order} />)}
                                </div>
                            </section>
                        )}
                    </>
                )}
            </div>
        </main>
    );
}

function SectionTitle({ id, children, count }) {
    return (
        <h2 id={id} className="mb-3 flex items-center gap-2 px-1 text-xs font-bold uppercase tracking-wider text-pd-muted">
            {children}
            {count > 0 && <span className="rounded-full bg-pd-surface-3 px-2 py-0.5 text-[10px] text-pd-text-2">{count}</span>}
        </h2>
    );
}

function ActiveCard({ order }) {
    const meta = statusMeta(order.status);
    return (
        <Link
            href={`/passenger/parcels/details?parcelId=${order._id}`}
            className="pd-rise block rounded-3xl border border-pd-line bg-pd-surface p-4 shadow-pd active:scale-[.99]"
        >
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <p className="text-xs font-semibold text-pd-muted">
                        {serviceLabel(order.serviceType)} · {categoryLabel(order.parcel?.category)} · {order.parcel?.weightKg} kg
                    </p>
                    <p className="mt-0.5 text-[17px] font-extrabold leading-snug">{meta.label}</p>
                </div>
                <ParcelStatusBadge status={order.status} />
            </div>
            <ParcelProgress status={order.status} className="mt-3" />
            <div className="mt-4">
                <RouteSummary pickup={order.pickup} destination={order.destination} compact />
            </div>
            <div className="mt-4 flex items-center justify-between border-t border-pd-line pt-3">
                <strong className="text-base">{formatPKR(orderPrice(order))}</strong>
                <span className="inline-flex items-center gap-1 text-sm font-bold text-pd-text">
                    {order.status === "REQUESTED" ? t("parcels.viewOffers") : t("parcels.track")}
                    <ChevronRight size={16} />
                </span>
            </div>
        </Link>
    );
}

function HistoryRow({ order }) {
    return (
        <Link
            href={`/passenger/parcels/details?parcelId=${order._id}`}
            className="flex min-h-16 items-center gap-3 px-4 py-3 active:bg-pd-surface-2"
        >
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-pd-surface-2 text-pd-muted">
                {order.serviceType === "SHOP_PICKUP" ? <ShoppingBag size={18} /> : <Package size={18} />}
            </span>
            <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold">{order.destination?.address || serviceLabel(order.serviceType)}</p>
                <p className="mt-0.5 text-xs text-pd-muted">
                    {formatWhen(order.updatedAt || order.createdAt) || serviceLabel(order.serviceType)} · {formatPKR(orderPrice(order))}
                </p>
            </div>
            <ParcelStatusBadge status={order.status} />
        </Link>
    );
}
