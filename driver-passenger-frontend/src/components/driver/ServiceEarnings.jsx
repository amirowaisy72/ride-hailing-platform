"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
    CarFront,
    ChevronRight,
    CircleAlert,
    Package,
    ReceiptText,
    RefreshCw,
    ShoppingBag,
    TrendingUp,
    Wallet,
} from "lucide-react";

import { apiRequest } from "@/lib/api";

// Earnings split by service (GET /drivers/me/earnings-by-service).
//
// Money rule shown throughout: the Buy & Deliver delivery fee is the
// partner's earning; the shopping money (what the partner spent at the
// shop) is a REIMBURSEMENT owed back by the passenger — it is never
// counted as earnings, and the backend keeps it out of `totals`.

const money = (value) =>
    `PKR ${Number(value ?? 0).toLocaleString("en-PK")}`;

const ROWS = [
    {
        key: "RIDE",
        label: "Passenger Rides",
        Icon: CarFront,
        iconWrap: "bg-pd-success-soft text-[#087F5B]",
        grossLabel: "Total fares",
        gross: (s) => s.totalFares,
    },
    {
        key: "PARCEL",
        label: "Parcel Delivery",
        Icon: Package,
        iconWrap: "bg-pd-info-soft text-pd-info",
        grossLabel: "Total fares",
        gross: (s) => s.totalFares,
    },
    {
        key: "BUY_DELIVER",
        label: "Buy & Deliver",
        Icon: ShoppingBag,
        iconWrap: "bg-violet-50 text-violet-600",
        grossLabel: "Delivery fees",
        gross: (s) => s.totalDeliveryFees,
    },
];

export default function ServiceEarnings({ token, compact = false }) {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [shoppingOpen, setShoppingOpen] = useState(false);

    const load = useCallback(async () => {
        if (!token) return;
        setError("");
        try {
            const result = await apiRequest("/drivers/me/earnings-by-service", {
                token,
            });
            setData(result);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, [token]);

    useEffect(() => {
        if (!token) return;
        let cancelled = false;
        apiRequest("/drivers/me/earnings-by-service", { token })
            .then((result) => {
                if (!cancelled) setData(result);
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
    }, [token]);

    if (compact) {
        const unpaid = Number(
            data?.services?.BUY_DELIVER?.shopping?.unpaid ?? 0
        );
        return (
            <Link
                href="/driver/earnings"
                className="flex items-center gap-3 rounded-2xl border border-pd-line bg-pd-surface p-3 text-pd-text shadow-sm"
            >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-pd-success-soft text-[#087F5B]">
                    <TrendingUp size={20} />
                </span>
                <span className="min-w-0 flex-1">
                    <span className="block text-xs font-bold text-pd-muted">
                        Earnings by service
                    </span>
                    <span className="block truncate text-sm font-extrabold">
                        {loading
                            ? "Loading…"
                            : error
                              ? "Tap to view your earnings"
                              : `Net ${money(data?.totals?.netEarnings)} · Rides, Parcels & Buy & Deliver`}
                    </span>
                    {!loading && !error && unpaid > 0 && (
                        <span className="mt-0.5 block text-[11px] font-bold text-pd-warning">
                            Shopping reimbursement unpaid: {money(unpaid)}
                        </span>
                    )}
                </span>
                <ChevronRight size={16} className="shrink-0 text-pd-muted" />
            </Link>
        );
    }

    if (loading) {
        return (
            <section
                className="h-56 animate-pulse rounded-[26px] bg-pd-surface shadow-sm"
                aria-busy="true"
            />
        );
    }

    if (error) {
        return (
            <section className="rounded-[26px] bg-pd-surface p-5 shadow-sm">
                <p className="flex items-start gap-2 text-sm font-semibold text-pd-danger">
                    <CircleAlert size={17} className="mt-0.5 shrink-0" />
                    {error}
                </p>
                <button
                    type="button"
                    onClick={() => {
                        setLoading(true);
                        void load();
                    }}
                    className="mt-3 inline-flex items-center gap-2 rounded-xl bg-[#087F5B] px-4 py-2.5 text-sm font-bold text-white"
                >
                    <RefreshCw size={15} /> Try again
                </button>
            </section>
        );
    }

    const services = data?.services || {};
    const totals = data?.totals || {};
    const shopping = services.BUY_DELIVER?.shopping || null;
    const totalOrders = ROWS.reduce(
        (sum, row) => sum + Number(services[row.key]?.completedOrders ?? 0),
        0
    );

    return (
        <section className="overflow-hidden rounded-[26px] bg-pd-surface p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3">
                <div>
                    <h3 className="flex items-center gap-2 text-lg font-extrabold">
                        <Wallet size={20} className="text-[#087F5B]" />
                        Earnings by Service
                    </h3>
                    <p className="mt-0.5 text-xs text-pd-muted">
                        What each Safar service has earned you, after platform
                        commission.
                    </p>
                </div>
                <button
                    type="button"
                    onClick={() => void load()}
                    aria-label="Refresh earnings by service"
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-pd-surface-2 text-pd-text-2"
                >
                    <RefreshCw size={16} />
                </button>
            </div>

            {totalOrders === 0 ? (
                <div className="py-8 text-center">
                    <TrendingUp size={30} className="mx-auto text-[#087F5B]" />
                    <p className="mt-3 font-bold">No settled earnings yet</p>
                    <p className="mt-1 text-sm text-pd-muted">
                        Completed rides, parcels and shopping deliveries will
                        appear here, service by service.
                    </p>
                </div>
            ) : (
                <div className="mt-4 divide-y divide-pd-line">
                    {ROWS.map((row) => {
                        const service = services[row.key] || {};
                        const Icon = row.Icon;
                        return (
                            <div key={row.key} className="py-4">
                                <div className="flex items-center gap-3">
                                    <span
                                        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${row.iconWrap}`}
                                    >
                                        <Icon size={21} />
                                    </span>
                                    <div className="min-w-0 flex-1">
                                        <p className="text-sm font-extrabold">
                                            {row.label}
                                        </p>
                                        <p className="text-xs text-pd-muted">
                                            {service.completedOrders ?? 0}{" "}
                                            completed · {row.grossLabel}{" "}
                                            {money(row.gross(service))} ·
                                            Commission{" "}
                                            {money(service.totalCommission)}
                                        </p>
                                    </div>
                                    <p className="shrink-0 text-sm font-extrabold text-[#087F5B]">
                                        {money(service.netEarnings)}
                                    </p>
                                </div>

                                {row.key === "BUY_DELIVER" && shopping && (
                                    <div className="mt-3 pl-14">
                                        <button
                                            type="button"
                                            onClick={() =>
                                                setShoppingOpen((open) => !open)
                                            }
                                            className="inline-flex items-center gap-1.5 rounded-lg bg-violet-50 px-2.5 py-1.5 text-[11px] font-extrabold text-violet-700"
                                        >
                                            <ReceiptText size={13} />
                                            Shopping money ledger
                                            <ChevronRight
                                                size={13}
                                                className={`transition-transform ${shoppingOpen ? "rotate-90" : ""}`}
                                            />
                                        </button>
                                        {shoppingOpen && (
                                            <div className="mt-2 rounded-xl bg-pd-surface-2 p-3 text-xs">
                                                <div className="grid grid-cols-3 gap-2 text-center">
                                                    <div>
                                                        <p className="text-pd-muted">
                                                            You spent
                                                        </p>
                                                        <p className="mt-0.5 font-extrabold">
                                                            {money(shopping.advanced)}
                                                        </p>
                                                    </div>
                                                    <div>
                                                        <p className="text-pd-muted">
                                                            Reimbursed
                                                        </p>
                                                        <p className="mt-0.5 font-extrabold text-[#087F5B]">
                                                            {money(shopping.reimbursed)}
                                                        </p>
                                                    </div>
                                                    <div>
                                                        <p className="text-pd-muted">
                                                            Still unpaid
                                                        </p>
                                                        <p
                                                            className={`mt-0.5 font-extrabold ${Number(shopping.unpaid) > 0 ? "text-pd-warning" : ""}`}
                                                        >
                                                            {money(shopping.unpaid)}
                                                        </p>
                                                    </div>
                                                </div>
                                                <p className="mt-2.5 leading-4 text-pd-muted">
                                                    Across {shopping.orders ?? 0}{" "}
                                                    shopping orders. This is
                                                    reimbursement of money you
                                                    spent at the shop — it is{" "}
                                                    <strong>
                                                        not earnings
                                                    </strong>{" "}
                                                    and is never added to your
                                                    income above.
                                                </p>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            <div className="mt-2 flex items-center justify-between rounded-2xl bg-[#087F5B] px-4 py-3.5 text-white">
                <div>
                    <p className="text-[11px] font-bold uppercase tracking-wider text-white/75">
                        Total net earnings
                    </p>
                    <p className="text-xl font-extrabold">
                        {money(totals.netEarnings)}
                    </p>
                </div>
                <div className="text-right">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-white/75">
                        Total commission
                    </p>
                    <p className="text-base font-extrabold">
                        {money(totals.totalCommission)}
                    </p>
                </div>
            </div>
        </section>
    );
}
