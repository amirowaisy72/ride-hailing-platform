
"use client";

import { useCallback, useEffect, useState } from "react";
import {
    AlertTriangle,
    CheckCircle2,
    Clock3,
    RefreshCw,
    ShieldCheck,
    Wallet,
    ReceiptText,
    SearchCheck,
} from "lucide-react";

import AdminShell from "@/components/AdminShell";
import { authenticatedAdminRequest } from "@/lib/adminSession";

const money = (value) =>
    `PKR ${Number(value ?? 0).toLocaleString("en-PK")}`;

const formatDate = (value) =>
    value
        ? new Date(value).toLocaleString("en-PK", {
            dateStyle: "medium",
            timeStyle: "short",
        })
        : "—";

function SummaryCard({ icon: Icon, title, value, color }) {
    const colors = {
        green: "bg-emerald-50 text-[#087F5B]",
        amber: "bg-amber-50 text-amber-700",
        red: "bg-red-50 text-red-600",
    };

    return (
        <div className="rounded-2xl bg-white p-5 shadow-sm">
            <div className={`flex h-11 w-11 items-center justify-center rounded-xl ${colors[color]}`}>
                <Icon size={22} />
            </div>
            <p className="mt-4 text-sm text-slate-500">{title}</p>
            <p className="mt-1 text-3xl font-extrabold">{value}</p>
        </div>
    );
}

export default function SettlementPage() {
    const [summary, setSummary] = useState(null);
    const [settlements, setSettlements] = useState([]);
    const [audit, setAudit] = useState(null);
    const [loading, setLoading] = useState(true);
    const [auditing, setAuditing] = useState(false);
    const [error, setError] = useState("");
    const [auditError, setAuditError] = useState("");

    const loadSettlements = useCallback(async () => {
        setLoading(true);
        setError("");

        try {
            const data = await authenticatedAdminRequest(
                "/admin/settlements"
            );

            setSummary(data.summary);
            setSettlements(data.recentSettlements || []);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadSettlements();
    }, [loadSettlements]);

    async function runAudit() {
        if (auditing) return;

        setAuditing(true);
        setAuditError("");

        try {
            const result = await authenticatedAdminRequest(
                "/admin/settlements/reconciliation"
            );

            setAudit(result);
        } catch (err) {
            setAuditError(err.message);
        } finally {
            setAuditing(false);
        }
    }

    return (
        <AdminShell title="Settlements & Audit">
            <div className="space-y-6">
                <section className="flex flex-wrap items-start justify-between gap-4 rounded-[24px] bg-white p-6 shadow-sm">
                    <div>
                        <p className="text-xs font-bold uppercase tracking-wider text-[#087F5B]">
                            Financial Monitoring
                        </p>
                        <h2 className="mt-2 text-2xl font-extrabold">
                            Commission Settlements
                        </h2>
                        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
                            Review completed ride settlements, outstanding commissions,
                            failed processing attempts and ledger consistency.
                        </p>
                    </div>

                    <button
                        type="button"
                        onClick={loadSettlements}
                        disabled={loading}
                        className="flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-3 text-sm font-bold disabled:opacity-50"
                    >
                        <RefreshCw size={17} className={loading ? "animate-spin" : ""} />
                        Refresh
                    </button>
                </section>

                <div className="grid gap-4 sm:grid-cols-3">
                    <SummaryCard
                        icon={Clock3}
                        title="Pending Settlements"
                        value={summary?.pending ?? "—"}
                        color="amber"
                    />
                    <SummaryCard
                        icon={CheckCircle2}
                        title="Settled Rides"
                        value={summary?.settled ?? "—"}
                        color="green"
                    />
                    <SummaryCard
                        icon={AlertTriangle}
                        title="Failed Settlements"
                        value={summary?.failed ?? "—"}
                        color="red"
                    />
                </div>

                {error && (
                    <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-600">
                        {error}
                    </p>
                )}

                <section className="overflow-hidden rounded-[24px] bg-white shadow-sm">
                    <div className="border-b border-slate-100 p-6">
                        <h3 className="flex items-center gap-2 text-lg font-extrabold">
                            <ReceiptText size={21} className="text-[#087F5B]" />
                            Recent Settled Trips
                        </h3>
                        <p className="mt-1 text-xs text-slate-500">
                            Latest 20 recorded settlements
                        </p>
                    </div>

                    {loading ? (
                        <p className="p-10 text-center text-sm text-slate-500">
                            Loading settlements...
                        </p>
                    ) : settlements.length === 0 ? (
                        <div className="p-10 text-center">
                            <Wallet size={32} className="mx-auto text-[#087F5B]" />
                            <p className="mt-3 font-bold">No settled trips yet</p>
                            <p className="mt-2 text-sm text-slate-500">
                                Settlements will appear here after financial processing is enabled.
                            </p>
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full min-w-[760px] text-left text-sm">
                                <thead className="bg-slate-50 text-xs text-slate-500">
                                    <tr>
                                        <th className="px-5 py-4">Ride ID</th>
                                        <th className="px-5 py-4">Cash Fare</th>
                                        <th className="px-5 py-4">Commission</th>
                                        <th className="px-5 py-4">Driver Earnings</th>
                                        <th className="px-5 py-4">Settled On</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {settlements.map((item) => (
                                        <tr key={item._id} className="border-t border-slate-100">
                                            <td className="px-5 py-4 font-mono text-xs">
                                                {String(item.rideId).slice(-10)}
                                            </td>
                                            <td className="px-5 py-4">{money(item.fare)}</td>
                                            <td className="px-5 py-4 text-red-600">
                                                {money(item.commission)}
                                            </td>
                                            <td className="px-5 py-4 font-bold text-[#087F5B]">
                                                {money(item.driverEarnings)}
                                            </td>
                                            <td className="px-5 py-4 text-slate-500">
                                                {formatDate(item.settledAt)}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </section>

                <section className="rounded-[24px] bg-white p-6 shadow-sm">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                        <div>
                            <h3 className="flex items-center gap-2 text-lg font-extrabold">
                                <ShieldCheck size={22} className="text-[#087F5B]" />
                                Financial Reconciliation
                            </h3>
                            <p className="mt-2 max-w-xl text-sm leading-6 text-slate-500">
                                Run a read-only check for missing settlement records
                                or commission ledger mismatches.
                            </p>
                        </div>

                        <button
                            type="button"
                            onClick={runAudit}
                            disabled={auditing}
                            className="flex items-center gap-2 rounded-xl bg-[#087F5B] px-5 py-3 text-sm font-bold text-white disabled:opacity-50"
                        >
                            <SearchCheck size={18} />
                            {auditing ? "Checking..." : "Run Reconciliation"}
                        </button>
                    </div>

                    {auditError && (
                        <p role="alert" className="mt-5 rounded-xl bg-red-50 p-4 text-sm text-red-600">
                            {auditError}
                        </p>
                    )}

                    {audit && (
                        <div className="mt-6 space-y-4">
                            <div className="grid grid-cols-2 gap-3">
                                <div className="rounded-xl bg-slate-50 p-4">
                                    <p className="text-xs text-slate-500">Records Checked</p>
                                    <p className="mt-1 text-2xl font-extrabold">
                                        {audit.checked}
                                    </p>
                                </div>
                                <div className="rounded-xl bg-slate-50 p-4">
                                    <p className="text-xs text-slate-500">Issues Found</p>
                                    <p className="mt-1 text-2xl font-extrabold">
                                        {audit.issueCount}
                                    </p>
                                </div>
                            </div>

                            {audit.issues?.length === 0 ? (
                                <p className="rounded-xl bg-emerald-50 p-4 text-sm font-semibold text-[#087F5B]">
                                    No issues found in the checked sample.
                                </p>
                            ) : (
                                <div className="space-y-2">
                                    {audit.issues?.map((issue, index) => (
                                        <div
                                            key={`${issue.rideId}-${index}`}
                                            className="rounded-xl border border-amber-200 bg-amber-50 p-4"
                                        >
                                            <p className="font-mono text-xs text-slate-500">
                                                Ride: {issue.rideId}
                                            </p>
                                            <p className="mt-1 text-sm font-semibold text-amber-800">
                                                {issue.issue}
                                            </p>
                                        </div>
                                    ))}
                                </div>
                            )}

                            <p className="text-xs text-slate-500">
                                This check reviews a maximum of 100 settled rides.
                                It is not a complete financial audit.
                            </p>
                        </div>
                    )}
                </section>
            </div>
        </AdminShell>
    );
}
