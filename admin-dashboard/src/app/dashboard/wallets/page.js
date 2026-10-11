
"use client";

import { useCallback, useEffect, useState } from "react";
import {
    Search,
    Wallet,
    RefreshCw,
    ChevronLeft,
    ChevronRight,
    ArrowDownLeft,
    ArrowUpRight,
    UserRound,
    ReceiptText,
    ShieldCheck,
    X,
} from "lucide-react";

import AdminShell from "@/components/AdminShell";
import { authenticatedAdminRequest } from "@/lib/adminSession";

const money = (value) =>
    `PKR ${Number(value ?? 0).toLocaleString("en-PK")}`;

const formatDate = (value) =>
    new Date(value).toLocaleString("en-PK", {
        dateStyle: "medium",
        timeStyle: "short",
    });

export default function WalletManagementPage() {
    const [drivers, setDrivers] = useState([]);
    const [searchInput, setSearchInput] = useState("");
    const [search, setSearch] = useState("");
    const [page, setPage] = useState(1);
    const [pagination, setPagination] = useState({});
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    const [selectedId, setSelectedId] = useState(null);
    const [details, setDetails] = useState(null);
    const [detailsLoading, setDetailsLoading] = useState(false);
    const [detailsError, setDetailsError] = useState("");

    const loadDrivers = useCallback(async () => {
        setLoading(true);
        setError("");

        try {
            const params = new URLSearchParams({
                page: String(page),
            });

            if (search) params.set("search", search);

            const data = await authenticatedAdminRequest(
                `/admin/wallets?${params.toString()}`
            );

            setDrivers(data.drivers || []);
            setPagination(data.pagination || {});
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, [page, search]);

    useEffect(() => {
        loadDrivers();
    }, [loadDrivers]);

    useEffect(() => {
        if (!selectedId) {
            setDetails(null);
            return;
        }

        let cancelled = false;

        async function loadDetails() {
            setDetailsLoading(true);
            setDetailsError("");
            setDetails(null);

            try {
                const data = await authenticatedAdminRequest(
                    `/admin/wallets/${encodeURIComponent(selectedId)}`
                );

                if (!cancelled) setDetails(data);
            } catch (err) {
                if (!cancelled) setDetailsError(err.message);
            } finally {
                if (!cancelled) setDetailsLoading(false);
            }
        }

        loadDetails();

        return () => {
            cancelled = true;
        };
    }, [selectedId]);

    function handleSearch(event) {
        event.preventDefault();
        setPage(1);
        setSearch(searchInput.trim());
    }

    const totalBalance = drivers.reduce(
        (sum, driver) => sum + Number(driver.wallet.balance || 0),
        0
    );

    return (
        <AdminShell title="Driver Wallets">
            <div className="space-y-6">
                <section className="flex flex-wrap items-start justify-between gap-4 rounded-[24px] bg-white p-6 shadow-sm">
                    <div>
                        <p className="text-xs font-bold uppercase tracking-wider text-[#087F5B]">
                            Financial Management
                        </p>
                        <h2 className="mt-2 text-2xl font-extrabold">
                            Driver Wallet Management
                        </h2>
                        <p className="mt-2 text-sm text-slate-500">
                            Search driver accounts, inspect prepaid balances
                            and review wallet transactions.
                        </p>
                    </div>

                    <button
                        type="button"
                        onClick={loadDrivers}
                        disabled={loading}
                        className="flex items-center gap-2 rounded-xl border px-4 py-3 text-sm font-bold disabled:opacity-50"
                    >
                        <RefreshCw
                            size={17}
                            className={loading ? "animate-spin" : ""}
                        />
                        Refresh
                    </button>
                </section>

                <div className="grid gap-4 sm:grid-cols-3">
                    <div className="rounded-2xl bg-white p-5 shadow-sm">
                        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-50 text-[#087F5B]">
                            <Wallet size={22} />
                        </div>
                        <p className="mt-4 text-sm text-slate-500">
                            Displayed Wallet Balance
                        </p>
                        <p className="mt-1 text-2xl font-extrabold">
                            {money(totalBalance)}
                        </p>
                        <p className="mt-1 text-xs text-slate-400">
                            Only drivers listed on this page
                        </p>
                    </div>

                    <div className="rounded-2xl bg-white p-5 shadow-sm">
                        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                            <UserRound size={22} />
                        </div>
                        <p className="mt-4 text-sm text-slate-500">
                            Total Driver Accounts
                        </p>
                        <p className="mt-1 text-2xl font-extrabold">
                            {pagination.total ?? "—"}
                        </p>
                        <p className="mt-1 text-xs text-slate-400">
                            For current search
                        </p>
                    </div>

                    <div className="rounded-2xl bg-white p-5 shadow-sm">
                        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-50 text-amber-700">
                            <ShieldCheck size={22} />
                        </div>
                        <p className="mt-4 text-sm text-slate-500">
                            Management Mode
                        </p>
                        <p className="mt-1 text-xl font-extrabold">
                            Read Only
                        </p>
                        <p className="mt-1 text-xs text-slate-400">
                            Top-up UI pending verification controls
                        </p>
                    </div>
                </div>

                <section className="overflow-hidden rounded-[24px] bg-white shadow-sm">
                    <div className="border-b border-slate-100 p-5">
                        <form
                            onSubmit={handleSearch}
                            className="flex flex-col gap-3 sm:flex-row"
                        >
                            <div className="flex flex-1 items-center gap-3 rounded-xl border border-slate-200 px-4">
                                <Search size={19} className="text-slate-400" />
                                <input
                                    type="search"
                                    value={searchInput}
                                    onChange={(e) => setSearchInput(e.target.value)}
                                    placeholder="Search by name or email"
                                    className="h-12 min-w-0 flex-1 bg-transparent text-sm outline-none"
                                />
                            </div>

                            <button
                                type="submit"
                                className="rounded-xl bg-[#087F5B] px-6 py-3 text-sm font-bold text-white"
                            >
                                Search Drivers
                            </button>
                        </form>
                    </div>

                    {error && (
                        <p role="alert" className="m-5 rounded-xl bg-red-50 p-4 text-sm text-red-600">
                            {error}
                        </p>
                    )}

                    {loading ? (
                        <p className="p-10 text-center text-sm text-slate-500">
                            Loading driver wallets...
                        </p>
                    ) : drivers.length === 0 ? (
                        <p className="p-10 text-center text-sm text-slate-500">
                            No drivers found.
                        </p>
                    ) : (
                        <div className="divide-y divide-slate-100">
                            {drivers.map((driver) => (
                                <div
                                    key={driver.driverId}
                                    className="flex flex-wrap items-center gap-4 p-5"
                                >
                                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 text-[#087F5B]">
                                        <UserRound size={22} />
                                    </div>

                                    <div className="min-w-0 flex-1">
                                        <p className="font-bold">{driver.name}</p>
                                        <p className="truncate text-sm text-slate-500">
                                            {driver.email}
                                        </p>
                                        <p className="mt-1 text-xs text-slate-400">
                                            {driver.verificationStatus}
                                        </p>
                                    </div>

                                    <div className="text-right">
                                        <p className="text-lg font-extrabold">
                                            {money(driver.wallet.balance)}
                                        </p>
                                        <p className="text-xs text-slate-500">
                                            Available balance
                                        </p>
                                    </div>

                                    <button
                                        type="button"
                                        onClick={() => setSelectedId(String(driver.driverId))}
                                        className="flex items-center gap-2 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-bold text-[#087F5B]"
                                    >
                                        Details <ChevronRight size={17} />
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}

                    {pagination.pages > 1 && (
                        <div className="flex items-center justify-between border-t p-5">
                            <button
                                type="button"
                                onClick={() => setPage((p) => Math.max(1, p - 1))}
                                disabled={page <= 1 || loading}
                                className="flex items-center gap-1 rounded-lg border px-4 py-2 text-sm disabled:opacity-40"
                            >
                                <ChevronLeft size={17} /> Previous
                            </button>

                            <span className="text-sm text-slate-500">
                                Page {page} / {pagination.pages}
                            </span>

                            <button
                                type="button"
                                onClick={() => setPage((p) => p + 1)}
                                disabled={page >= pagination.pages || loading}
                                className="flex items-center gap-1 rounded-lg border px-4 py-2 text-sm disabled:opacity-40"
                            >
                                Next <ChevronRight size={17} />
                            </button>
                        </div>
                    )}
                </section>

                {selectedId && (
                    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/50 p-4">
                        <section
                            role="dialog"
                            aria-modal="true"
                            aria-label="Driver wallet details"
                            className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-[26px] bg-white p-6 shadow-2xl"
                        >
                            <div className="mb-6 flex items-center justify-between">
                                <h3 className="text-xl font-extrabold">
                                    Wallet Details
                                </h3>

                                <button
                                    type="button"
                                    onClick={() => setSelectedId(null)}
                                    aria-label="Close details"
                                    className="rounded-xl bg-slate-100 p-2"
                                >
                                    <X size={21} />
                                </button>
                            </div>

                            {detailsLoading ? (
                                <p className="py-10 text-center text-sm text-slate-500">
                                    Loading transactions...
                                </p>
                            ) : detailsError ? (
                                <p role="alert" className="text-sm text-red-600">
                                    {detailsError}
                                </p>
                            ) : details ? (
                                <>
                                    <div className="rounded-2xl bg-emerald-50 p-5">
                                        <p className="text-sm font-bold text-[#065F46]">
                                            {details.driver.name}
                                        </p>
                                        <p className="mt-1 text-xs text-slate-500">
                                            {details.driver.email}
                                        </p>

                                        <p className="mt-5 text-xs text-slate-500">
                                            Wallet Balance
                                        </p>
                                        <p className="mt-1 text-3xl font-extrabold">
                                            {money(details.wallet.balance)}
                                        </p>
                                    </div>

                                    <div className="mt-4 grid grid-cols-2 gap-3">
                                        <div className="rounded-xl bg-slate-50 p-4">
                                            <p className="text-xs text-slate-500">Total Top-ups</p>
                                            <p className="mt-2 font-extrabold">
                                                {money(details.wallet.totalTopUps)}
                                            </p>
                                        </div>
                                        <div className="rounded-xl bg-slate-50 p-4">
                                            <p className="text-xs text-slate-500">Total Commission</p>
                                            <p className="mt-2 font-extrabold">
                                                {money(details.wallet.totalCommission)}
                                            </p>
                                        </div>
                                    </div>

                                    <h4 className="mt-6 flex items-center gap-2 font-extrabold">
                                        <ReceiptText size={20} className="text-[#087F5B]" />
                                        Recent Transactions
                                    </h4>

                                    {details.transactions.length === 0 ? (
                                        <p className="py-8 text-center text-sm text-slate-500">
                                            No wallet transactions yet.
                                        </p>
                                    ) : (
                                        <div className="mt-3 divide-y divide-slate-100">
                                            {details.transactions.map((tx) => {
                                                const positive =
                                                    Number(tx.balanceAfter) >
                                                    Number(tx.balanceBefore);

                                                return (
                                                    <div
                                                        key={tx._id}
                                                        className="flex items-center gap-3 py-4"
                                                    >
                                                        <div className={`rounded-xl p-3 ${positive
                                                                ? "bg-emerald-50 text-[#087F5B]"
                                                                : "bg-red-50 text-red-500"
                                                            }`}>
                                                            {positive
                                                                ? <ArrowDownLeft size={19} />
                                                                : <ArrowUpRight size={19} />}
                                                        </div>

                                                        <div className="min-w-0 flex-1">
                                                            <p className="text-sm font-bold">
                                                                {tx.type.replaceAll("_", " ")}
                                                            </p>
                                                            <p className="mt-1 text-xs text-slate-500">
                                                                {formatDate(tx.createdAt)}
                                                            </p>
                                                        </div>

                                                        <p className={`text-sm font-extrabold ${positive ? "text-[#087F5B]" : "text-red-500"
                                                            }`}>
                                                            {positive ? "+" : "-"}
                                                            {money(tx.amount)}
                                                        </p>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                </>
                            ) : null}
                        </section>
                    </div>
                )}
            </div>
        </AdminShell>
    );
}
