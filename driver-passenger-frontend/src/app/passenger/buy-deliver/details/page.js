"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
    ArrowLeft,
    BadgeCheck,
    Banknote,
    KeyRound,
    MapPin,
    MessageCircle,
    ReceiptText,
    RefreshCw,
    ShoppingBag,
    Star,
    TriangleAlert,
    XCircle,
} from "lucide-react";
import AuthGuard from "@/components/AuthGuard";
import { useActionDialog } from "@/components/ActionDialog";
import MobileBottomNav from "@/components/MobileBottomNav";
import OrderChat from "@/components/OrderChat";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/components/i18n/LanguageProvider";
import { storedLanguage } from "@/components/i18n/LanguageProvider";
import { getRealtimeSocket } from "@/lib/socket";
import { formatPKR } from "@/lib/rideDisplay";
import PurchaseTimeline, {
    StatusPill,
    purchaseStatusMeta,
} from "@/components/order/PurchaseTimeline";
import DestinationMap from "@/components/DestinationMap";
import {
    acceptPurchaseOffer,
    approvePurchaseAmount,
    cancelPurchaseOrder,
    confirmPurchasePayment,
    decideSubstitution,
    getPurchaseOffers,
    getPurchaseOrder,
    raisePurchaseDispute,
    ratePurchasePartner,
    regeneratePurchaseOtp,
    rejectPurchaseEstimate,
} from "@/lib/purchaseService";

export default function BuyDeliverDetailPage() {
    return (
        <AuthGuard role="PASSENGER">
            <OrderDetail />
        </AuthGuard>
    );
}

const CANCELLABLE = ["REQUESTED", "BIDDING", "DRIVER_SELECTED", "SHOPPING", "AWAITING_APPROVAL", "PURCHASE_APPROVED", "PURCHASED"];
const DISPUTABLE = ["SHOPPING", "AWAITING_APPROVAL", "PURCHASE_APPROVED", "PURCHASED", "OUT_FOR_DELIVERY", "ARRIVED", "DELIVERED"];
const OTP_STAGES = ["PURCHASED", "OUT_FOR_DELIVERY", "ARRIVED"];

function offerPartnerUserId(offer) {
    // Verified: enriched offers carry driverId (Driver record) and
    // driver { name, rating, ratingCount, vehicle } — no User id is
    // exposed, so fall back to driverId for the chat ensure call.
    return offer?.driver?.userId || offer?.driverUserId || offer?.userId || offer?.driverId || null;
}

function offerPartnerName(offer) {
    return offer?.driver?.name || (storedLanguage() === "ur" ? "سفر ساتھی" : "Safar partner");
}

function vehicleText(vehicle) {
    if (!vehicle) return "";
    return [vehicle.color, vehicle.make, vehicle.model].filter(Boolean).join(" ") ||
        vehicle.type || vehicle.vehicleType || "";
}

function expiryText(expiresAt, now, lang) {
    if (!expiresAt) return "";
    const ms = new Date(expiresAt).getTime() - now;
    if (ms <= 0) return lang === "ur" ? "وقت ختم" : "Expired";
    const totalSeconds = Math.floor(ms / 1000);
    const time = `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, "0")}`;
    return lang === "ur" ? `${time} باقی` : `${time} left`;
}

function OrderDetail() {
    const { token, user } = useAuth();
    const { t, lang } = useLanguage();
    const dialog = useActionDialog();
    const searchParams = useSearchParams();
    const id = String(searchParams.get("id") || "");

    const [order, setOrder] = useState(null);
    const [offers, setOffers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const [busy, setBusy] = useState("");
    const [now, setNow] = useState(() => Date.now());
    const [chatPartner, setChatPartner] = useState(null); // { partnerUserId, label }
    const [deepChatId, setDeepChatId] = useState(() =>
        searchParams.get("chat") === "open" ? searchParams.get("conversationId") || "" : ""
    );
    const [otp, setOtp] = useState("");
    const [rating, setRating] = useState(0);
    const [ratingComment, setRatingComment] = useState("");

    const load = useCallback(async () => {
        if (!token || !id) return;
        try {
            const data = await getPurchaseOrder(id, token);
            setOrder(data.order || null);
            setError("");
            const status = data.order?.status;
            if (status === "REQUESTED" || status === "BIDDING") {
                try {
                    const offersData = await getPurchaseOffers(id, token);
                    setOffers((offersData.offers || []).filter(
                        (o) => !o.expiresAt || new Date(o.expiresAt).getTime() > Date.now()
                    ));
                } catch { /* Offers are best-effort alongside the order. */ }
            } else {
                setOffers([]);
            }
        } catch (e) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    }, [token, id]);

    useEffect(() => {
        let cancelled = false;
        (async () => { if (!cancelled) await load(); })();
        return () => { cancelled = true; };
    }, [load]);

    useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(timer);
    }, []);

    // Live updates for this order + a 15s poll fallback.
    useEffect(() => {
        if (!token || !id) return;
        const socket = getRealtimeSocket();
        const refresh = (payload) => {
            if (payload?.orderId && String(payload.orderId) !== id) return;
            void load();
        };
        const events = [
            "purchase:status:updated",
            "purchase:approval:requested",
            "purchase:approval:decision",
            "purchase:offer:new",
            "purchase:offer:accepted",
            "purchase:disputed",
        ];
        events.forEach((event) => socket?.on(event, refresh));
        socket?.on("connect", refresh);
        const timer = setInterval(() => {
            if (!document.hidden) void load();
        }, 15_000);
        return () => {
            events.forEach((event) => socket?.off(event, refresh));
            socket?.off("connect", refresh);
            clearInterval(timer);
        };
    }, [token, id, load]);

    async function run(key, action, successMessage) {
        if (busy) return;
        setBusy(key);
        setError("");
        setNotice("");
        try {
            await action();
            if (successMessage) setNotice(successMessage);
            await load();
        } catch (e) {
            setError(e.message);
        } finally {
            setBusy("");
        }
    }

    async function acceptOffer(offer) {
        if (!(await dialog.confirm({
            title: t("bdDetails.acceptTitle"),
            message: t("bdDetails.acceptMessage", { name: offerPartnerName(offer), fee: formatPKR(offer.deliveryFee) }),
            confirmLabel: t("bdDetails.acceptConfirm"),
        }))) return;
        await run(
            `accept:${offer._id}`,
            () => acceptPurchaseOffer(id, offer._id, token),
            t("bdDetails.partnerSelected")
        );
    }

    async function showOtp() {
        await run("otp", async () => {
            const data = await regeneratePurchaseOtp(id, token);
            // Verified response: { success, stage: "DELIVERY", otp }
            setOtp(data.otp || "");
            if (!data.otp) throw new Error(t("bdDetails.otpUnavailable"));
        });
    }

    async function handleCancel() {
        const reason = await dialog.prompt({
            title: t("bdDetails.cancelTitle"),
            label: t("bdDetails.cancelReasonLabel"),
            confirmLabel: t("bdDetails.cancelContinue"),
        });
        if (reason === null) return;
        if (!(await dialog.confirm({
            title: "Cancel this shopping request?",
            confirmLabel: t("bdDetails.cancelConfirm"),
            cancelLabel: t("bdDetails.keepRequest"),
            danger: true,
        }))) return;
        await run("cancel", () => cancelPurchaseOrder(id, reason || "", token), t("bdDetails.cancelledNotice"));
    }

    async function handleDispute() {
        const reason = await dialog.prompt({
            title: t("bdDetails.disputeTitle"),
            label: t("bdDetails.disputeLabel"),
            optional: false,
            confirmLabel: t("bdDetails.disputeConfirm"),
        });
        if (!reason?.trim()) return;
        await run("dispute", () => raisePurchaseDispute(id, reason.trim(), token), t("bdDetails.disputeNotice"));
    }

    if (loading && !order) {
        return (
            <main className="flex min-h-dvh items-center justify-center bg-pd-bg text-sm font-semibold text-pd-muted">
                Loading your request…
            </main>
        );
    }

    if (!order) {
        return (
            <main className="min-h-dvh bg-pd-bg pb-28 text-pd-text">
                <div className="mx-auto max-w-xl px-4 pt-16 text-center">
                    <p className="font-extrabold">{t("bdDetails.notFound")}</p>
                    {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
                    <Link href="/passenger/buy-deliver" className="mt-4 inline-block rounded-2xl bg-[#087F5B] px-5 py-3 text-sm font-extrabold text-white">
                        Back to Buy & Deliver
                    </Link>
                </div>
                <MobileBottomNav role="PASSENGER" />
            </main>
        );
    }

    const meta = purchaseStatusMeta(order.status);
    const pendingSubstitutions = (order.substitutions || []).filter((s) => s.status === "PENDING");
    const decidedSubstitutions = (order.substitutions || []).filter((s) => s.status !== "PENDING");
    const canRate = ["DELIVERED", "COMPLETED"].includes(order.status) && !order.ratedAt;
    const deliveryAddressText = order.deliveryAddress?.address || "";

    return (
        <main className="min-h-dvh bg-pd-bg pb-28 text-pd-text">
            <div className="sticky top-0 z-20 border-b border-pd-line bg-pd-elevated backdrop-blur-xl">
                <div className="mx-auto flex max-w-xl items-center gap-2 px-3 pb-3 pt-[max(12px,env(safe-area-inset-top))]">
                    <Link href="/passenger/buy-deliver" aria-label="Back to Buy & Deliver" className="grid h-11 w-11 place-items-center rounded-2xl hover:bg-pd-surface-2">
                        <ArrowLeft size={21} />
                    </Link>
                    <div className="min-w-0 flex-1">
                        <h1 className="truncate text-lg font-extrabold leading-tight tracking-tight">{t("bdDetails.title")}</h1>
                        <p className="text-xs text-pd-muted">
                            {order.createdAt ? new Date(order.createdAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : ""}
                        </p>
                    </div>
                    <StatusPill meta={meta} />
                    <button type="button" aria-label={t("common.refresh")} onClick={() => void load()} className="grid h-11 w-11 place-items-center rounded-2xl text-pd-muted hover:bg-pd-surface-2">
                        <RefreshCw size={18} />
                    </button>
                </div>
            </div>

            <div className="mx-auto max-w-xl space-y-4 px-4 pt-4">
                {error && <p role="alert" className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-600">{error}</p>}
                {notice && <p role="status" className="rounded-2xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-[#087F5B]">{notice}</p>}

                <section className="rounded-[24px] bg-pd-surface p-4 shadow-sm">
                    <PurchaseTimeline status={order.status} />
                </section>

                {/* Offers */}
                {(order.status === "REQUESTED" || order.status === "BIDDING") && (
                    <section className="space-y-3 rounded-[24px] bg-pd-surface p-4 shadow-sm" aria-labelledby="offers-title">
                        <h2 id="offers-title" className="flex items-center gap-2 text-[15px] font-extrabold">
                            <Banknote size={17} className="text-[#087F5B]" />
                            {t("bdDetails.offers")} {offers.length > 0 && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-extrabold text-[#087F5B]">{offers.length}</span>}
                        </h2>
                        {offers.length === 0 ? (
                            <div className="rounded-2xl bg-pd-surface-2 px-4 py-5 text-center">
                                <span className="relative mx-auto flex h-3 w-3">
                                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#087F5B] opacity-60" />
                                    <span className="relative inline-flex h-3 w-3 rounded-full bg-[#087F5B]" />
                                </span>
                                <p className="mt-3 text-sm font-bold">{t("bdDetails.waitingPartners")}</p>
                                <p className="mt-1 text-xs text-pd-muted">{t("bdDetails.waitingHint")}</p>
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {offers.map((offer) => (
                                    <article key={offer._id} className="rounded-2xl border border-pd-line bg-pd-surface-2 p-3.5">
                                        <div className="flex items-start justify-between gap-3">
                                            <div className="min-w-0">
                                                <p className="truncate text-[15px] font-extrabold">{offerPartnerName(offer)}</p>
                                                <p className="mt-0.5 text-xs font-semibold text-pd-muted">
                                                    {offer.driver?.rating ? `★ ${Number(offer.driver.rating).toFixed(1)} (${offer.driver.ratingCount || 0})` : t("bdDetails.newPartner")}
                                                    {vehicleText(offer.driver?.vehicle) ? ` · ${vehicleText(offer.driver.vehicle)}` : ""}
                                                </p>
                                            </div>
                                            <div className="shrink-0 text-right">
                                                <p className="text-lg font-extrabold text-[#087F5B]">{formatPKR(offer.deliveryFee)}</p>
                                                <p className="text-[11px] font-bold text-amber-600">{expiryText(offer.expiresAt, now, lang)}</p>
                                            </div>
                                        </div>
                                        <div className="mt-3 flex gap-2">
                                            <button
                                                type="button"
                                                disabled={!offerPartnerUserId(offer)}
                                                onClick={() => setChatPartner({ partnerUserId: String(offerPartnerUserId(offer)), label: offerPartnerName(offer) })}
                                                className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-[#111111] text-sm font-bold text-white disabled:opacity-40"
                                            >
                                                <MessageCircle size={16} /> {t("bdDetails.chat")}
                                            </button>
                                            <button
                                                type="button"
                                                disabled={busy === `accept:${offer._id}`}
                                                onClick={() => void acceptOffer(offer)}
                                                className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-[#087F5B] text-sm font-extrabold text-white disabled:opacity-50"
                                            >
                                                <BadgeCheck size={16} /> {t("bdDetails.accept")}
                                            </button>
                                        </div>
                                    </article>
                                ))}
                            </div>
                        )}
                    </section>
                )}

                {/* Assigned partner */}
                {order.driverId && !["REQUESTED", "BIDDING", "CANCELLED", "FAILED"].includes(order.status) && (
                    <section className="flex items-center gap-3 rounded-[24px] bg-pd-surface p-4 shadow-sm">
                        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-emerald-50 text-[#087F5B]">
                            <ShoppingBag size={22} />
                        </span>
                        <div className="min-w-0 flex-1">
                            <p className="text-[15px] font-extrabold">{t("bdDetails.yourPartner")}</p>
                            <p className="text-xs font-semibold text-pd-muted">
                                {order.shoppingLocation?.name ? t("bdDetails.shoppingAt", { shop: order.shoppingLocation.name }) : ""}
                                {t("bdDetails.deliveryFeeLine", { fee: formatPKR(order.deliveryFee) })}
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={() => setChatPartner({ partnerUserId: String(order.driverId), label: t("bdDetails.chatLabelPartner") })}
                            className="flex h-11 shrink-0 items-center gap-2 rounded-xl bg-[#111111] px-4 text-sm font-bold text-white"
                        >
                            <MessageCircle size={16} /> {t("bdDetails.chat")}
                        </button>
                    </section>
                )}

                {/* Approval */}
                {order.status === "AWAITING_APPROVAL" && (
                    <section className="space-y-3 rounded-[24px] border-2 border-pd-warning bg-pd-warning-soft p-4 shadow-sm" aria-labelledby="approval-title">
                        <h2 id="approval-title" className="text-[15px] font-extrabold text-pd-warning">{t("bdDetails.approveTitle")}</h2>
                        <div className="space-y-1.5 rounded-2xl bg-pd-surface p-3.5 text-sm font-semibold">
                            <p className="flex justify-between"><span className="text-pd-muted">{t("bdDetails.partnerEstimate")}</span><span className="font-extrabold">{formatPKR(order.estimatedCost)}</span></p>
                            <p className="flex justify-between"><span className="text-pd-muted">{t("bdDetails.yourBudget")}</span><span>{formatPKR(order.estimatedBudget)}</span></p>
                            {order.estimatedCost > order.estimatedBudget && (
                                <p className="pt-1 text-xs font-bold text-pd-warning">
                                    {t("bdDetails.aboveBudget", { amount: formatPKR(order.estimatedCost - order.estimatedBudget) })}
                                </p>
                            )}
                            <p className="pt-1 text-xs text-pd-muted">
                                {t("bdDetails.approveHint", { amount: formatPKR(order.estimatedCost), fee: formatPKR(order.deliveryFee) })}
                            </p>
                        </div>
                        <div className="flex gap-2">
                            <button
                                type="button"
                                disabled={busy === "approve"}
                                onClick={() => void run("approve", () => approvePurchaseAmount(id, order.estimatedCost, token), t("bdDetails.approvedNotice"))}
                                className="h-12 flex-1 rounded-xl bg-[#087F5B] text-sm font-extrabold text-white disabled:opacity-50"
                            >
                                {t("bdDetails.approveAmount", { amount: formatPKR(order.estimatedCost) })}
                            </button>
                            <button
                                type="button"
                                disabled={busy === "reject"}
                                onClick={async () => {
                                    const note = await dialog.prompt({
                                        title: t("bdDetails.sendBackTitle"),
                                        label: t("bdDetails.sendBackLabel"),
                                        confirmLabel: t("bdDetails.sendBackConfirm"),
                                    });
                                    if (note === null) return;
                                    void run("reject", () => rejectPurchaseEstimate(id, note || "", token), t("bdDetails.sentBackNotice"));
                                }}
                                className="h-12 flex-1 rounded-xl bg-pd-surface text-sm font-bold text-pd-text-2 ring-1 ring-pd-line disabled:opacity-50"
                            >
                                {t("bdDetails.notYet")}
                            </button>
                        </div>
                    </section>
                )}

                {/* Substitutions */}
                {pendingSubstitutions.length > 0 && (
                    <section className="space-y-3 rounded-[24px] bg-pd-surface p-4 shadow-sm" aria-labelledby="subs-title">
                        <h2 id="subs-title" className="text-[15px] font-extrabold">{t("bdDetails.subsTitle")}</h2>
                        {pendingSubstitutions.map((sub) => (
                            <article key={sub._id} className="rounded-2xl bg-pd-surface-2 p-3.5">
                                <p className="text-sm font-semibold leading-relaxed">{sub.description}</p>
                                <p className="mt-1 text-[11px] font-medium text-pd-faint">
                                    {sub.createdAt ? new Date(sub.createdAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : ""}
                                </p>
                                <div className="mt-3 flex gap-2">
                                    <button
                                        type="button"
                                        disabled={busy === `sub:${sub._id}`}
                                        onClick={() => void run(`sub:${sub._id}`, () => decideSubstitution(id, { substitutionId: sub._id, approved: true }, token), t("bdDetails.subApprovedNotice"))}
                                        className="h-10 flex-1 rounded-xl bg-[#087F5B] text-sm font-extrabold text-white disabled:opacity-50"
                                    >
                                        Approve
                                    </button>
                                    <button
                                        type="button"
                                        disabled={busy === `sub:${sub._id}`}
                                        onClick={() => void run(`sub:${sub._id}`, () => decideSubstitution(id, { substitutionId: sub._id, approved: false }, token), t("bdDetails.subDeclinedNotice"))}
                                        className="h-10 flex-1 rounded-xl bg-pd-surface text-sm font-bold text-pd-text-2 ring-1 ring-pd-line disabled:opacity-50"
                                    >
                                        Reject
                                    </button>
                                </div>
                            </article>
                        ))}
                    </section>
                )}
                {decidedSubstitutions.length > 0 && (
                    <section className="rounded-[24px] bg-pd-surface p-4 shadow-sm">
                        <h2 className="mb-2 text-[15px] font-extrabold">{t("bdDetails.subsDecided")}</h2>
                        <ul className="space-y-2">
                            {decidedSubstitutions.map((sub) => (
                                <li key={sub._id} className="flex items-start justify-between gap-3 text-sm">
                                    <span className="min-w-0 flex-1 font-medium text-pd-text-2">{sub.description}</span>
                                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-extrabold ${sub.status === "APPROVED" ? "bg-emerald-50 text-[#087F5B]" : "bg-red-50 text-red-600"}`}>
                                        {sub.status}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    </section>
                )}

                {/* Items */}
                <section className="space-y-3 rounded-[24px] bg-pd-surface p-4 shadow-sm">
                    <h2 className="text-[15px] font-extrabold">{t("bdDetails.shoppingList")}</h2>
                    <p className="whitespace-pre-wrap rounded-2xl bg-pd-surface-2 p-3.5 text-sm leading-relaxed">{order.itemsText}</p>
                    {(order.imageUrls || []).length > 0 && (
                        <div className="flex flex-wrap gap-2">
                            {order.imageUrls.map((url) => (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img key={url} src={url} alt={t("bdDetails.reference")} className="h-20 w-20 rounded-2xl object-cover" />
                            ))}
                        </div>
                    )}
                    <dl className="space-y-1.5 text-sm">
                        <div className="flex justify-between gap-3"><dt className="text-pd-muted">{t("bdDetails.budget")}</dt><dd className="font-bold">{formatPKR(order.estimatedBudget)}</dd></div>
                        {order.preferences?.preferredShop && <div className="flex justify-between gap-3"><dt className="text-pd-muted">{t("bdDetails.preferredShop")}</dt><dd className="font-semibold">{order.preferences.preferredShop}</dd></div>}
                        {order.preferences?.preferredBrand && <div className="flex justify-between gap-3"><dt className="text-pd-muted">{t("bdDetails.preferredBrand")}</dt><dd className="font-semibold">{order.preferences.preferredBrand}</dd></div>}
                        <div className="flex justify-between gap-3"><dt className="text-pd-muted">{t("bdDetails.alternatives")}</dt><dd className="font-semibold">{order.preferences?.alternativesAllowed ? t("bdDetails.allowed") : t("bdDetails.notAllowed")}</dd></div>
                        {order.preferences?.alternativesNote && <div className="flex justify-between gap-3"><dt className="text-pd-muted">{t("bdDetails.alternativesNote")}</dt><dd className="text-right font-medium">{order.preferences.alternativesNote}</dd></div>}
                        {order.deliveryNotes && <div className="flex justify-between gap-3"><dt className="text-pd-muted">{t("bdDetails.deliveryNotes")}</dt><dd className="text-right font-medium">{order.deliveryNotes}</dd></div>}
                    </dl>
                    <p className="flex items-start gap-2 rounded-2xl bg-pd-surface-2 px-3.5 py-3 text-sm font-medium text-pd-text-2">
                        <MapPin size={16} className="mt-0.5 shrink-0 text-[#087F5B]" />
                        <span>{order.deliveryLabel ? `${order.deliveryLabel} — ` : ""}{deliveryAddressText || t("bdDetails.addressOnFile")}</span>
                    </p>
                    <DestinationMap
                        point={order.deliveryAddress}
                        label={order.deliveryLabel || deliveryAddressText || t("bdDetails.deliveryLocation")}
                        navigateLabel={t("bdDetails.navigate")}
                    />
                </section>

                {/* Receipts */}
                {(order.receiptImageUrls || []).length > 0 && (
                    <section className="rounded-[24px] bg-pd-surface p-4 shadow-sm">
                        <h2 className="mb-3 flex items-center gap-2 text-[15px] font-extrabold">
                            <ReceiptText size={17} className="text-[#087F5B]" /> {t("bdDetails.receipts")}
                        </h2>
                        <div className="flex flex-wrap gap-2">
                            {order.receiptImageUrls.map((url) => (
                                <a key={url} href={url} target="_blank" rel="noreferrer" className="block">
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img src={url} alt={t("bdDetails.purchaseReceipt")} className="h-24 w-24 rounded-2xl object-cover" />
                                </a>
                            ))}
                        </div>
                    </section>
                )}

                {/* Delivery OTP */}
                {OTP_STAGES.includes(order.status) && (
                    <section className="rounded-[24px] bg-pd-surface p-4 shadow-sm">
                        <h2 className="flex items-center gap-2 text-[15px] font-extrabold">
                            <KeyRound size={17} className="text-[#087F5B]" /> {t("bdDetails.deliveryCode")}
                        </h2>
                        <p className="mt-1 text-sm text-pd-muted">
                            {t("bdDetails.codeHint")}
                        </p>
                        {otp ? (
                            <p className="mt-3 rounded-2xl bg-[#111111] py-4 text-center text-3xl font-extrabold tracking-[0.35em] text-white">
                                {otp}
                            </p>
                        ) : (
                            <button
                                type="button"
                                disabled={busy === "otp"}
                                onClick={() => void showOtp()}
                                className="mt-3 h-12 w-full rounded-xl bg-[#087F5B] text-sm font-extrabold text-white disabled:opacity-50"
                            >
                                {busy === "otp" ? t("bdDetails.generating") : t("bdDetails.showCode")}
                            </button>
                        )}
                    </section>
                )}

                {/* COD breakdown + confirm payment */}
                {(order.status === "DELIVERED" || order.status === "COMPLETED") && (
                    <section className="space-y-2 rounded-[24px] bg-pd-surface p-4 shadow-sm">
                        <h2 className="flex items-center gap-2 text-[15px] font-extrabold">
                            <Banknote size={17} className="text-[#087F5B]" /> {t("bdDetails.cod")}
                        </h2>
                        <dl className="space-y-1.5 pt-1 text-sm font-semibold">
                            <div className="flex justify-between"><dt className="text-pd-muted">{t("bdDetails.shoppingActual")}</dt><dd>{formatPKR(order.actualCost)}</dd></div>
                            <div className="flex justify-between"><dt className="text-pd-muted">{t("bdDetails.deliveryFee")}</dt><dd>{formatPKR(order.deliveryFee)}</dd></div>
                            <div className="flex justify-between border-t border-pd-line pt-2 text-[15px]"><dt>{t("bdDetails.totalPayable")}</dt><dd className="font-extrabold">{formatPKR(order.customerTotalPayable)}</dd></div>
                            <div className="flex justify-between"><dt className="text-pd-muted">{t("bdDetails.paidSoFar")}</dt><dd>{formatPKR(order.reimbursementReceived || 0)}</dd></div>
                            <div className="flex justify-between"><dt className="text-pd-muted">{t("bdDetails.stillUnpaid")}</dt><dd className={order.unpaidAmount > 0 ? "font-extrabold text-red-600" : "font-bold text-[#087F5B]"}>{formatPKR(order.unpaidAmount || 0)}</dd></div>
                        </dl>
                        {order.status === "DELIVERED" && (order.unpaidAmount || 0) > 0 && (
                            <button
                                type="button"
                                disabled={busy === "pay"}
                                onClick={() => void run("pay", () => confirmPurchasePayment(id, order.customerTotalPayable, token), t("bdDetails.paymentConfirmed"))}
                                className="h-12 w-full rounded-xl bg-[#087F5B] text-sm font-extrabold text-white disabled:opacity-50"
                            >
                                {t("bdDetails.iPaid", { amount: formatPKR(order.customerTotalPayable) })}
                            </button>
                        )}
                        {order.status === "COMPLETED" && (
                            <p className="flex items-center gap-2 pt-1 text-sm font-bold text-[#087F5B]">
                                <BadgeCheck size={17} /> {t("bdDetails.fullyPaid")}
                            </p>
                        )}
                    </section>
                )}

                {/* Rating */}
                {canRate && (
                    <section className="space-y-3 rounded-[24px] bg-pd-surface p-4 shadow-sm">
                        <h2 className="text-[15px] font-extrabold">{t("bdDetails.ratePartner")}</h2>
                        <div className="flex gap-1.5" role="radiogroup" aria-label={t("bdDetails.yourRating")}>
                            {[1, 2, 3, 4, 5].map((value) => (
                                <button
                                    key={value}
                                    type="button"
                                    role="radio"
                                    aria-checked={rating === value}
                                    aria-label={`${value} star${value > 1 ? "s" : ""}`}
                                    onClick={() => setRating(value)}
                                    className="grid h-11 w-11 place-items-center rounded-xl bg-pd-surface-2"
                                >
                                    <Star size={22} className={value <= rating ? "fill-amber-400 text-amber-400" : "text-pd-faint"} />
                                </button>
                            ))}
                        </div>
                        <textarea
                            value={ratingComment}
                            onChange={(e) => setRatingComment(e.target.value)}
                            rows={2}
                            maxLength={1000}
                            placeholder={t("bdDetails.ratePlaceholder")}
                            className="w-full resize-none rounded-2xl border border-pd-line bg-pd-surface-2 px-4 py-3 text-[15px] outline-none placeholder:text-pd-faint focus:border-[#087F5B] focus:ring-2 focus:ring-[#087F5B]/25"
                        />
                        <button
                            type="button"
                            disabled={!rating || busy === "rate"}
                            onClick={() => void run("rate", () => ratePurchasePartner(id, { rating, comment: ratingComment.trim() }, token), t("bdDetails.thanksFeedback"))}
                            className="h-12 w-full rounded-xl bg-[#111111] text-sm font-extrabold text-white disabled:opacity-50"
                        >
                            {t("bdDetails.submitRating")}
                        </button>
                    </section>
                )}
                {order.ratedAt && (
                    <p className="rounded-[24px] bg-pd-surface px-4 py-3 text-center text-sm font-bold text-[#087F5B] shadow-sm">
                        ⭐ You rated this order — thank you!
                    </p>
                )}

                {/* Cancel / dispute */}
                {(CANCELLABLE.includes(order.status) || DISPUTABLE.includes(order.status)) && (
                    <section className="flex gap-2">
                        {CANCELLABLE.includes(order.status) && (
                            <button
                                type="button"
                                disabled={busy === "cancel"}
                                onClick={() => void handleCancel()}
                                className="flex h-12 flex-1 items-center justify-center gap-2 rounded-2xl bg-pd-surface text-sm font-bold text-pd-danger shadow-sm ring-1 ring-pd-line disabled:opacity-50"
                            >
                                <XCircle size={17} /> {t("bdDetails.cancelConfirm")}
                            </button>
                        )}
                        {DISPUTABLE.includes(order.status) && (
                            <button
                                type="button"
                                disabled={busy === "dispute"}
                                onClick={() => void handleDispute()}
                                className="flex h-12 flex-1 items-center justify-center gap-2 rounded-2xl bg-pd-surface text-sm font-bold text-pd-warning shadow-sm ring-1 ring-pd-line disabled:opacity-50"
                            >
                                <TriangleAlert size={17} /> {t("bdDetails.disputeTitle")}
                            </button>
                        )}
                    </section>
                )}
                {order.status === "DISPUTED" && (
                    <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
                        {t("bdDetails.disputedReview", { suffix: order.disputeReason ? ` — “${order.disputeReason}”` : "" })}
                    </p>
                )}
            </div>

            {chatPartner && (
                <OrderChat
                    orderType="PURCHASE"
                    orderId={id}
                    partnerUserId={chatPartner.partnerUserId}
                    token={token}
                    userId={user?._id || user?.id}
                    participantLabel={chatPartner.label}
                    directOpen
                    onClose={() => setChatPartner(null)}
                />
            )}

            {/* T-16/T-17: deep link from a chat alert / push tap
                (?chat=open&conversationId=…) opens that conversation
                directly, without needing the partner card. */}
            {deepChatId && (
                <OrderChat
                    orderType="PURCHASE"
                    orderId={id}
                    conversationId={deepChatId}
                    token={token}
                    userId={user?._id || user?.id}
                    participantLabel={t("bdDetails.chat")}
                    directOpen
                    onClose={() => setDeepChatId("")}
                />
            )}

            <MobileBottomNav role="PASSENGER" />
        </main>
    );
}
