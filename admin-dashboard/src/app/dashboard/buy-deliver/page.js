"use client";

import { useCallback, useEffect, useState } from "react";
import {
    RefreshCw, Search, ShieldCheck, XCircle,
    AlertCircle, CheckCircle2, Eye,
} from "lucide-react";
import AdminShell from "@/components/AdminShell";
import { useAdminDialog } from "@/components/AdminDialog";
import { authenticatedAdminRequest } from "@/lib/adminSession";

const ORDER_STATUSES = [
    "REQUESTED", "BIDDING", "DRIVER_SELECTED", "SHOPPING",
    "AWAITING_APPROVAL", "PURCHASE_APPROVED", "PURCHASED",
    "OUT_FOR_DELIVERY", "ARRIVED", "DELIVERED", "COMPLETED",
    "CANCELLED", "FAILED", "DISPUTED",
];

const STATUS_CLASSES = {
    REQUESTED: "bg-amber-50 text-amber-700",
    BIDDING: "bg-amber-50 text-amber-700",
    DRIVER_SELECTED: "bg-sky-50 text-sky-700",
    SHOPPING: "bg-sky-50 text-sky-700",
    AWAITING_APPROVAL: "bg-amber-50 text-amber-700",
    PURCHASE_APPROVED: "bg-sky-50 text-sky-700",
    PURCHASED: "bg-sky-50 text-sky-700",
    OUT_FOR_DELIVERY: "bg-sky-50 text-sky-700",
    ARRIVED: "bg-sky-50 text-sky-700",
    DELIVERED: "bg-emerald-50 text-[#087F5B]",
    COMPLETED: "bg-emerald-50 text-[#087F5B]",
    CANCELLED: "bg-slate-100 text-slate-600",
    FAILED: "bg-red-50 text-red-600",
    DISPUTED: "bg-red-50 text-red-600",
};

const money = (amount) =>
    amount == null ? "—" : `PKR ${Number(amount).toLocaleString("en-PK")}`;

const pretty = (value) => String(value || "").replaceAll("_", " ");

const personName = (person) =>
    [person?.firstName, person?.lastName].filter(Boolean).join(" ") ||
    person?.email ||
    "—";

const when = (value) =>
    value ? new Date(value).toLocaleString("en-PK") : "—";

export default function BuyDeliverAdminPage() {
    const [orders, setOrders] = useState([]);
    const [status, setStatus] = useState("ALL");
    const [query, setQuery] = useState("");
    const [from, setFrom] = useState("");
    const [to, setTo] = useState("");
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [message, setMessage] = useState("");

    const [settings, setSettings] = useState(null);
    const [settingsForm, setSettingsForm] = useState(null);
    const [settingsSaving, setSettingsSaving] = useState(false);

    const [detail, setDetail] = useState(null);
    const [detailLoading, setDetailLoading] = useState(false);

    const loadOrders = useCallback(async () => {
        setLoading(true);
        setError("");

        try {
            const params = new URLSearchParams({ limit: "100" });
            if (status !== "ALL") params.set("status", status);
            if (query.trim()) params.set("q", query.trim());
            if (from) params.set("from", from);
            if (to) params.set("to", to);

            const data = await authenticatedAdminRequest(
                `/admin/purchases/orders?${params}`
            );
            setOrders(data.orders || []);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, [status, query, from, to]);

    const loadSettings = useCallback(async () => {
        try {
            const data = await authenticatedAdminRequest(
                "/admin/purchases/settings"
            );
            setSettings(data.settings || null);
            setSettingsForm(
                data.settings
                    ? {
                        ...data.settings,
                        buyDeliverBlockedTerms: (
                            data.settings.buyDeliverBlockedTerms || []
                        ).join(", "),
                    }
                    : null
            );
        } catch {
            // Settings are secondary to the orders list; the orders
            // error surface already reports connectivity problems.
        }
    }, []);

    useEffect(() => {
        void (async () => {
            await Promise.resolve();
            await loadOrders();
        })();
    }, [loadOrders]);

    useEffect(() => {
        void (async () => {
            await Promise.resolve();
            await loadSettings();
        })();
    }, [loadSettings]);

    async function saveSettings() {
        if (!settingsForm) return;
        setSettingsSaving(true);
        setError("");
        setMessage("");

        try {
            const data = await authenticatedAdminRequest(
                "/admin/purchases/settings",
                {
                    method: "PATCH",
                    body: JSON.stringify({
                        buyDeliverEnabled:
                            settingsForm.buyDeliverEnabled === true,
                        buyDeliverMaxOrderValue:
                            settingsForm.buyDeliverMaxOrderValue === "" ||
                                settingsForm.buyDeliverMaxOrderValue == null
                                ? null
                                : Number(settingsForm.buyDeliverMaxOrderValue),
                        buyDeliverRadiusKm: Number(settingsForm.buyDeliverRadiusKm),
                        buyDeliverBlockedTerms: String(
                            settingsForm.buyDeliverBlockedTerms || ""
                        )
                            .split(",")
                            .map((term) => term.trim())
                            .filter(Boolean),
                    }),
                }
            );

            setSettings(data.settings);
            setMessage("Buy & Deliver settings saved.");
            await loadSettings();
        } catch (err) {
            setError(err.message);
        } finally {
            setSettingsSaving(false);
        }
    }

    async function openOrder(orderId) {
        setDetailLoading(true);
        setError("");

        try {
            const data = await authenticatedAdminRequest(
                `/admin/purchases/orders/${orderId}`
            );
            setDetail(data);
        } catch (err) {
            setError(err.message);
        } finally {
            setDetailLoading(false);
        }
    }

    return (
        <AdminShell title="Buy & Deliver">
            <div className="space-y-5">
                <div className="rounded-2xl bg-white p-6 shadow-sm">
                    <h2 className="text-2xl font-extrabold">Buy & Deliver Orders</h2>
                    <p className="mt-2 text-sm text-slate-500">
                        Shopping orders, budgets vs actual spend, reimbursements,
                        disputes and partner restrictions. Shopping money is a
                        reimbursement — only the delivery fee is partner earnings.
                    </p>

                    <div className="mt-4 flex flex-wrap items-end gap-3">
                        <label className="block">
                            <span className="mb-1.5 block text-xs font-bold text-slate-500">Status</span>
                            <select
                                value={status}
                                onChange={(e) => setStatus(e.target.value)}
                                className="rounded-xl border p-3 text-sm"
                            >
                                <option value="ALL">All statuses</option>
                                {ORDER_STATUSES.map((value) => (
                                    <option key={value} value={value}>
                                        {pretty(value)}
                                    </option>
                                ))}
                            </select>
                        </label>

                        <label className="block">
                            <span className="mb-1.5 block text-xs font-bold text-slate-500">From</span>
                            <input
                                type="date"
                                value={from}
                                onChange={(e) => setFrom(e.target.value)}
                                className="rounded-xl border p-3 text-sm"
                            />
                        </label>

                        <label className="block">
                            <span className="mb-1.5 block text-xs font-bold text-slate-500">To</span>
                            <input
                                type="date"
                                value={to}
                                onChange={(e) => setTo(e.target.value)}
                                className="rounded-xl border p-3 text-sm"
                            />
                        </label>

                        <div className="flex min-w-[220px] flex-1 items-center gap-2 rounded-xl border px-3">
                            <Search size={17} className="text-slate-400" />
                            <input
                                type="search"
                                value={query}
                                onChange={(e) => setQuery(e.target.value)}
                                placeholder="Search item lists…"
                                className="h-11 min-w-0 flex-1 bg-transparent text-sm outline-none"
                            />
                        </div>

                        <button
                            type="button"
                            onClick={loadOrders}
                            disabled={loading}
                            className="flex items-center gap-2 rounded-xl bg-[#087F5B] px-5 py-3 text-sm font-bold text-white disabled:opacity-50"
                        >
                            <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
                            Refresh
                        </button>
                    </div>
                </div>

                {error && (
                    <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-600">
                        <AlertCircle size={16} className="mr-2 inline" />
                        {error}
                    </p>
                )}

                {message && (
                    <p role="status" className="rounded-xl bg-emerald-50 p-4 text-sm font-semibold text-[#087F5B]">
                        {message}
                    </p>
                )}

                <div className="overflow-x-auto rounded-2xl bg-white shadow-sm">
                    <table className="w-full min-w-[900px] text-left text-sm">
                        <thead>
                            <tr className="border-b text-xs uppercase tracking-wide text-slate-400">
                                <th className="px-5 py-4 font-bold">Created</th>
                                <th className="px-5 py-4 font-bold">Passenger</th>
                                <th className="px-5 py-4 font-bold">Partner</th>
                                <th className="px-5 py-4 font-bold">Items</th>
                                <th className="px-5 py-4 font-bold">Budget / Actual</th>
                                <th className="px-5 py-4 font-bold">Status</th>
                                <th className="px-5 py-4 font-bold">Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            {orders.map((order) => (
                                <tr key={order._id} className="border-b last:border-0">
                                    <td className="whitespace-nowrap px-5 py-4 text-slate-500">
                                        {when(order.createdAt)}
                                    </td>
                                    <td className="px-5 py-4">
                                        <p className="font-bold">{personName(order.passengerId)}</p>
                                        <p className="text-xs text-slate-500">{order.passengerId?.email || ""}</p>
                                    </td>
                                    <td className="px-5 py-4">
                                        {order.driverId ? (
                                            <>
                                                <p className="font-bold">{personName(order.driverId.userId)}</p>
                                                <p className="text-xs text-slate-500">{order.driverId.userId?.email || ""}</p>
                                            </>
                                        ) : (
                                            <span className="text-slate-400">Unassigned</span>
                                        )}
                                    </td>
                                    <td className="max-w-[260px] px-5 py-4 text-slate-600">
                                        <span className="line-clamp-2">{order.itemsText}</span>
                                    </td>
                                    <td className="whitespace-nowrap px-5 py-4">
                                        {money(order.estimatedBudget)} / {money(order.actualCost)}
                                    </td>
                                    <td className="px-5 py-4">
                                        <span className={`rounded-lg px-2.5 py-1 text-[11px] font-bold ${STATUS_CLASSES[order.status] || "bg-slate-100 text-slate-600"}`}>
                                            {pretty(order.status)}
                                        </span>
                                    </td>
                                    <td className="px-5 py-4">
                                        <button
                                            type="button"
                                            onClick={() => openOrder(order._id)}
                                            className="flex items-center gap-1.5 rounded-lg bg-emerald-50 px-3 py-2 text-xs font-bold text-[#087F5B]"
                                        >
                                            <Eye size={14} />
                                            View
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>

                    {!loading && orders.length === 0 && (
                        <p className="p-6 text-slate-500">No purchase orders found.</p>
                    )}
                    {loading && (
                        <p className="p-6 text-slate-500">Loading orders…</p>
                    )}
                </div>

                {settingsForm && (
                    <div className="rounded-2xl bg-white p-6 shadow-sm">
                        <h3 className="text-lg font-extrabold">Buy & Deliver Settings</h3>
                        <p className="mt-1 text-sm text-slate-500">
                            Current: feature {settings?.buyDeliverEnabled === false ? "OFF" : "ON"} ·
                            platform cap {settings?.buyDeliverMaxOrderValue == null ? "none" : money(settings.buyDeliverMaxOrderValue)} ·
                            matching radius {settings?.buyDeliverRadiusKm ?? 15} km.
                            An empty blocked-terms list restores the built-in defaults — it never means “no restrictions”.
                        </p>

                        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                            <label className="flex items-center gap-3 rounded-xl border p-3 text-sm font-semibold">
                                <input
                                    type="checkbox"
                                    checked={settingsForm.buyDeliverEnabled === true}
                                    onChange={(e) =>
                                        setSettingsForm((prev) => ({
                                            ...prev,
                                            buyDeliverEnabled: e.target.checked,
                                        }))
                                    }
                                    className="h-4 w-4 accent-[#087F5B]"
                                />
                                Feature enabled
                            </label>

                            <label className="block">
                                <span className="mb-1.5 block text-xs font-bold text-slate-500">
                                    Max order value (PKR, blank = no cap)
                                </span>
                                <input
                                    type="number"
                                    min="1"
                                    step="1"
                                    value={settingsForm.buyDeliverMaxOrderValue ?? ""}
                                    onChange={(e) =>
                                        setSettingsForm((prev) => ({
                                            ...prev,
                                            buyDeliverMaxOrderValue: e.target.value,
                                        }))
                                    }
                                    className="w-full rounded-xl border p-3 text-sm"
                                />
                            </label>

                            <label className="block">
                                <span className="mb-1.5 block text-xs font-bold text-slate-500">
                                    Matching radius (km)
                                </span>
                                <input
                                    type="number"
                                    min="1"
                                    max="100"
                                    step="1"
                                    value={settingsForm.buyDeliverRadiusKm ?? 15}
                                    onChange={(e) =>
                                        setSettingsForm((prev) => ({
                                            ...prev,
                                            buyDeliverRadiusKm: e.target.value,
                                        }))
                                    }
                                    className="w-full rounded-xl border p-3 text-sm"
                                />
                            </label>

                            <label className="block">
                                <span className="mb-1.5 block text-xs font-bold text-slate-500">
                                    Blocked terms (comma separated)
                                </span>
                                <input
                                    type="text"
                                    value={settingsForm.buyDeliverBlockedTerms || ""}
                                    onChange={(e) =>
                                        setSettingsForm((prev) => ({
                                            ...prev,
                                            buyDeliverBlockedTerms: e.target.value,
                                        }))
                                    }
                                    className="w-full rounded-xl border p-3 text-sm"
                                />
                            </label>
                        </div>

                        <button
                            type="button"
                            onClick={saveSettings}
                            disabled={settingsSaving}
                            className="mt-4 rounded-xl bg-[#087F5B] px-5 py-3 text-sm font-bold text-white disabled:opacity-50"
                        >
                            {settingsSaving ? "Saving…" : "Save settings"}
                        </button>
                    </div>
                )}
            </div>

            {(detail || detailLoading) && (
                <OrderDetailModal
                    key={detail?.order?._id || "loading"}
                    detail={detail}
                    loading={detailLoading}
                    onClose={() => setDetail(null)}
                    onChanged={async () => {
                        await loadOrders();
                        if (detail?.order?._id) await openOrder(detail.order._id);
                    }}
                />
            )}
        </AdminShell>
    );
}

function OrderDetailModal({ detail, loading, onClose, onChanged }) {
    const { confirmDialog } = useAdminDialog();
    const [conversations, setConversations] = useState(null);
    const [activeConversation, setActiveConversation] = useState(null);
    const [messages, setMessages] = useState([]);
    const [chatBusy, setChatBusy] = useState(false);

    const [outcome, setOutcome] = useState("COMPLETED");
    const [paymentAmount, setPaymentAmount] = useState("");
    const [resolutionNote, setResolutionNote] = useState("");
    const [resolving, setResolving] = useState(false);
    const [actionError, setActionError] = useState("");

    const [restrictReason, setRestrictReason] = useState("");
    const [restricting, setRestricting] = useState(false);
    const [actionMessage, setActionMessage] = useState("");

    const order = detail?.order;

    // State starts fresh for every order: the parent mounts this
    // component with key={order id}, so no reset effect is needed.

    if (!order) {
        return (
            <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-6" role="dialog" aria-modal="true">
                <div className="rounded-3xl bg-white p-8 text-sm text-slate-500 shadow-xl">
                    {loading ? "Loading order…" : "Order unavailable."}
                    <button type="button" onClick={onClose} className="ml-4 rounded-xl border px-4 py-2 font-bold text-slate-700">
                        Close
                    </button>
                </div>
            </div>
        );
    }

    async function loadConversations() {
        setChatBusy(true);
        setActionError("");
        try {
            const data = await authenticatedAdminRequest(
                `/admin/purchases/orders/${order._id}/conversations`
            );
            setConversations(data.conversations || []);
        } catch (err) {
            setActionError(err.message);
        } finally {
            setChatBusy(false);
        }
    }

    async function openConversation(conversation) {
        setActiveConversation(conversation);
        setChatBusy(true);
        setActionError("");
        try {
            const data = await authenticatedAdminRequest(
                `/admin/purchases/orders/${order._id}/conversations/${conversation._id}/messages?limit=200`
            );
            setMessages(data.messages || []);
        } catch (err) {
            setActionError(err.message);
        } finally {
            setChatBusy(false);
        }
    }

    async function resolveDispute() {
        if (!resolutionNote.trim()) {
            setActionError("A resolution note is required.");
            return;
        }
        if (!(await confirmDialog(`Resolve this dispute as ${outcome}? This closes the order.`))) return;

        setResolving(true);
        setActionError("");
        setActionMessage("");
        try {
            await authenticatedAdminRequest(
                `/admin/purchases/orders/${order._id}/resolve-dispute`,
                {
                    method: "POST",
                    body: JSON.stringify({
                        outcome,
                        note: resolutionNote.trim(),
                        ...(outcome === "COMPLETED" && paymentAmount !== ""
                            ? { paymentAmount: Number(paymentAmount) }
                            : {}),
                    }),
                }
            );
            setActionMessage(`Dispute resolved as ${pretty(outcome)}.`);
            await onChanged();
        } catch (err) {
            setActionError(err.message);
        } finally {
            setResolving(false);
        }
    }

    async function restrictPartner() {
        if (!restrictReason.trim()) {
            setActionError("A restriction reason is required.");
            return;
        }
        if (!(await confirmDialog("Suspend this partner's Buy & Deliver service? Their other services stay untouched.", { danger: true }))) return;

        setRestricting(true);
        setActionError("");
        setActionMessage("");
        try {
            await authenticatedAdminRequest(
                `/admin/purchases/orders/${order._id}/restrict-partner`,
                {
                    method: "POST",
                    body: JSON.stringify({ reason: restrictReason.trim() }),
                }
            );
            setActionMessage("Partner's Buy & Deliver service suspended.");
            setRestrictReason("");
            await onChanged();
        } catch (err) {
            setActionError(err.message);
        } finally {
            setRestricting(false);
        }
    }

    const financials = [
        ["Passenger budget", money(order.estimatedBudget)],
        ["Partner estimate", money(order.estimatedCost)],
        ["Approved maximum", money(order.approvedMaxAmount)],
        ["Actual spend (receipt)", money(order.actualCost)],
        ["Delivery fee (earnings)", money(order.deliveryFee)],
        ["Customer total payable", money(order.customerTotalPayable)],
        ["Reimbursement received", money(order.reimbursementReceived || 0)],
        ["Unpaid amount", money(order.unpaidAmount || 0)],
        ["Settlement status", pretty(order.settlementStatus)],
    ];

    return (
        <div
            className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-6"
            role="dialog"
            aria-modal="true"
            aria-label="Purchase order details"
            onClick={onClose}
        >
            <div
                className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-t-3xl bg-white p-6 shadow-xl sm:rounded-3xl"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-start justify-between gap-3">
                    <div>
                        <h3 className="text-xl font-extrabold">Purchase order</h3>
                        <p className="mt-1 text-sm text-slate-500">
                            {order._id} · created {when(order.createdAt)}
                        </p>
                    </div>
                    <span className={`rounded-lg px-2.5 py-1 text-[11px] font-bold ${STATUS_CLASSES[order.status] || "bg-slate-100 text-slate-600"}`}>
                        {pretty(order.status)}
                    </span>
                </div>

                {actionError && (
                    <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-600">
                        {actionError}
                    </p>
                )}
                {actionMessage && (
                    <p role="status" className="mt-4 rounded-xl bg-emerald-50 p-3 text-sm font-semibold text-[#087F5B]">
                        <CheckCircle2 size={15} className="mr-1.5 inline" />
                        {actionMessage}
                    </p>
                )}

                <div className="mt-5 grid gap-5 lg:grid-cols-2">
                    <section>
                        <h4 className="text-sm font-extrabold uppercase tracking-wide text-slate-400">Participants</h4>
                        <dl className="mt-2 space-y-2 text-sm">
                            <div>
                                <dt className="font-bold text-slate-500">Passenger</dt>
                                <dd>{personName(order.passengerId)} · {order.passengerId?.email || "—"}</dd>
                            </div>
                            <div>
                                <dt className="font-bold text-slate-500">Assigned partner</dt>
                                <dd>
                                    {order.driverId
                                        ? `${personName(order.driverId.userId)} · ${order.driverId.userId?.email || "—"}`
                                        : "None yet"}
                                </dd>
                            </div>
                            <div>
                                <dt className="font-bold text-slate-500">Delivery to</dt>
                                <dd>{order.deliveryLabel || "—"} {order.deliveryAddress?.address ? `· ${order.deliveryAddress.address}` : ""}</dd>
                            </div>
                        </dl>

                        <h4 className="mt-5 text-sm font-extrabold uppercase tracking-wide text-slate-400">Shopping list</h4>
                        <p className="mt-2 whitespace-pre-wrap rounded-xl bg-slate-50 p-3 text-sm">
                            {order.itemsText}
                        </p>
                        {(order.preferences?.preferredShop || order.preferences?.preferredBrand || order.deliveryNotes) && (
                            <p className="mt-2 text-sm text-slate-600">
                                {order.preferences?.preferredShop && <>Shop: {order.preferences.preferredShop}. </>}
                                {order.preferences?.preferredBrand && <>Brand: {order.preferences.preferredBrand}. </>}
                                {order.preferences?.alternativesAllowed ? "Alternatives allowed. " : "No alternatives. "}
                                {order.deliveryNotes && <>Notes: {order.deliveryNotes}</>}
                            </p>
                        )}

                        {order.imageUrls?.length > 0 && (
                            <p className="mt-2 text-sm">
                                Reference photos:{" "}
                                {order.imageUrls.map((url, i) => (
                                    <a key={url} href={url} target="_blank" rel="noreferrer" className="font-bold text-[#087F5B] underline">
                                        {i + 1}{" "}
                                    </a>
                                ))}
                            </p>
                        )}

                        {order.receiptImageUrls?.length > 0 && (
                            <p className="mt-2 text-sm">
                                Receipts:{" "}
                                {order.receiptImageUrls.map((url, i) => (
                                    <a key={url} href={url} target="_blank" rel="noreferrer" className="font-bold text-[#087F5B] underline">
                                        {i + 1}{" "}
                                    </a>
                                ))}
                            </p>
                        )}

                        {order.substitutions?.length > 0 && (
                            <>
                                <h4 className="mt-5 text-sm font-extrabold uppercase tracking-wide text-slate-400">Substitutions</h4>
                                <ul className="mt-2 space-y-1 text-sm">
                                    {order.substitutions.map((sub, i) => (
                                        <li key={i} className="rounded-lg bg-slate-50 px-3 py-2">
                                            {sub.description} — <span className="font-bold">{pretty(sub.status)}</span>
                                        </li>
                                    ))}
                                </ul>
                            </>
                        )}
                    </section>

                    <section>
                        <h4 className="text-sm font-extrabold uppercase tracking-wide text-slate-400">Money</h4>
                        <dl className="mt-2 divide-y rounded-xl border text-sm">
                            {financials.map(([label, value]) => (
                                <div key={label} className="flex items-center justify-between px-3 py-2">
                                    <dt className="text-slate-500">{label}</dt>
                                    <dd className="font-bold">{value}</dd>
                                </div>
                            ))}
                        </dl>
                        <p className="mt-2 text-xs text-slate-500">
                            Reimbursement status: {money(detail.reimbursement?.reimbursementReceived || 0)} of the
                            shopping spend repaid, {money(detail.reimbursement?.unpaidAmount || 0)} unpaid.
                            Commission settles on the delivery fee only.
                        </p>

                        {detail.settlement && (
                            <p className="mt-2 text-sm text-slate-600">
                                Settlement: {pretty(detail.settlement.status)} · fee {money(detail.settlement.fare)} ·
                                commission {money(detail.settlement.commission)} · partner net {money(detail.settlement.driverEarnings)}
                            </p>
                        )}

                        {detail.offers?.length > 0 && (
                            <>
                                <h4 className="mt-5 text-sm font-extrabold uppercase tracking-wide text-slate-400">Offers</h4>
                                <ul className="mt-2 space-y-1 text-sm">
                                    {detail.offers.map((offer) => (
                                        <li key={offer._id} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
                                            <span>{personName(offer.driver?.userId)} — {money(offer.deliveryFee)}</span>
                                            <span className="font-bold">{pretty(offer.status)}</span>
                                        </li>
                                    ))}
                                </ul>
                            </>
                        )}
                    </section>
                </div>

                {(order.disputedBy || order.disputeResolution?.outcome) && (
                    <section className="mt-6 rounded-2xl border border-red-100 bg-red-50/50 p-4">
                        <h4 className="text-sm font-extrabold uppercase tracking-wide text-red-500">Dispute</h4>
                        {order.disputedBy && (
                            <p className="mt-2 text-sm">
                                Raised by {pretty(order.disputedBy)} on {when(order.disputedAt)}: {order.disputeReason || "—"}
                            </p>
                        )}
                        {order.disputeResolution?.outcome ? (
                            <p className="mt-2 text-sm">
                                Resolved as <span className="font-bold">{pretty(order.disputeResolution.outcome)}</span> on{" "}
                                {when(order.disputeResolution.resolvedAt)} — {order.disputeResolution.note}
                            </p>
                        ) : order.status === "DISPUTED" ? (
                            <div className="mt-3 grid gap-3 sm:grid-cols-[170px_170px_1fr]">
                                <label className="block">
                                    <span className="mb-1.5 block text-xs font-bold text-slate-500">Outcome</span>
                                    <select
                                        value={outcome}
                                        onChange={(e) => setOutcome(e.target.value)}
                                        className="w-full rounded-xl border p-3 text-sm"
                                    >
                                        <option value="COMPLETED">Completed (settled)</option>
                                        <option value="CANCELLED">Cancelled (void)</option>
                                    </select>
                                </label>
                                <label className="block">
                                    <span className="mb-1.5 block text-xs font-bold text-slate-500">
                                        Payment recorded (PKR)
                                    </span>
                                    <input
                                        type="number"
                                        min="1"
                                        step="1"
                                        value={paymentAmount}
                                        onChange={(e) => setPaymentAmount(e.target.value)}
                                        disabled={outcome !== "COMPLETED"}
                                        placeholder="Only if now paid"
                                        className="w-full rounded-xl border p-3 text-sm disabled:opacity-40"
                                    />
                                </label>
                                <label className="block">
                                    <span className="mb-1.5 block text-xs font-bold text-slate-500">Resolution note</span>
                                    <input
                                        type="text"
                                        maxLength={500}
                                        value={resolutionNote}
                                        onChange={(e) => setResolutionNote(e.target.value)}
                                        placeholder="What was decided and why"
                                        className="w-full rounded-xl border p-3 text-sm"
                                    />
                                </label>
                                <button
                                    type="button"
                                    onClick={resolveDispute}
                                    disabled={resolving}
                                    className="rounded-xl bg-red-600 px-5 py-3 text-sm font-bold text-white disabled:opacity-50 sm:col-span-3"
                                >
                                    {resolving ? "Resolving…" : "Resolve dispute"}
                                </button>
                            </div>
                        ) : null}
                    </section>
                )}

                <section className="mt-6">
                    <div className="flex items-center justify-between">
                        <h4 className="text-sm font-extrabold uppercase tracking-wide text-slate-400">
                            Conversation evidence
                        </h4>
                        <button
                            type="button"
                            onClick={loadConversations}
                            disabled={chatBusy}
                            className="rounded-lg bg-emerald-50 px-3 py-2 text-xs font-bold text-[#087F5B] disabled:opacity-50"
                        >
                            {chatBusy ? "Loading…" : conversations ? "Reload threads" : "Load threads"}
                        </button>
                    </div>

                    {conversations && conversations.length === 0 && (
                        <p className="mt-2 text-sm text-slate-500">No chat threads on this order.</p>
                    )}

                    {conversations?.map((conversation) => (
                        <div key={conversation._id} className="mt-2 rounded-xl border p-3">
                            <button
                                type="button"
                                onClick={() => openConversation(conversation)}
                                className="flex w-full flex-wrap items-center justify-between gap-2 text-left text-sm"
                            >
                                <span className="font-bold">
                                    {personName(conversation.partnerUserId)}
                                    <span className="ml-2 font-normal text-slate-500">
                                        {conversation.messageCount} messages · stored {pretty(conversation.status)}
                                    </span>
                                </span>
                                <span className="text-xs text-slate-500">
                                    {conversation.lastMessage
                                        ? `${pretty(conversation.lastMessage.senderRole)}: ${conversation.lastMessage.body || conversation.lastMessage.eventType || "image"}`
                                        : "No messages"}
                                </span>
                            </button>

                            {activeConversation?._id === conversation._id && (
                                <div className="mt-3 max-h-80 space-y-2 overflow-y-auto rounded-xl bg-slate-50 p-3">
                                    {messages.map((msg) => (
                                        <div key={msg._id} className="rounded-lg bg-white px-3 py-2 text-sm shadow-sm">
                                            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
                                                {pretty(msg.senderRole)} · {when(msg.createdAt)}
                                                {msg.kind === "EVENT" && msg.eventType ? ` · ${pretty(msg.eventType)}` : ""}
                                            </p>
                                            {msg.kind === "IMAGE" && msg.imageUrl ? (
                                                <a href={msg.imageUrl} target="_blank" rel="noreferrer" className="font-bold text-[#087F5B] underline">
                                                    View image
                                                </a>
                                            ) : (
                                                <p className="whitespace-pre-wrap">{msg.body || msg.event?.note || ""}</p>
                                            )}
                                            {msg.kind === "EVENT" && msg.event?.amount != null && (
                                                <p className="text-xs font-bold text-slate-500">Amount: {money(msg.event.amount)}</p>
                                            )}
                                        </div>
                                    ))}
                                    {messages.length === 0 && (
                                        <p className="text-sm text-slate-500">No messages in this thread.</p>
                                    )}
                                </div>
                            )}
                        </div>
                    ))}
                </section>

                <section className="mt-6">
                    <h4 className="text-sm font-extrabold uppercase tracking-wide text-slate-400">Audit trail</h4>
                    <ol className="mt-2 space-y-1.5 text-sm">
                        {(order.events || []).map((event, i) => (
                            <li key={i} className="flex flex-wrap gap-x-3 rounded-lg bg-slate-50 px-3 py-2">
                                <span className="font-bold">{pretty(event.type)}</span>
                                <span className="text-slate-500">{pretty(event.actorRole)}</span>
                                {event.fromStatus && (
                                    <span className="text-slate-500">{pretty(event.fromStatus)} → {pretty(event.toStatus)}</span>
                                )}
                                {event.amount != null && <span className="font-bold">{money(event.amount)}</span>}
                                {event.note && <span className="text-slate-600">{event.note}</span>}
                                <span className="ml-auto text-xs text-slate-400">{when(event.createdAt)}</span>
                            </li>
                        ))}
                        {(order.events || []).length === 0 && (
                            <li className="text-slate-500">No events recorded.</li>
                        )}
                    </ol>
                </section>

                {order.driverId && (
                    <section className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-4">
                        <h4 className="flex items-center gap-2 text-sm font-extrabold uppercase tracking-wide text-amber-700">
                            <ShieldCheck size={16} />
                            Fraud restriction
                        </h4>
                        <p className="mt-1 text-sm text-amber-900">
                            Suspends only this partner&apos;s Buy &amp; Deliver service. Ride and Parcel stay as they are.
                        </p>
                        <div className="mt-3 flex flex-wrap gap-3">
                            <input
                                type="text"
                                maxLength={500}
                                value={restrictReason}
                                onChange={(e) => setRestrictReason(e.target.value)}
                                placeholder="Reason (recorded on the partner's service record)"
                                className="min-w-[260px] flex-1 rounded-xl border p-3 text-sm"
                            />
                            <button
                                type="button"
                                onClick={restrictPartner}
                                disabled={restricting}
                                className="flex items-center gap-2 rounded-xl bg-red-600 px-5 py-3 text-sm font-bold text-white disabled:opacity-50"
                            >
                                <XCircle size={16} />
                                {restricting ? "Suspending…" : "Suspend Buy & Deliver"}
                            </button>
                        </div>
                    </section>
                )}

                <div className="mt-6 flex justify-end">
                    <button
                        type="button"
                        onClick={onClose}
                        className="rounded-xl border px-5 py-3 font-bold"
                    >
                        Close
                    </button>
                </div>
            </div>
        </div>
    );
}
