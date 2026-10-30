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
import MicButton from "@/components/MicButton";
import MobileBottomNav from "@/components/MobileBottomNav";
import ServiceGuide from "@/components/guides/ServiceGuide";
import { useLanguage } from "@/components/i18n/LanguageProvider";
import OrderChat from "@/components/OrderChat";
import DestinationMap from "@/components/DestinationMap";
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
    const { t } = useLanguage();
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

    // Step-2 estimate submit (A13/A14 cap model): within the passenger's
    // budget the backend auto-approves (PURCHASE_APPROVED /
    // estimateApprovalSource=BUDGET_CAP) — say so instead of leaving the
    // partner waiting for an approval that already happened.
    async function submitEstimate() {
        if (busy) return;
        setBusy("estimate");
        setNotice(null);
        try {
            const data = await submitCostEstimate(
                orderId,
                { amount: Number(estimateAmount), note: estimateNote.trim() },
                token
            );
            let next = data?.order || null;
            if (next) setOrder(next);
            if (!next) {
                const fresh = await getDriverPurchaseDetails(orderId, token);
                next = fresh.order || fresh.purchaseOrder || null;
                if (next) setOrder(next);
            }
            if (
                next?.status === "PURCHASE_APPROVED" ||
                next?.estimateApprovalSource === "BUDGET_CAP"
            ) {
                setNotice({
                    kind: "success",
                    text: "Approved under the customer's budget ✓ — start buying.",
                });
            } else {
                setNotice({
                    kind: "success",
                    text: "Estimate sent — waiting for the customer's approval.",
                });
            }
        } catch (err) {
            setNotice({ kind: "error", text: err.message });
        } finally {
            setBusy("");
        }
    }

    async function saveShoppingLocation() {
        if (!storeName.trim()) {
            setNotice({ kind: "error", text: t("dBd.enterShopName") });
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
                text: t("dBd.locationShared"),
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
        <main className="driver-subpage min-h-dvh bg-pd-bg pb-28 text-pd-text">
            <MobileBottomNav role="DRIVER" />
            <ServiceGuide serviceId="driverRequests" userId={user?._id || user?.id} />

            <header className="bg-violet-700 px-5 pb-8 pt-[max(24px,env(safe-area-inset-top))] text-white">
                <div className="mx-auto max-w-xl">
                    <div className="flex items-center justify-between">
                        <Link
                            href="/driver/tasks"
                            className="inline-flex items-center gap-2 text-sm font-semibold"
                        >
                            <ArrowLeft size={19} /> {t("dTasks.title")}
                        </Link>
                        <button
                            type="button"
                            onClick={() => void load()}
                            aria-label={t("dBd.refreshOrder")}
                            className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/15"
                        >
                            <RefreshCw size={18} />
                        </button>
                    </div>
                    <h1 className="mt-6 flex items-center gap-3 text-3xl font-extrabold">
                        <ShoppingBag size={30} /> {t("dBd.title")}
                    </h1>
                    <p className="mt-2 text-sm text-white/75">
                        {t("dBd.subtitle")}
                    </p>
                </div>
            </header>

            <div className="relative z-10 mx-auto mt-4 max-w-xl space-y-5 px-4 pb-6">
                {notice && (
                    <p
                        role={notice.kind === "error" ? "alert" : "status"}
                        className={`rounded-xl p-4 text-sm font-semibold ${
                            notice.kind === "error"
                                ? "bg-pd-danger-soft text-pd-danger"
                                : "bg-pd-success-soft text-pd-accent-text"
                        }`}
                    >
                        {notice.text}
                    </p>
                )}

                {loading ? (
                    <div
                        className="h-72 animate-pulse rounded-[24px] bg-pd-surface shadow-sm"
                        aria-busy="true"
                    />
                ) : error && !order ? (
                    <div className="rounded-[24px] bg-pd-surface p-5 shadow-sm">
                        <p role="alert" className="flex items-start gap-2 text-sm font-semibold text-pd-danger">
                            <CircleAlert size={17} className="mt-0.5 shrink-0" />
                            {error}
                        </p>
                        <button
                            type="button"
                            onClick={() => void load()}
                            className="mt-3 inline-flex items-center gap-2 rounded-xl bg-[#087F5B] px-4 py-2.5 text-sm font-bold text-white"
                        >
                            <RefreshCw size={15} /> {t("common.retry")}
                        </button>
                    </div>
                ) : order ? (
                    <>
                        <section className="rounded-[24px] bg-pd-surface p-5 shadow-sm">
                            <PurchaseTimeline status={status} />
                        </section>

                        {/* ---- Step actions by status ---- */}
                        {status === "DRIVER_SELECTED" && (
                            <section data-guide="driver-bd-step" className="rounded-[24px] bg-pd-surface p-5 shadow-sm">
                                <StepHeader n={1} title={t("dBd.step1")} />
                                <p className="mt-1 text-sm text-pd-muted">
                                    {t("dBd.step1Hint")}
                                </p>
                                <button
                                    type="button"
                                    disabled={Boolean(busy)}
                                    onClick={() =>
                                        void run(
                                            "start",
                                            () => startShopping(orderId, token),
                                            t("dBd.shoppingStarted")
                                        )
                                    }
                                    className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-violet-600 font-bold text-white disabled:opacity-40"
                                >
                                    <Play size={18} />
                                    {busy === "start" ? t("dBd.starting") : t("dBd.startShopping")}
                                </button>
                            </section>
                        )}

                        {status === "SHOPPING" && (
                            <section className="rounded-[24px] bg-pd-surface p-5 shadow-sm">
                                <div>
                                    <StepHeader n={2} title={t("dBd.step2")} />
                                    <p className="mt-1 text-sm leading-6 text-pd-muted">
                                        {t("dBd.step2Hint", { budget: money(order.estimatedBudget) })}
                                    </p>
                                    <div className="mt-3 space-y-2">
                                        <input
                                            type="number"
                                            min="1"
                                            step="1"
                                            inputMode="numeric"
                                            value={estimateAmount}
                                            onChange={(e) => setEstimateAmount(e.target.value)}
                                            placeholder={t("dBd.estimatedTotal")}
                                            className="h-12 w-full rounded-xl border border-pd-line bg-pd-surface-2 px-4 text-sm font-semibold text-pd-text"
                                        />
                                        <div className="flex items-center gap-2">
                                            <input
                                                type="text"
                                                value={estimateNote}
                                                onChange={(e) => setEstimateNote(e.target.value)}
                                                placeholder={t("dBd.estimateNote")}
                                                className="h-12 min-w-0 flex-1 rounded-xl border border-pd-line bg-pd-surface-2 px-4 text-sm font-semibold text-pd-text"
                                            />
                                            <MicButton
                                                onAppend={(spoken) =>
                                                    setEstimateNote((prev) => (prev.trim() ? `${prev.replace(/\s+$/, "")} ${spoken}` : spoken))
                                                }
                                            />
                                        </div>
                                        <button
                                            type="button"
                                            disabled={Boolean(busy)}
                                            onClick={() => void submitEstimate()}
                                            className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-violet-600 font-bold text-white disabled:opacity-40"
                                        >
                                            <ReceiptText size={17} />
                                            {busy === "estimate"
                                                ? t("dBd.sending")
                                                : t("dBd.sendEstimate")}
                                        </button>
                                    </div>
                                </div>
                            </section>
                        )}

                        {status === "AWAITING_APPROVAL" && (
                            <section className="rounded-[24px] bg-pd-warning-soft p-5 shadow-sm">
                                <StepHeader n={2} title={t("dBd.step2Wait")} />
                                <p className="mt-2 flex items-start gap-2 text-sm font-semibold leading-6 text-pd-warning">
                                    <CircleAlert size={18} className="mt-0.5 shrink-0" />
                                    {t("dBd.waitHint", { amount: money(order.estimatedCost) })}
                                </p>
                            </section>
                        )}

                        {status === "PURCHASE_APPROVED" && (
                            <section className="rounded-[24px] bg-pd-surface p-5 shadow-sm">
                                <div>
                                    <StepHeader n={3} title={t("dBd.step3")} />
                                    {order.estimateApprovalSource === "BUDGET_CAP" ? (
                                        <p className="mt-2 rounded-xl bg-pd-success-soft p-3 text-sm font-bold text-pd-accent-text">
                                            {t("dBd.approvedUnderBudget")}
                                        </p>
                                    ) : (
                                        <h2 className="mt-2 flex items-center gap-2 text-base font-extrabold">
                                            <CheckCircle2 size={18} className="text-[#087F5B]" />
                                            {t("dBd.approvedUpTo", { amount: money(order.approvedMaxAmount) })}
                                        </h2>
                                    )}
                                    <p className="mt-1 text-sm leading-6 text-pd-muted">
                                        {t("dBd.step3Hint")}
                                    </p>
                                    <div className="mt-3 space-y-2">
                                        <input
                                            type="number"
                                            min="1"
                                            step="1"
                                            inputMode="numeric"
                                            value={actualCost}
                                            onChange={(e) => setActualCost(e.target.value)}
                                            placeholder={t("dBd.actualAmount")}
                                            className="h-12 w-full rounded-xl border border-pd-line bg-pd-surface-2 px-4 text-sm font-semibold text-pd-text"
                                        />
                                        {overCap && (
                                            <p
                                                role="alert"
                                                className="flex items-start gap-2 rounded-xl bg-pd-danger-soft p-3 text-sm font-semibold text-pd-danger"
                                            >
                                                <CircleAlert size={16} className="mt-0.5 shrink-0" />
                                                {t("dBd.overCap", { amount: money(order.approvedMaxAmount) })}
                                            </p>
                                        )}
                                        <label className="block cursor-pointer rounded-xl border-2 border-dashed border-pd-line bg-pd-surface-2 p-3 text-center">
                                            <Camera size={20} className="mx-auto text-violet-600" />
                                            <span className="mt-1 block text-xs font-semibold">
                                                {uploadingReceipt
                                                    ? t("dBd.uploadingReceipt")
                                                    : receiptUrls.length
                                                      ? t("dBd.receiptAdded", { count: receiptUrls.length })
                                                      : t("dBd.receiptOptional")}
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
                                                            alt={t("dBd.receipt")}
                                                            width={56}
                                                            height={56}
                                                            unoptimized
                                                            className="h-14 w-14 rounded-xl object-cover"
                                                        />
                                                        <button
                                                            type="button"
                                                            aria-label={t("dBd.removeReceipt")}
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
                                                !Number(actualCost)
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
                                                    t("dBd.purchaseRecorded")
                                                )
                                            }
                                            className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-violet-600 font-bold text-white disabled:opacity-40"
                                        >
                                            <ReceiptText size={17} />
                                            {busy === "purchased"
                                                ? t("dBd.saving")
                                                : t("dBd.markPurchased")}
                                        </button>
                                        <p className="text-center text-[11px] font-semibold text-pd-faint">
                                            {t("dBd.receiptOptionalHint")}
                                        </p>
                                    </div>
                                </div>
                            </section>
                        )}

                        {status === "PURCHASED" && (
                            <section className="rounded-[24px] bg-pd-surface p-5 shadow-sm">
                                <StepHeader n={4} title={t("dBd.step4")} />
                                <p className="mt-1 text-sm text-pd-muted">
                                    {t("dBd.itemsBought", { amount: money(order.actualCost) })}
                                </p>
                                <button
                                    type="button"
                                    disabled={Boolean(busy)}
                                    onClick={() =>
                                        void run(
                                            "out",
                                            () => markOutForDelivery(orderId, token),
                                            t("dBd.onTheWay")
                                        )
                                    }
                                    className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-violet-600 font-bold text-white disabled:opacity-40"
                                >
                                    <Truck size={18} />
                                    {busy === "out" ? t("dBd.updating") : t("dBd.startDelivery")}
                                </button>
                            </section>
                        )}

                        {status === "OUT_FOR_DELIVERY" && (
                            <section className="rounded-[24px] bg-pd-surface p-5 shadow-sm">
                                <StepHeader n={4} title="Deliver" />
                                <h2 className="mt-2 flex items-center gap-2 text-base font-extrabold">
                                    <Navigation size={18} className="text-violet-600" />
                                    {t("dBd.onTheWayTitle")}
                                </h2>
                                <p className="mt-1 text-sm text-pd-muted">
                                    {t("dBd.deliverTo", { place: order.deliveryLabel || order.deliveryAddress?.address || t("dBd.customerAddress") })}
                                </p>
                                <button
                                    type="button"
                                    disabled={Boolean(busy)}
                                    onClick={() =>
                                        void run(
                                            "arrived",
                                            () => markArrived(orderId, token),
                                            t("dBd.markedArrived")
                                        )
                                    }
                                    className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-violet-600 font-bold text-white disabled:opacity-40"
                                >
                                    <MapPin size={18} />
                                    {busy === "arrived" ? t("dBd.updating") : t("dBd.iveArrived")}
                                </button>
                            </section>
                        )}

                        {status === "ARRIVED" && (
                            <section className="rounded-[24px] bg-pd-surface p-5 shadow-sm">
                                <StepHeader n={5} title={t("dBd.step5")} />
                                <h2 className="mt-2 flex items-center gap-2 text-base font-extrabold">
                                    <Banknote size={18} className="text-[#087F5B]" />
                                    {t("dBd.completeDelivery")}
                                </h2>
                                <p className="mt-1 text-sm leading-6 text-pd-muted">
                                    {t("dBd.finishHint", { total: money(order.customerTotalPayable), cost: money(order.actualCost), fee: money(order.deliveryFee) })}
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
                                        placeholder={t("dBd.otpPlaceholder")}
                                        className="h-12 w-full rounded-xl border border-pd-line bg-pd-surface-2 px-4 text-center text-lg font-extrabold tracking-[0.3em] text-pd-text"
                                    />
                                    <label className="block">
                                        <span className="text-xs font-semibold text-pd-muted">
                                            {t("dBd.cashReceived")}
                                        </span>
                                        <input
                                            type="number"
                                            min="0"
                                            step="1"
                                            inputMode="numeric"
                                            value={amountReceived}
                                            onChange={(e) => setAmountReceived(e.target.value)}
                                            className="mt-1 h-12 w-full rounded-xl border border-pd-line bg-pd-surface-2 px-4 text-sm font-semibold text-pd-text"
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
                                                t("dBd.deliveredWellDone")
                                            )
                                        }
                                        className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#087F5B] font-bold text-white disabled:opacity-40"
                                    >
                                        <CheckCircle2 size={18} />
                                        {busy === "deliver"
                                            ? t("dBd.confirming")
                                            : t("dBd.confirmDelivery")}
                                    </button>
                                </div>
                            </section>
                        )}

                        {(status === "DELIVERED" || status === "COMPLETED") && (
                            <section className="rounded-[24px] bg-pd-success-soft p-5 text-center shadow-sm">
                                <CheckCircle2 size={34} className="mx-auto text-[#087F5B]" />
                                <p className="mt-2 font-extrabold text-[#087F5B]">
                                    {status === "COMPLETED"
                                        ? t("dBd.orderComplete")
                                        : t("dBd.delivered")}
                                </p>
                                <p className="mt-1 text-sm text-pd-muted">
                                    {t("dBd.feeEarned", { fee: money(order.deliveryFee) })}
                                    {Number(order.unpaidAmount) > 0
                                        ? ` ${t("dBd.stillUnpaid", { amount: money(order.unpaidAmount) })}`
                                        : ` ${t("dBd.fullyReimbursed")}`}
                                </p>
                            </section>
                        )}

                        {status === "DISPUTED" && (
                            <section className="rounded-[24px] bg-pd-danger-soft p-5 shadow-sm">
                                <p className="flex items-start gap-2 text-sm font-semibold leading-6 text-pd-danger">
                                    <Flag size={17} className="mt-0.5 shrink-0" />
                                    {t("dBd.inDispute", { suffix: order.disputeReason ? ` — ${order.disputeReason}` : "" })}
                                </p>
                            </section>
                        )}

                        {status === "CANCELLED" && (
                            <section className="rounded-[24px] bg-pd-surface p-5 text-center shadow-sm">
                                <p className="font-extrabold">{t("dBd.cancelled")}</p>
                                <p className="mt-1 text-sm text-pd-muted">
                                    {t("dBd.noActionNeeded")}
                                </p>
                            </section>
                        )}


                        <section className="rounded-[24px] bg-pd-surface p-5 shadow-sm">
                            <h2 className="flex items-center gap-2 text-sm font-extrabold">
                                <ShoppingBag size={17} className="text-violet-600" />
                                {t("dBd.shoppingList")}
                            </h2>
                            <p className="mt-2 whitespace-pre-line text-sm leading-6 text-pd-text-2">
                                {order.itemsText}
                            </p>
                            {order.preferences?.preferredShop && (
                                <p className="mt-2 text-xs font-semibold text-pd-muted">
                                    {t("dBd.preferredShop")} {order.preferences.preferredShop}
                                </p>
                            )}
                            {order.preferences?.preferredBrand && (
                                <p className="text-xs font-semibold text-pd-muted">
                                    {t("dBd.preferredBrand")} {order.preferences.preferredBrand}
                                </p>
                            )}
                            {order.preferences?.alternativesNote && (
                                <p className="text-xs font-semibold text-pd-muted">
                                    {t("dBd.alternatives")} {order.preferences.alternativesNote}
                                    {order.preferences?.alternativesAllowed
                                        ? t("dBd.allowedSuffix")
                                        : t("dBd.askFirstSuffix")}
                                </p>
                            )}
                            {order.deliveryNotes && (
                                <p className="mt-2 rounded-xl bg-pd-surface-2 p-3 text-xs leading-5 text-pd-muted">
                                    {t("dBd.note")} {order.deliveryNotes}
                                </p>
                            )}
                            {(order.imageUrls || []).length > 0 && (
                                <div className="mt-3 flex gap-2 overflow-x-auto">
                                    {order.imageUrls.map((url) => (
                                        <Image
                                            key={url}
                                            src={url}
                                            alt={t("dBd.itemReference")}
                                            width={72}
                                            height={72}
                                            unoptimized
                                            className="h-[72px] w-[72px] shrink-0 rounded-xl object-cover"
                                        />
                                    ))}
                                </div>
                            )}
                            <div className="mt-4 space-y-1.5 border-t border-pd-line pt-3 text-sm">
                                <p className="flex items-start gap-2 font-semibold">
                                    <MapPin size={16} className="mt-0.5 shrink-0 text-[#087F5B]" />
                                    {t("dBd.deliverToLabel")}{" "}
                                    {order.deliveryLabel ||
                                        order.deliveryAddress?.address ||
                                        t("dBd.customer")}
                                </p>
                                {order.deliveryAddress?.address &&
                                    order.deliveryLabel && (
                                        <p className="pl-6 text-xs text-pd-muted">
                                            {order.deliveryAddress.address}
                                        </p>
                                    )}
                            </div>
                            <div className="mt-4">
                                <DestinationMap
                                    point={order.deliveryAddress}
                                    label={order.deliveryLabel || order.deliveryAddress?.address || t("dBd.deliveryLocation")}
                                    navigateLabel={t("dBd.navigateToCustomer")}
                                />
                            </div>
                        </section>

                        <section className="flex items-center gap-3 rounded-[24px] bg-pd-surface p-5 shadow-sm">
                            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-pd-surface-2 text-violet-600">
                                <UserRound size={24} />
                            </span>
                            <div className="min-w-0 flex-1">
                                <p className="text-sm font-extrabold">{t("dBd.customer")}</p>
                                <p className="text-xs text-pd-muted">
                                    {t("dBd.customerHint")}
                                </p>
                            </div>
                            <button
                                type="button"
                                data-guide="driver-bd-chat"
                                onClick={() => setChatOpen(true)}
                                className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-xl bg-violet-600 px-4 text-sm font-bold text-white"
                            >
                                <MessageCircle size={16} /> {t("dBd.chat")}
                            </button>
                        </section>

                        <section className="rounded-[24px] bg-pd-surface p-5 shadow-sm">
                            <h2 className="flex items-center gap-2 text-sm font-extrabold">
                                <Wallet size={17} className="text-[#087F5B]" />
                                {t("dBd.moneyTitle")}
                            </h2>
                            <div className="mt-3 grid grid-cols-2 gap-2 text-center">
                                <div className="rounded-xl bg-emerald-50 p-3">
                                    <p className="text-[11px] font-bold text-pd-muted">
                                        {t("dBd.deliveryFeeEarning")}
                                    </p>
                                    <p className="mt-0.5 text-base font-extrabold text-[#087F5B]">
                                        {money(order.deliveryFee)}
                                    </p>
                                </div>
                                <div className="rounded-xl bg-pd-surface-2 p-3">
                                    <p className="text-[11px] font-bold text-pd-muted">
                                        {t("dBd.budgetCap")}
                                    </p>
                                    <p className="mt-0.5 text-base font-extrabold">
                                        {money(order.estimatedBudget)}
                                    </p>
                                </div>
                                <div className="rounded-xl bg-pd-surface-2 p-3">
                                    <p className="text-[11px] font-bold text-pd-muted">
                                        {t("dBd.shoppingSpent")}
                                    </p>
                                    <p className="mt-0.5 text-base font-extrabold">
                                        {money(order.actualCost)}
                                    </p>
                                </div>
                                <div className="rounded-xl bg-pd-surface-2 p-3">
                                    <p className="text-[11px] font-bold text-pd-muted">
                                        {t("dBd.approvedUpToLabel")}
                                    </p>
                                    <p className="mt-0.5 text-base font-extrabold">
                                        {money(order.approvedMaxAmount)}
                                    </p>
                                </div>
                                <div className="rounded-xl bg-pd-surface-2 p-3">
                                    <p className="text-[11px] font-bold text-pd-muted">
                                        {t("dBd.reimbursedSoFar")}
                                    </p>
                                    <p className="mt-0.5 text-base font-extrabold">
                                        {money(order.reimbursementReceived)}
                                    </p>
                                </div>
                                <div
                                    className={`rounded-xl p-3 ${Number(order.unpaidAmount) > 0 ? "bg-pd-warning-soft" : "bg-pd-surface-2"}`}
                                >
                                    <p className="text-[11px] font-bold text-pd-muted">
                                        {t("dBd.stillUnpaidLabel")}
                                    </p>
                                    <p
                                        className={`mt-0.5 text-base font-extrabold ${Number(order.unpaidAmount) > 0 ? "text-pd-warning" : ""}`}
                                    >
                                        {money(order.unpaidAmount)}
                                    </p>
                                </div>
                            </div>
                            {order.customerTotalPayable != null && (
                                <p className="mt-3 text-center text-sm font-extrabold">
                                    {t("dBd.customerPays", { amount: money(order.customerTotalPayable) })}
                                </p>
                            )}
                            <p className="mt-3 rounded-xl bg-pd-surface-2 p-3 text-xs leading-5 text-pd-text-2">
                                {t("dBd.reimbursementNote")}
                            </p>
                        </section>

                        {(order.substitutions || []).length > 0 && (
                            <section className="rounded-[24px] bg-pd-surface p-5 shadow-sm">
                                <h2 className="flex items-center gap-2 text-sm font-extrabold">
                                    <Replace size={16} className="text-violet-600" />
                                    {t("dBd.substitutions")}
                                </h2>
                                <ul className="mt-2 divide-y divide-pd-line">
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
                                                        ? "bg-pd-success-soft text-pd-accent-text"
                                                        : sub.status === "REJECTED"
                                                          ? "bg-pd-danger-soft text-pd-danger"
                                                          : "bg-pd-warning-soft text-pd-warning"
                                                }`}
                                            >
                                                {sub.status}
                                            </span>
                                        </li>
                                    ))}
                                </ul>
                            </section>
                        )}

                        {/* Secondary actions — kept reachable below the
                            step card, never competing with its one
                            primary action. */}
                        {["DRIVER_SELECTED", "SHOPPING", "AWAITING_APPROVAL", "PURCHASE_APPROVED"].includes(status) && (
                            <section className="space-y-4 rounded-[24px] bg-pd-surface p-5 shadow-sm">
                                <h2 className="text-sm font-extrabold text-pd-text-2">
                                    {t("dBd.moreActions")}
                                </h2>
                                {status === "PURCHASE_APPROVED" && (
                                <div>
                                    <h3 className="text-sm font-extrabold">
                                        {t("dBd.costWentUp")}
                                    </h3>
                                    <p className="mt-1 text-xs leading-5 text-pd-muted">
                                        {t("dBd.costWentUpHint")}
                                    </p>
                                    <div className="mt-2 flex gap-2">
                                        <input
                                            type="number"
                                            min="1"
                                            step="1"
                                            inputMode="numeric"
                                            value={estimateAmount}
                                            onChange={(e) => setEstimateAmount(e.target.value)}
                                            placeholder={t("dBd.newTotal")}
                                            className="h-11 min-w-0 flex-1 rounded-xl border border-pd-line bg-pd-surface-2 px-3 text-sm font-semibold text-pd-text"
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
                                                    t("dBd.increaseSent")
                                                )
                                            }
                                            className="h-11 shrink-0 rounded-xl bg-pd-ink px-4 text-sm font-bold text-pd-ink-text disabled:opacity-40"
                                        >
                                            {t("dBd.requestIncrease")}
                                        </button>
                                    </div>
                                </div>
                                )}
                                {(status === "SHOPPING" || status === "AWAITING_APPROVAL" || status === "PURCHASE_APPROVED") && (
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
                                                t("dBd.substitutionSent")
                                            ).then(() => setSubstitution(""))
                                        }
                                    />
                                )}
                                {(status === "DRIVER_SELECTED" || status === "SHOPPING") && (
                                    <ShopLocationForm
                                        storeName={storeName}
                                        setStoreName={setStoreName}
                                        storeAddress={storeAddress}
                                        setStoreAddress={setStoreAddress}
                                        busy={busy === "location"}
                                        onSave={() => void saveShoppingLocation()}
                                    />
                                )}
                            </section>
                        )}

                        {WORKING_STATUSES.includes(status) && (
                            <section className="rounded-[24px] bg-pd-surface p-5 shadow-sm">
                                {!disputeOpen ? (
                                    <button
                                        type="button"
                                        onClick={() => setDisputeOpen(true)}
                                        className="inline-flex items-center gap-1.5 text-sm font-extrabold text-pd-danger"
                                    >
                                        <Flag size={15} /> {t("dBd.raiseDisputeQ")}
                                    </button>
                                ) : (
                                    <div className="space-y-2">
                                        <p className="text-sm font-extrabold">
                                            {t("dBd.raiseDispute")}
                                        </p>
                                        <p className="text-xs leading-5 text-pd-muted">
                                            {t("dBd.disputeHint")}
                                        </p>
                                        <textarea
                                            value={disputeReason}
                                            onChange={(e) => setDisputeReason(e.target.value)}
                                            rows={3}
                                            placeholder={t("dBd.describeProblem")}
                                            className="w-full rounded-xl border border-pd-line bg-pd-surface-2 p-3 text-sm font-semibold text-pd-text"
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
                                                        t("dBd.disputeRaised")
                                                    )
                                                }
                                                className="flex h-11 flex-1 items-center justify-center rounded-xl bg-pd-danger text-sm font-bold text-white disabled:opacity-40"
                                            >
                                                {busy === "dispute"
                                                    ? t("dBd.raising")
                                                    : t("dBd.raiseDispute")}
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => setDisputeOpen(false)}
                                                className="h-11 rounded-xl bg-pd-surface-3 px-4 text-sm font-bold text-pd-text-2"
                                            >
                                                {t("common.cancel")}
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
                    participantLabel={t("dBd.participantCustomer")}
                    directOpen
                    onClose={() => setChatOpen(false)}
                />
            )}
        </main>
    );
}

function StepHeader({ n, title }) {
    const { t } = useLanguage();
    return (
        <h2 className="flex items-center gap-2.5 text-base font-extrabold">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-violet-600 text-xs font-extrabold text-white">
                {n}
            </span>
            <span>
                {t("dBd.stepOf", { step: n, total: 5, title })}
            </span>
        </h2>
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
    const { t } = useLanguage();
    return (
        <div className="mt-4 border-t border-pd-line pt-4">
            <p className="flex items-center gap-1.5 text-sm font-extrabold">
                <Store size={15} className="text-violet-600" /> {t("dBd.shopLocation")}
            </p>
            <p className="mt-1 text-xs leading-5 text-pd-muted">
                {t("dBd.shopLocationHint")}
            </p>
            <div className="mt-2 space-y-2">
                <input
                    type="text"
                    value={storeName}
                    onChange={(e) => setStoreName(e.target.value)}
                    placeholder={t("dBd.shopNamePlaceholder")}
                    className="h-11 w-full rounded-xl border border-pd-line bg-pd-surface-2 px-3 text-sm font-semibold text-pd-text"
                />
                <input
                    type="text"
                    value={storeAddress}
                    onChange={(e) => setStoreAddress(e.target.value)}
                    placeholder={t("dBd.shopAddressPlaceholder")}
                    className="h-11 w-full rounded-xl border border-pd-line bg-pd-surface-2 px-3 text-sm font-semibold text-pd-text"
                />
                <button
                    type="button"
                    disabled={busy || !storeName.trim()}
                    onClick={onSave}
                    className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-pd-ink text-sm font-bold text-pd-ink-text disabled:opacity-40"
                >
                    <MapPin size={15} />
                    {busy ? t("dBd.sharing") : t("dBd.shareShopLocation")}
                </button>
            </div>
        </div>
    );
}

function SubstitutionForm({ value, setValue, busy, onSubmit }) {
    const { t } = useLanguage();
    return (
        <div className="border-t border-pd-line pt-4">
            <p className="flex items-center gap-1.5 text-sm font-extrabold">
                <Replace size={15} className="text-violet-600" /> {t("dBd.substituteTitle")}
            </p>
            <p className="mt-1 text-xs leading-5 text-pd-muted">
                {t("dBd.substituteHint")}
            </p>
            <div className="mt-2 flex items-center gap-2">
                <input
                    type="text"
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    placeholder={t("dBd.substitutePlaceholder")}
                    className="h-11 min-w-0 flex-1 rounded-xl border border-pd-line bg-pd-surface-2 px-3 text-sm font-semibold text-pd-text"
                />
                <MicButton
                    onAppend={(spoken) =>
                        setValue((prev) => (prev.trim() ? `${prev.replace(/\s+$/, "")} ${spoken}` : spoken))
                    }
                />
                <button
                    type="button"
                    disabled={busy || !value.trim()}
                    onClick={onSubmit}
                    className="h-11 shrink-0 rounded-xl bg-violet-600 px-4 text-sm font-bold text-white disabled:opacity-40"
                >
                    {busy ? t("dBd.sending") : t("dBd.ask")}
                </button>
            </div>
        </div>
    );
}
