"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
    ArrowLeft,
    Banknote,
    Camera,
    CheckCircle2,
    CircleAlert,
    Flag,
    MapPin,
    MessageCircle,
    Navigation,
    Play,
    ReceiptText,
    RefreshCw,
    Replace,
    ShoppingBag,
    Store,
    Truck,
    UserRound,
    Wallet,
    X,
} from "lucide-react";

import AuthGuard from "@/components/AuthGuard";
import MobileBottomNav from "@/components/MobileBottomNav";
import OrderChat from "@/components/OrderChat";
import PurchaseTimeline from "@/components/order/PurchaseTimeline";
import { useAuth } from "@/context/AuthContext";
import { getRealtimeSocket } from "@/lib/socket";
import { uploadOrderImage } from "@/lib/orderChatService";
import {
    deliverPurchaseOrder,
    getDriverPurchaseDetails,
    markArrived,
    markOutForDelivery,
    markPurchased,
    raisePurchaseDispute,
    requestSubstitution,
    startShopping,
    submitCostEstimate,
    updateShoppingLocation,
} from "@/lib/purchaseService";

// Buy & Deliver execution — the assigned partner's step-by-step
// shopping workflow. Money rule, repeated in the UI wherever amounts
// appear: the delivery fee is the partner's earning; the shopping
// money is a reimbursement the passenger owes back, never earnings.

const money = (value) =>
    value == null ? "—" : `PKR ${Number(value).toLocaleString("en-PK")}`;

const WORKING_STATUSES = [
    "DRIVER_SELECTED",
    "SHOPPING",
    "AWAITING_APPROVAL",
    "PURCHASE_APPROVED",
    "PURCHASED",
    "OUT_FOR_DELIVERY",
    "ARRIVED",
];

export default function DriverBuyDeliverPage() {
    return (
        <AuthGuard role="DRIVER">
            <BuyDeliverScreen />
        </AuthGuard>
    );
}

function getPosition() {
    return new Promise((resolve, reject) => {
        if (!("geolocation" in navigator)) {
            reject(new Error("Location is not available on this device."));
            return;
        }
        navigator.geolocation.getCurrentPosition(
            (pos) =>
                resolve({
                    latitude: pos.coords.latitude,
                    longitude: pos.coords.longitude,
                }),
            () => reject(new Error("Could not get your current location.")),
            { enableHighAccuracy: true, timeout: 12000 }
        );
    });
}

function BuyDeliverScreen() {
    const { token, user } = useAuth();
    const searchParams = useSearchParams();
    const orderId = searchParams.get("id");

    const [order, setOrder] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState(null);
    const [busy, setBusy] = useState("");
    const [chatOpen, setChatOpen] = useState(false);

    const [storeName, setStoreName] = useState("");
    const [storeAddress, setStoreAddress] = useState("");
    const [estimateAmount, setEstimateAmount] = useState("");
    const [estimateNote, setEstimateNote] = useState("");
    const [substitution, setSubstitution] = useState("");
    const [actualCost, setActualCost] = useState("");
    const [receiptUrls, setReceiptUrls] = useState([]);
    const [uploadingReceipt, setUploadingReceipt] = useState(false);
    const [otp, setOtp] = useState("");
    const [amountReceived, setAmountReceived] = useState("");
    const [disputeReason, setDisputeReason] = useState("");
    const [disputeOpen, setDisputeOpen] = useState(false);
    const loadRef = useRef(null);

    const load = useCallback(async () => {
        if (!token || !orderId) return;
        try {
            const data = await getDriverPurchaseDetails(orderId, token);
            const next = data.order || data.purchaseOrder || null;
            setOrder(next);
            if (next?.customerTotalPayable != null) {
                setAmountReceived((prev) =>
                    prev === "" ? String(next.customerTotalPayable) : prev
                );
            }
            setError("");
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, [token, orderId]);

    useEffect(() => {
        loadRef.current = load;
    }, [load]);

    useEffect(() => {
        if (!token || !orderId) return;
        void (async () => {
            await Promise.resolve();
            await load();
        })();
        const poll = setInterval(() => void loadRef.current?.(), 20000);
        const socket = getRealtimeSocket();
        const refresh = (payload) => {
            if (!payload?.orderId || String(payload.orderId) === String(orderId)) {
                void loadRef.current?.();
            }
        };
        socket?.on("purchase:status:updated", refresh);
        return () => {
            clearInterval(poll);
            socket?.off("purchase:status:updated", refresh);
        };
    }, [token, orderId, load]);

    async function run(key, action, successText) {
        if (busy) return;
        setBusy(key);
        setNotice(null);
        try {
            const data = await action();
            if (data?.order) setOrder(data.order);
            else void load();
            if (successText) setNotice({ kind: "success", text: successText });
        } catch (err) {
            setNotice({ kind: "error", text: err.message });
        } finally {
            setBusy("");
        }
    }

    async function saveShoppingLocation() {
        if (!storeName.trim()) {
            setNotice({ kind: "error", text: "Enter the shop name first." });
            return;
        }
        setBusy("location");
        setNotice(null);
        try {
            const coords = await getPosition();
            const data = await updateShoppingLocation(
                orderId,
                {
                    latitude: coords.latitude,
                    longitude: coords.longitude,
                    address: storeAddress.trim(),
                    name: storeName.trim(),
                },
                token
            );
            if (data?.order) setOrder(data.order);
            setNotice({
                kind: "success",
                text: "Shopping location shared with the customer.",
            });
        } catch (err) {
            setNotice({ kind: "error", text: err.message });
        } finally {
            setBusy("");
        }
    }

    async function uploadReceipts(files) {
        if (!files?.length || uploadingReceipt) return;
        setUploadingReceipt(true);
        setNotice(null);
        try {
            const urls = [];
            for (const file of files) {
                const result = await uploadOrderImage(file, token);
                if (result?.imageUrl) urls.push(result.imageUrl);
            }
            setReceiptUrls((prev) => [...prev, ...urls].slice(0, 6));
        } catch (err) {
            setNotice({ kind: "error", text: err.message });
        } finally {
            setUploadingReceipt(false);
        }
    }

    const status = order?.status;
    const overCap =
        order?.approvedMaxAmount != null &&
        Number(actualCost) > Number(order.approvedMaxAmount);

    return (
        <main className="driver-subpage min-h-dvh bg-[#F7F9F8] pb-28 text-slate-900">
            <MobileBottomNav role="DRIVER" />

            <header className="bg-violet-700 px-5 pb-8 pt-[max(24px,env(safe-area-inset-top))] text-white">
                <div className="mx-auto max-w-xl">
                    <div className="flex items-center justify-between">
                        <Link
                            href="/driver/tasks"
                            className="inline-flex items-center gap-2 text-sm font-semibold"
                        >
                            <ArrowLeft size={19} /> Active Tasks
                        </Link>
                        <button
                            type="button"
                            onClick={() => void load()}
                            aria-label="Refresh order"
                            className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/15"
                        >
                            <RefreshCw size={18} />
                        </button>
                    </div>
                    <h1 className="mt-6 flex items-center gap-3 text-3xl font-extrabold">
                        <ShoppingBag size={30} /> Buy &amp; Deliver
                    </h1>
                    <p className="mt-2 text-sm text-white/75">
                        Shop for the customer, keep every receipt, and collect
                        the shopping money + your delivery fee at the door.
                    </p>
                </div>
            </header>

            <div className="relative z-10 mx-auto mt-4 max-w-xl space-y-5 px-4 pb-6">
                {notice && (
                    <p
                        role={notice.kind === "error" ? "alert" : "status"}
                        className={`rounded-xl p-4 text-sm font-semibold ${
                            notice.kind === "error"
                                ? "bg-red-50 text-red-600"
                                : "bg-emerald-50 text-[#087F5B]"
                        }`}
                    >
                        {notice.text}
                    </p>
                )}

                {loading ? (
                    <div
                        className="h-72 animate-pulse rounded-[24px] bg-white shadow-sm"
                        aria-busy="true"
                    />
                ) : error && !order ? (
                    <div className="rounded-[24px] bg-white p-5 shadow-sm">
                        <p role="alert" className="flex items-start gap-2 text-sm font-semibold text-red-600">
                            <CircleAlert size={17} className="mt-0.5 shrink-0" />
                            {error}
                        </p>
                        <button
                            type="button"
                            onClick={() => void load()}
                            className="mt-3 inline-flex items-center gap-2 rounded-xl bg-[#087F5B] px-4 py-2.5 text-sm font-bold text-white"
                        >
                            <RefreshCw size={15} /> Try again
                        </button>
                    </div>
                ) : order ? (
                    <>
                        <section className="rounded-[24px] bg-white p-5 shadow-sm">
                            <PurchaseTimeline status={status} />
                        </section>

                        <section className="rounded-[24px] bg-white p-5 shadow-sm">
                            <h2 className="flex items-center gap-2 text-sm font-extrabold">
                                <ShoppingBag size={17} className="text-violet-600" />
                                Shopping list
                            </h2>
                            <p className="mt-2 whitespace-pre-line text-sm leading-6 text-slate-700">
                                {order.itemsText}
                            </p>
                            {order.preferences?.preferredShop && (
                                <p className="mt-2 text-xs font-semibold text-slate-500">
                                    Preferred shop: {order.preferences.preferredShop}
                                </p>
                            )}
                            {order.preferences?.preferredBrand && (
                                <p className="text-xs font-semibold text-slate-500">
                                    Preferred brand: {order.preferences.preferredBrand}
                                </p>
                            )}
                            {order.preferences?.alternativesNote && (
                                <p className="text-xs font-semibold text-slate-500">
                                    Alternatives: {order.preferences.alternativesNote}
                                    {order.preferences?.alternativesAllowed
                                        ? " (allowed)"
                                        : " (ask first)"}
                                </p>
                            )}
                            {order.deliveryNotes && (
                                <p className="mt-2 rounded-xl bg-slate-50 p-3 text-xs leading-5 text-slate-600">
                                    Note: {order.deliveryNotes}
                                </p>
                            )}
                            {(order.imageUrls || []).length > 0 && (
                                <div className="mt-3 flex gap-2 overflow-x-auto">
                                    {order.imageUrls.map((url) => (
                                        <Image
                                            key={url}
                                            src={url}
                                            alt="Item reference"
                                            width={72}
                                            height={72}
                                            unoptimized
                                            className="h-[72px] w-[72px] shrink-0 rounded-xl object-cover"
                                        />
                                    ))}
                                </div>
                            )}
                            <div className="mt-4 space-y-1.5 border-t border-slate-100 pt-3 text-sm">
                                <p className="flex items-start gap-2 font-semibold">
                                    <MapPin size={16} className="mt-0.5 shrink-0 text-[#087F5B]" />
                                    Deliver to:{" "}
                                    {order.deliveryLabel ||
                                        order.deliveryAddress?.address ||
                                        "Customer address"}
                                </p>
                                {order.deliveryAddress?.address &&
                                    order.deliveryLabel && (
                                        <p className="pl-6 text-xs text-slate-500">
                                            {order.deliveryAddress.address}
                                        </p>
                                    )}
                            </div>
                        </section>

                        <section className="flex items-center gap-3 rounded-[24px] bg-white p-5 shadow-sm">
                            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-violet-50 text-violet-600">
                                <UserRound size={24} />
                            </span>
                            <div className="min-w-0 flex-1">
                                <p className="text-sm font-extrabold">Customer</p>
                                <p className="text-xs text-slate-500">
                                    Chat for item questions, substitutions and
                                    the delivery OTP.
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setChatOpen(true)}
                                className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-xl bg-violet-600 px-4 text-sm font-bold text-white"
                            >
                                <MessageCircle size={16} /> Chat
                            </button>
                        </section>

                        <section className="rounded-[24px] bg-white p-5 shadow-sm">
                            <h2 className="flex items-center gap-2 text-sm font-extrabold">
                                <Wallet size={17} className="text-[#087F5B]" />
                                Money on this order
                            </h2>
                            <div className="mt-3 grid grid-cols-2 gap-2 text-center">
                                <div className="rounded-xl bg-emerald-50 p-3">
                                    <p className="text-[11px] font-bold text-slate-500">
                                        Delivery fee — your earning
                                    </p>
                                    <p className="mt-0.5 text-base font-extrabold text-[#087F5B]">
                                        {money(order.deliveryFee)}
                                    </p>
                                </div>
                                <div className="rounded-xl bg-slate-50 p-3">
                                    <p className="text-[11px] font-bold text-slate-500">
                                        Customer budget cap
                                    </p>
                                    <p className="mt-0.5 text-base font-extrabold">
                                        {money(order.estimatedBudget)}
                                    </p>
                                </div>
                                <div className="rounded-xl bg-slate-50 p-3">
                                    <p className="text-[11px] font-bold text-slate-500">
                                        Shopping spent (actual)
                                    </p>
                                    <p className="mt-0.5 text-base font-extrabold">
                                        {money(order.actualCost)}
                                    </p>
                                </div>
                                <div className="rounded-xl bg-slate-50 p-3">
                                    <p className="text-[11px] font-bold text-slate-500">
                                        Approved up to
                                    </p>
                                    <p className="mt-0.5 text-base font-extrabold">
                                        {money(order.approvedMaxAmount)}
                                    </p>
                                </div>
                                <div className="rounded-xl bg-slate-50 p-3">
                                    <p className="text-[11px] font-bold text-slate-500">
                                        Reimbursed so far
                                    </p>
                                    <p className="mt-0.5 text-base font-extrabold">
                                        {money(order.reimbursementReceived)}
                                    </p>
                                </div>
                                <div
                                    className={`rounded-xl p-3 ${Number(order.unpaidAmount) > 0 ? "bg-amber-50" : "bg-slate-50"}`}
                                >
                                    <p className="text-[11px] font-bold text-slate-500">
                                        Still unpaid
                                    </p>
                                    <p
                                        className={`mt-0.5 text-base font-extrabold ${Number(order.unpaidAmount) > 0 ? "text-amber-600" : ""}`}
                                    >
                                        {money(order.unpaidAmount)}
                                    </p>
                                </div>
                            </div>
                            {order.customerTotalPayable != null && (
                                <p className="mt-3 text-center text-sm font-extrabold">
                                    Customer pays at the door:{" "}
                                    {money(order.customerTotalPayable)}
                                </p>
                            )}
                            <p className="mt-3 rounded-xl bg-violet-50 p-3 text-xs leading-5 text-violet-800">
                                Shopping money is{" "}
                                <strong>reimbursement, not earnings</strong> —
                                the customer pays back what you spent at the
                                shop. Only the delivery fee is your income.
                            </p>
                        </section>

                        {(order.substitutions || []).length > 0 && (
                            <section className="rounded-[24px] bg-white p-5 shadow-sm">
                                <h2 className="flex items-center gap-2 text-sm font-extrabold">
                                    <Replace size={16} className="text-violet-600" />
                                    Substitutions
                                </h2>
                                <ul className="mt-2 divide-y divide-slate-100">
                                    {order.substitutions.map((sub) => (
                                        <li
                                            key={sub._id}
                                            className="flex items-start gap-2 py-2.5"
                                        >
                                            <p className="min-w-0 flex-1 text-sm font-semibold">
                                                {sub.description}
                                            </p>
                                            <span
                                                className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-extrabold ${
                                                    sub.status === "APPROVED"
                                                        ? "bg-emerald-50 text-[#087F5B]"
                                                        : sub.status === "REJECTED"
                                                          ? "bg-red-50 text-red-600"
                                                          : "bg-amber-50 text-amber-700"
                                                }`}
                                            >
                                                {sub.status}
                                            </span>
                                        </li>
                                    ))}
                                </ul>
                            </section>
                        )}

                        {/* ---- Step actions by status ---- */}
                        {status === "DRIVER_SELECTED" && (
                            <section className="rounded-[24px] bg-white p-5 shadow-sm">
                                <h2 className="text-base font-extrabold">
                                    Ready when you are
                                </h2>
                                <p className="mt-1 text-sm text-slate-500">
                                    Head to a shop and start shopping. You can
                                    share the shop location so the customer can
                                    follow along.
                                </p>
                                <button
                                    type="button"
                                    disabled={Boolean(busy)}
                                    onClick={() =>
                                        void run(
                                            "start",
                                            () => startShopping(orderId, token),
                                            "Shopping started."
                                        )
                                    }
                                    className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-violet-600 font-bold text-white disabled:opacity-40"
                                >
                                    <Play size={18} />
                                    {busy === "start" ? "Starting…" : "Start shopping"}
                                </button>
                                <ShopLocationForm
                                    storeName={storeName}
                                    setStoreName={setStoreName}
                                    storeAddress={storeAddress}
                                    setStoreAddress={setStoreAddress}
                                    busy={busy === "location"}
                                    onSave={() => void saveShoppingLocation()}
                                />
                            </section>
                        )}

                        {status === "SHOPPING" && (
                            <section className="space-y-4 rounded-[24px] bg-white p-5 shadow-sm">
                                <div>
                                    <h2 className="flex items-center gap-2 text-base font-extrabold">
                                        <ReceiptText size={18} className="text-violet-600" />
                                        Send the cost estimate
                                    </h2>
                                    <p className="mt-1 text-sm leading-6 text-slate-500">
                                        Add up the basket and send the total.{" "}
                                        <strong>
                                            The customer must approve the amount
                                            before you pay at the counter.
                                        </strong>
                                    </p>
                                    <div className="mt-3 space-y-2">
                                        <input
                                            type="number"
                                            min="1"
                                            step="1"
                                            inputMode="numeric"
                                            value={estimateAmount}
                                            onChange={(e) => setEstimateAmount(e.target.value)}
                                            placeholder="Estimated total (PKR)"
                                            className="h-12 w-full rounded-xl border px-4 text-sm font-semibold"
                                        />
                                        <input
                                            type="text"
                                            value={estimateNote}
                                            onChange={(e) => setEstimateNote(e.target.value)}
                                            placeholder="Note (optional) — e.g. shop name, items priced"
                                            className="h-12 w-full rounded-xl border px-4 text-sm font-semibold"
                                        />
                                        <button
                                            type="button"
                                            disabled={Boolean(busy)}
                                            onClick={() =>
                                                void run(
                                                    "estimate",
                                                    () =>
                                                        submitCostEstimate(
                                                            orderId,
                                                            {
                                                                amount: Number(estimateAmount),
                                                                note: estimateNote.trim(),
                                                            },
                                                            token
                                                        ),
                                                    "Estimate sent — waiting for the customer's approval."
                                                )
                                            }
                                            className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-violet-600 font-bold text-white disabled:opacity-40"
                                        >
                                            <ReceiptText size={17} />
                                            {busy === "estimate"
                                                ? "Sending…"
                                                : "Send estimate for approval"}
                                        </button>
                                    </div>
                                </div>
                                <SubstitutionForm
                                    value={substitution}
                                    setValue={setSubstitution}
                                    busy={busy === "substitution"}
                                    onSubmit={() =>
                                        void run(
                                            "substitution",
                                            () =>
                                                requestSubstitution(
                                                    orderId,
                                                    substitution.trim(),
                                                    token
                                                ),
                                            "Substitution sent — the customer will approve or reject it."
                                        ).then(() => setSubstitution(""))
                                    }
                                />
                                <ShopLocationForm
                                    storeName={storeName}
                                    setStoreName={setStoreName}
                                    storeAddress={storeAddress}
                                    setStoreAddress={setStoreAddress}
                                    busy={busy === "location"}
                                    onSave={() => void saveShoppingLocation()}
                                />
                            </section>
                        )}

                        {status === "AWAITING_APPROVAL" && (
                            <section className="rounded-[24px] bg-amber-50 p-5 shadow-sm">
                                <p className="flex items-start gap-2 text-sm font-semibold leading-6 text-amber-800">
                                    <CircleAlert size={18} className="mt-0.5 shrink-0" />
                                    Estimate of {money(order.estimatedCost)} sent.
                                    Wait for the customer&apos;s approval before
                                    paying — do not buy yet.
                                </p>
                                <SubstitutionForm
                                    value={substitution}
                                    setValue={setSubstitution}
                                    busy={busy === "substitution"}
                                    onSubmit={() =>
                                        void run(
                                            "substitution",
                                            () =>
                                                requestSubstitution(
                                                    orderId,
                                                    substitution.trim(),
                                                    token
                                                ),
                                            "Substitution sent."
                                        ).then(() => setSubstitution(""))
                                    }
                                />
                            </section>
                        )}

                        {status === "PURCHASE_APPROVED" && (
                            <section className="space-y-4 rounded-[24px] bg-white p-5 shadow-sm">
                                <div>
                                    <h2 className="flex items-center gap-2 text-base font-extrabold">
                                        <CheckCircle2 size={18} className="text-[#087F5B]" />
                                        Approved up to {money(order.approvedMaxAmount)}
                                    </h2>
                                    <p className="mt-1 text-sm leading-6 text-slate-500">
                                        Buy the items now and keep the printed
                                        receipt. Record exactly what you paid.
                                    </p>
                                    <div className="mt-3 space-y-2">
                                        <input
                                            type="number"
                                            min="1"
                                            step="1"
                                            inputMode="numeric"
                                            value={actualCost}
                                            onChange={(e) => setActualCost(e.target.value)}
                                            placeholder="Actual amount paid (PKR)"
                                            className="h-12 w-full rounded-xl border px-4 text-sm font-semibold"
                                        />
                                        {overCap && (
                                            <p
                                                role="alert"
                                                className="flex items-start gap-2 rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-600"
                                            >
                                                <CircleAlert size={16} className="mt-0.5 shrink-0" />
                                                This is above the approved{" "}
                                                {money(order.approvedMaxAmount)} —
                                                the server will reject it. Send a
                                                new estimate below to get the
                                                higher amount approved first.
                                            </p>
                                        )}
                                        <label className="block cursor-pointer rounded-xl border-2 border-dashed border-violet-200 bg-violet-50/50 p-3 text-center">
                                            <Camera size={20} className="mx-auto text-violet-600" />
                                            <span className="mt-1 block text-xs font-semibold">
                                                {uploadingReceipt
                                                    ? "Uploading receipt…"
                                                    : receiptUrls.length
                                                      ? `${receiptUrls.length} receipt photo(s) added — tap to add more`
                                                      : "Add receipt photos"}
                                            </span>
                                            <input
                                                type="file"
                                                accept="image/*"
                                                multiple
                                                className="hidden"
                                                onChange={(e) => {
                                                    void uploadReceipts(e.target.files);
                                                    e.target.value = "";
                                                }}
                                            />
                                        </label>
                                        {receiptUrls.length > 0 && (
                                            <div className="flex gap-2 overflow-x-auto">
                                                {receiptUrls.map((url) => (
                                                    <span key={url} className="relative shrink-0">
                                                        <Image
                                                            src={url}
                                                            alt="Receipt"
                                                            width={56}
                                                            height={56}
                                                            unoptimized
                                                            className="h-14 w-14 rounded-xl object-cover"
                                                        />
                                                        <button
                                                            type="button"
                                                            aria-label="Remove receipt photo"
                                                            onClick={() =>
                                                                setReceiptUrls((prev) =>
                                                                    prev.filter((u) => u !== url)
                                                                )
                                                            }
                                                            className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-slate-900 text-white"
                                                        >
                                                            <X size={11} />
                                                        </button>
                                                    </span>
                                                ))}
                                            </div>
                                        )}
                                        <button
                                            type="button"
                                            disabled={
                                                Boolean(busy) ||
                                                !Number(actualCost) ||
                                                receiptUrls.length === 0
                                            }
                                            onClick={() =>
                                                void run(
                                                    "purchased",
                                                    () =>
                                                        markPurchased(
                                                            orderId,
                                                            {
                                                                actualCost: Number(actualCost),
                                                                receiptImageUrls: receiptUrls,
                                                            },
                                                            token
                                                        ),
                                                    "Purchase recorded. Head to the customer."
                                                )
                                            }
                                            className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-violet-600 font-bold text-white disabled:opacity-40"
                                        >
                                            <ReceiptText size={17} />
                                            {busy === "purchased"
                                                ? "Saving…"
                                                : "Mark purchased"}
                                        </button>
                                        {receiptUrls.length === 0 && (
                                            <p className="text-center text-[11px] font-semibold text-slate-400">
                                                At least one receipt photo is required.
                                            </p>
                                        )}
                                    </div>
                                </div>
                                <div className="border-t border-slate-100 pt-4">
                                    <h3 className="text-sm font-extrabold">
                                        Cost went up?
                                    </h3>
                                    <p className="mt-1 text-xs leading-5 text-slate-500">
                                        If the basket now costs more than the
                                        approved amount, send a new estimate —
                                        the customer must approve the increase
                                        before you buy.
                                    </p>
                                    <div className="mt-2 flex gap-2">
                                        <input
                                            type="number"
                                            min="1"
                                            step="1"
                                            inputMode="numeric"
                                            value={estimateAmount}
                                            onChange={(e) => setEstimateAmount(e.target.value)}
                                            placeholder="New total (PKR)"
                                            className="h-11 min-w-0 flex-1 rounded-xl border px-3 text-sm font-semibold"
                                        />
                                        <button
                                            type="button"
                                            disabled={Boolean(busy) || !Number(estimateAmount)}
                                            onClick={() =>
                                                void run(
                                                    "estimate",
                                                    () =>
                                                        submitCostEstimate(
                                                            orderId,
                                                            {
                                                                amount: Number(estimateAmount),
                                                                note: estimateNote.trim(),
                                                            },
                                                            token
                                                        ),
                                                    "Increase request sent for approval."
                                                )
                                            }
                                            className="h-11 shrink-0 rounded-xl bg-slate-900 px-4 text-sm font-bold text-white disabled:opacity-40"
                                        >
                                            Request increase
                                        </button>
                                    </div>
                                </div>
                                <SubstitutionForm
                                    value={substitution}
                                    setValue={setSubstitution}
                                    busy={busy === "substitution"}
                                    onSubmit={() =>
                                        void run(
                                            "substitution",
                                            () =>
                                                requestSubstitution(
                                                    orderId,
                                                    substitution.trim(),
                                                    token
                                                ),
                                            "Substitution sent."
                                        ).then(() => setSubstitution(""))
                                    }
                                />
                            </section>
                        )}

                        {status === "PURCHASED" && (
                            <section className="rounded-[24px] bg-white p-5 shadow-sm">
                                <h2 className="text-base font-extrabold">
                                    Items bought — {money(order.actualCost)}
                                </h2>
                                <p className="mt-1 text-sm text-slate-500">
                                    Start the delivery trip when you leave the
                                    shop.
                                </p>
                                <button
                                    type="button"
                                    disabled={Boolean(busy)}
                                    onClick={() =>
                                        void run(
                                            "out",
                                            () => markOutForDelivery(orderId, token),
                                            "You are on the way."
                                        )
                                    }
                                    className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-violet-600 font-bold text-white disabled:opacity-40"
                                >
                                    <Truck size={18} />
                                    {busy === "out" ? "Updating…" : "Out for delivery"}
                                </button>
                            </section>
                        )}

                        {status === "OUT_FOR_DELIVERY" && (
                            <section className="rounded-[24px] bg-white p-5 shadow-sm">
                                <h2 className="flex items-center gap-2 text-base font-extrabold">
                                    <Navigation size={18} className="text-violet-600" />
                                    On the way
                                </h2>
                                <p className="mt-1 text-sm text-slate-500">
                                    Deliver to{" "}
                                    {order.deliveryLabel ||
                                        order.deliveryAddress?.address ||
                                        "the customer address"}
                                    .
                                </p>
                                <button
                                    type="button"
                                    disabled={Boolean(busy)}
                                    onClick={() =>
                                        void run(
                                            "arrived",
                                            () => markArrived(orderId, token),
                                            "Marked as arrived."
                                        )
                                    }
                                    className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-violet-600 font-bold text-white disabled:opacity-40"
                                >
                                    <MapPin size={18} />
                                    {busy === "arrived" ? "Updating…" : "I have arrived"}
                                </button>
                            </section>
                        )}

                        {status === "ARRIVED" && (
                            <section className="rounded-[24px] bg-white p-5 shadow-sm">
                                <h2 className="flex items-center gap-2 text-base font-extrabold">
                                    <Banknote size={18} className="text-[#087F5B]" />
                                    Complete the delivery
                                </h2>
                                <p className="mt-1 text-sm leading-6 text-slate-500">
                                    Ask the customer for their 6-digit delivery
                                    OTP, collect{" "}
                                    <strong>{money(order.customerTotalPayable)}</strong>{" "}
                                    in cash (shopping {money(order.actualCost)} +
                                    fee {money(order.deliveryFee)}), then confirm.
                                </p>
                                <div className="mt-3 space-y-2">
                                    <input
                                        type="text"
                                        inputMode="numeric"
                                        maxLength={6}
                                        value={otp}
                                        onChange={(e) =>
                                            setOtp(e.target.value.replace(/\D/g, ""))
                                        }
                                        placeholder="Delivery OTP from customer"
                                        className="h-12 w-full rounded-xl border px-4 text-center text-lg font-extrabold tracking-[0.3em]"
                                    />
                                    <label className="block">
                                        <span className="text-xs font-semibold text-slate-500">
                                            Cash actually received (PKR)
                                        </span>
                                        <input
                                            type="number"
                                            min="0"
                                            step="1"
                                            inputMode="numeric"
                                            value={amountReceived}
                                            onChange={(e) => setAmountReceived(e.target.value)}
                                            className="mt-1 h-12 w-full rounded-xl border px-4 text-sm font-semibold"
                                        />
                                    </label>
                                    <button
                                        type="button"
                                        disabled={
                                            Boolean(busy) || otp.length !== 6
                                        }
                                        onClick={() =>
                                            void run(
                                                "deliver",
                                                () =>
                                                    deliverPurchaseOrder(
                                                        orderId,
                                                        {
                                                            otp,
                                                            amountReceived:
                                                                Number(amountReceived),
                                                        },
                                                        token
                                                    ),
                                                "Delivered. Well done!"
                                            )
                                        }
                                        className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#087F5B] font-bold text-white disabled:opacity-40"
                                    >
                                        <CheckCircle2 size={18} />
                                        {busy === "deliver"
                                            ? "Confirming…"
                                            : "Confirm delivery"}
                                    </button>
                                </div>
                            </section>
                        )}

                        {(status === "DELIVERED" || status === "COMPLETED") && (
                            <section className="rounded-[24px] bg-emerald-50 p-5 text-center shadow-sm">
                                <CheckCircle2 size={34} className="mx-auto text-[#087F5B]" />
                                <p className="mt-2 font-extrabold text-[#087F5B]">
                                    {status === "COMPLETED"
                                        ? "Order complete — fully paid"
                                        : "Delivered"}
                                </p>
                                <p className="mt-1 text-sm text-slate-600">
                                    Delivery fee earned: {money(order.deliveryFee)}.
                                    {Number(order.unpaidAmount) > 0
                                        ? ` ${money(order.unpaidAmount)} is still unpaid — the customer can confirm the remaining payment from their app.`
                                        : " Shopping money fully reimbursed."}
                                </p>
                            </section>
                        )}

                        {status === "DISPUTED" && (
                            <section className="rounded-[24px] bg-red-50 p-5 shadow-sm">
                                <p className="flex items-start gap-2 text-sm font-semibold leading-6 text-red-700">
                                    <Flag size={17} className="mt-0.5 shrink-0" />
                                    This order is in dispute
                                    {order.disputeReason
                                        ? ` — ${order.disputeReason}`
                                        : ""}
                                    . Safar support will review the receipts and
                                    chat history.
                                </p>
                            </section>
                        )}

                        {status === "CANCELLED" && (
                            <section className="rounded-[24px] bg-white p-5 text-center shadow-sm">
                                <p className="font-extrabold">This order was cancelled</p>
                                <p className="mt-1 text-sm text-slate-500">
                                    No further action is needed.
                                </p>
                            </section>
                        )}

                        {WORKING_STATUSES.includes(status) && (
                            <section className="rounded-[24px] bg-white p-5 shadow-sm">
                                {!disputeOpen ? (
                                    <button
                                        type="button"
                                        onClick={() => setDisputeOpen(true)}
                                        className="inline-flex items-center gap-1.5 text-sm font-extrabold text-red-600"
                                    >
                                        <Flag size={15} /> Something wrong? Raise a
                                        dispute
                                    </button>
                                ) : (
                                    <div className="space-y-2">
                                        <p className="text-sm font-extrabold">
                                            Raise a dispute
                                        </p>
                                        <p className="text-xs leading-5 text-slate-500">
                                            Disputes freeze the order for admin
                                            review — use this only for a genuine
                                            problem (payment refused, wrong
                                            address, customer unreachable).
                                        </p>
                                        <textarea
                                            value={disputeReason}
                                            onChange={(e) => setDisputeReason(e.target.value)}
                                            rows={3}
                                            placeholder="Describe the problem"
                                            className="w-full rounded-xl border p-3 text-sm font-semibold"
                                        />
                                        <div className="flex gap-2">
                                            <button
                                                type="button"
                                                disabled={
                                                    Boolean(busy) ||
                                                    !disputeReason.trim()
                                                }
                                                onClick={() =>
                                                    void run(
                                                        "dispute",
                                                        () =>
                                                            raisePurchaseDispute(
                                                                orderId,
                                                                disputeReason.trim(),
                                                                token
                                                            ),
                                                        "Dispute raised — support will review."
                                                    )
                                                }
                                                className="flex h-11 flex-1 items-center justify-center rounded-xl bg-red-500 text-sm font-bold text-white disabled:opacity-40"
                                            >
                                                {busy === "dispute"
                                                    ? "Raising…"
                                                    : "Raise dispute"}
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => setDisputeOpen(false)}
                                                className="h-11 rounded-xl bg-slate-100 px-4 text-sm font-bold text-slate-600"
                                            >
                                                Cancel
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </section>
                        )}
                    </>
                ) : null}
            </div>

            {chatOpen && order && (
                <OrderChat
                    orderType="PURCHASE"
                    orderId={order._id}
                    token={token}
                    userId={user?._id || user?.id || ""}
                    participantLabel="Customer"
                    directOpen
                    onClose={() => setChatOpen(false)}
                />
            )}
        </main>
    );
}

function ShopLocationForm({
    storeName,
    setStoreName,
    storeAddress,
    setStoreAddress,
    busy,
    onSave,
}) {
    return (
        <div className="mt-4 border-t border-slate-100 pt-4">
            <p className="flex items-center gap-1.5 text-sm font-extrabold">
                <Store size={15} className="text-violet-600" /> Shopping location
            </p>
            <p className="mt-1 text-xs leading-5 text-slate-500">
                Share where you are shopping — your current GPS position is
                attached automatically.
            </p>
            <div className="mt-2 space-y-2">
                <input
                    type="text"
                    value={storeName}
                    onChange={(e) => setStoreName(e.target.value)}
                    placeholder="Shop name — e.g. Carrefour, Khanpur"
                    className="h-11 w-full rounded-xl border px-3 text-sm font-semibold"
                />
                <input
                    type="text"
                    value={storeAddress}
                    onChange={(e) => setStoreAddress(e.target.value)}
                    placeholder="Shop address (optional)"
                    className="h-11 w-full rounded-xl border px-3 text-sm font-semibold"
                />
                <button
                    type="button"
                    disabled={busy || !storeName.trim()}
                    onClick={onSave}
                    className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-slate-900 text-sm font-bold text-white disabled:opacity-40"
                >
                    <MapPin size={15} />
                    {busy ? "Sharing…" : "Share shop location"}
                </button>
            </div>
        </div>
    );
}

function SubstitutionForm({ value, setValue, busy, onSubmit }) {
    return (
        <div className="border-t border-slate-100 pt-4">
            <p className="flex items-center gap-1.5 text-sm font-extrabold">
                <Replace size={15} className="text-violet-600" /> Item not
                available?
            </p>
            <p className="mt-1 text-xs leading-5 text-slate-500">
                Suggest a substitute — the customer approves or rejects it
                before you buy.
            </p>
            <div className="mt-2 flex gap-2">
                <input
                    type="text"
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    placeholder="e.g. Tapal tea 900g instead of Lipton 950g"
                    className="h-11 min-w-0 flex-1 rounded-xl border px-3 text-sm font-semibold"
                />
                <button
                    type="button"
                    disabled={busy || !value.trim()}
                    onClick={onSubmit}
                    className="h-11 shrink-0 rounded-xl bg-violet-600 px-4 text-sm font-bold text-white disabled:opacity-40"
                >
                    {busy ? "Sending…" : "Ask"}
                </button>
            </div>
        </div>
    );
}
