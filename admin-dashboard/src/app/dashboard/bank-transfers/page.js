"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, ShieldCheck } from "lucide-react";
import AdminShell from "@/components/AdminShell";
import { useAdminDialog } from "@/components/AdminDialog";
import { authenticatedAdminRequest } from "@/lib/adminSession";

const money = (amount) =>
    `PKR ${Number(amount ?? 0).toLocaleString("en-PK")}`;

export default function BankTransfersPage() {
    const { confirmDialog } = useAdminDialog();
    const [orders, setOrders] = useState([]);
    const [references, setReferences] = useState({});
    const [amounts, setAmounts] = useState({});
    const [loading, setLoading] = useState(true);
    const [busyId, setBusyId] = useState("");
    const [error, setError] = useState("");
    const [message, setMessage] = useState("");

    const loadOrders = useCallback(async () => {
        setLoading(true);
        setError("");

        try {
            const data = await authenticatedAdminRequest(
                "/admin/payment-gateways/bank-transfers/pending"
            );
            setOrders(data.orders || []);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadOrders();
    }, [loadOrders]);

    async function verifyOrder(order) {
        const bankReference = (references[order._id] || "").trim();
        const verifiedAmount = Number(amounts[order._id] ?? order.amount);

        if (
            bankReference.length < 6 ||
            !Number.isSafeInteger(verifiedAmount) ||
            verifiedAmount !== order.amount
        ) {
            setError("Bank reference aur exact matching amount enter karein.");
            return;
        }

        const confirmed = await confirmDialog(
            `Confirm karein ke bank statement mein PKR ${order.amount} ki payment verify ho chuki hai?`
        );

        if (!confirmed) return;

        setBusyId(order._id);
        setError("");
        setMessage("");

        try {
            const result = await authenticatedAdminRequest(
                `/admin/payment-gateways/bank-transfers/${order._id}/verify`,
                {
                    method: "POST",
                    body: JSON.stringify({
                        bankReference,
                        verifiedAmount,
                    }),
                }
            );

            setMessage(result.message || "Bank transfer processed.");
            await loadOrders();
        } catch (err) {
            setError(err.message);
        } finally {
            setBusyId("");
        }
    }

    return (
        <AdminShell title="Bank Transfer Verification">
            <div className="mx-auto max-w-5xl space-y-5">
                <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                    Bank statement mein payment khud verify karne ke baad hi
                    confirmation karein. Sirf driver ke bataye hue reference
                    par payment approve na karein.
                </section>

                {error && (
                    <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-700">
                        {error}
                    </p>
                )}

                {message && (
                    <p role="status" className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-800">
                        {message}
                    </p>
                )}

                <section className="rounded-2xl bg-white p-5 shadow-sm">
                    <div className="flex items-center justify-between gap-3">
                        <h2 className="text-lg font-extrabold">
                            Pending / Verified Transfers
                        </h2>
                        <button
                            type="button"
                            onClick={loadOrders}
                            disabled={loading}
                            className="flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold disabled:opacity-50"
                        >
                            <RefreshCw size={16} />
                            Refresh
                        </button>
                    </div>

                    {loading ? (
                        <p className="py-8 text-sm text-slate-500">Loading...</p>
                    ) : orders.length === 0 ? (
                        <p className="py-8 text-sm text-slate-500">
                            No pending bank transfers.
                        </p>
                    ) : (
                        <div className="mt-4 space-y-4">
                            {orders.map((order) => (
                                <article
                                    key={order._id}
                                    className="rounded-xl border border-slate-200 p-4"
                                >
                                    <div className="flex flex-wrap items-start justify-between gap-3">
                                        <div>
                                            <p className="text-sm font-bold">
                                                Order: {order._id}
                                            </p>
                                            <p className="mt-1 text-xs text-slate-500">
                                                Driver ID: {String(order.driverId)}
                                            </p>
                                            <p className="mt-1 text-xs text-slate-500">
                                                Created: {new Date(order.createdAt).toLocaleString("en-PK")}
                                            </p>
                                        </div>
                                        <div className="text-right">
                                            <p className="text-lg font-extrabold">
                                                {money(order.amount)}
                                            </p>
                                            <p className="text-xs font-semibold text-amber-700">
                                                {order.status}
                                            </p>
                                        </div>
                                    </div>

                                    {order.status === "PENDING" ? (
                                        <div className="mt-4 grid gap-3 sm:grid-cols-2">
                                            <label className="text-sm font-semibold">
                                                Bank Reference
                                                <input
                                                    value={references[order._id] || ""}
                                                    onChange={(e) =>
                                                        setReferences((old) => ({
                                                            ...old,
                                                            [order._id]: e.target.value,
                                                        }))
                                                    }
                                                    maxLength={150}
                                                    autoComplete="off"
                                                    className="mt-1 w-full rounded-xl border p-3 font-normal"
                                                    placeholder="Verified bank reference"
                                                />
                                            </label>

                                            <label className="text-sm font-semibold">
                                                Confirmed Amount (PKR)
                                                <input
                                                    type="number"
                                                    min="1"
                                                    step="1"
                                                    value={amounts[order._id] ?? order.amount}
                                                    onChange={(e) =>
                                                        setAmounts((old) => ({
                                                            ...old,
                                                            [order._id]: e.target.value,
                                                        }))
                                                    }
                                                    className="mt-1 w-full rounded-xl border p-3 font-normal"
                                                />
                                            </label>

                                            <button
                                                type="button"
                                                disabled={Boolean(busyId)}
                                                onClick={() => verifyOrder(order)}
                                                className="flex items-center justify-center gap-2 rounded-xl bg-[#087F5B] p-3 font-bold text-white disabled:opacity-50 sm:col-span-2"
                                            >
                                                <ShieldCheck size={18} />
                                                {busyId === order._id
                                                    ? "Processing..."
                                                    : "Verify Payment & Credit Wallet"}
                                            </button>
                                        </div>
                                    ) : (
                                        <p className="mt-3 text-sm text-slate-500">
                                            Verified order — refresh after reconciliation if needed.
                                        </p>
                                    )}
                                </article>
                            ))}
                        </div>
                    )}
                </section>
            </div>
        </AdminShell>
    );
}