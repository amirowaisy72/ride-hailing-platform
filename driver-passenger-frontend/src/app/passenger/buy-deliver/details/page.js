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
import MobileBottomNav from "@/components/MobileBottomNav";
import OrderChat from "@/components/OrderChat";
import { useAuth } from "@/context/AuthContext";
import { getRealtimeSocket } from "@/lib/socket";
import { formatPKR } from "@/lib/rideDisplay";
import PurchaseTimeline, {
    StatusPill,
    purchaseStatusMeta,
} from "@/components/order/PurchaseTimeline";
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
    return offer?.driver?.name || "Safar partner";
}

function vehicleText(vehicle) {
    if (!vehicle) return "";
    return [vehicle.color, vehicle.make, vehicle.model].filter(Boolean).join(" ") ||
        vehicle.type || vehicle.vehicleType || "";
}

function expiryText(expiresAt, now) {
    if (!expiresAt) return "";
    const ms = new Date(expiresAt).getTime() - now;
    if (ms <= 0) return "Expired";
    const totalSeconds = Math.floor(ms / 1000);
    return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, "0")} left`;
}

function OrderDetail() {
    const { token, user } = useAuth();
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
        if (!window.confirm(`Accept ${offerPartnerName(offer)}'s offer of ${formatPKR(offer.deliveryFee)} delivery fee? Other offers will be closed.`)) return;
        await run(
            `accept:${offer._id}`,
            () => acceptPurchaseOffer(id, offer._id, token),
            "Partner selected. They will start shopping shortly."
        );
    }

    async function showOtp() {
        await run("otp", async () => {
            const data = await regeneratePurchaseOtp(id, token);
            // Verified response: { success, stage: "DELIVERY", otp }
            setOtp(data.otp || "");
            if (!data.otp) throw new Error("OTP unavailable at this stage");
        });
    }

    async function handleCancel() {
        const reason = window.prompt("Why are you cancelling? (optional)", "");
        if (reason === null) return;
        if (!window.confirm("Cancel this shopping request?")) return;
        await run("cancel", () => cancelPurchaseOrder(id, reason || "", token), "Request cancelled.");
    }

    async function handleDispute() {
        const reason = window.prompt("Tell us what went wrong — our team will review this order.", "");
        if (!reason?.trim()) return;
        await run("dispute", () => raisePurchaseDispute(id, reason.trim(), token), "Dispute raised. Our team will review it.");
    }

    if (loading && !order) {
        return (
            <main className="flex min-h-dvh items-center justify-center bg-[#F4F5F7] text-sm font-semibold text-slate-500">
                Loading your request…
            </main>
        );
    }

    if (!order) {
        return (
            <main className="min-h-dvh bg-[#F4F5F7] pb-28 text-[#111111]">
                <div className="mx-auto max-w-xl px-4 pt-16 text-center">
                    <p className="font-extrabold">Request not found</p>
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
        <main className="min-h-dvh bg-[#F4F5F7] pb-28 text-[#111111]">
            <div className="sticky top-0 z-20 border-b border-slate-100 bg-white/95 backdrop-blur-xl">
                <div className="mx-auto flex max-w-xl items-center gap-2 px-3 pb-3 pt-[max(12px,env(safe-area-inset-top))]">
                    <Link href="/passenger/buy-deliver" aria-label="Back to Buy & Deliver" className="grid h-11 w-11 place-items-center rounded-2xl hover:bg-[#F4F5F7]">
                        <ArrowLeft size={21} />
                    </Link>
                    <div className="min-w-0 flex-1">
                        <h1 className="truncate text-lg font-extrabold leading-tight tracking-tight">Shopping request</h1>
                        <p className="text-xs text-slate-500">
                            {order.createdAt ? new Date(order.createdAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : ""}
                        </p>
                    </div>
                    <StatusPill meta={meta} />
                    <button type="button" aria-label="Refresh" onClick={() => void load()} className="grid h-11 w-11 place-items-center rounded-2xl text-slate-500 hover:bg-[#F4F5F7]">
                        <RefreshCw size={18} />
                    </button>
                </div>
            </div>

            <div className="mx-auto max-w-xl space-y-4 px-4 pt-4">
                {error && <p role="alert" className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-600">{error}</p>}
                {notice && <p role="status" className="rounded-2xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-[#087F5B]">{notice}</p>}

                <section className="rounded-[24px] bg-white p-4 shadow-sm">
                    <PurchaseTimeline status={order.status} />
                </section>

                {/* Offers */}
                {(order.status === "REQUESTED" || order.status === "BIDDING") && (
                    <section className="space-y-3 rounded-[24px] bg-white p-4 shadow-sm" aria-labelledby="offers-title">
                        <h2 id="offers-title" className="flex items-center gap-2 text-[15px] font-extrabold">
                            <Banknote size={17} className="text-[#087F5B]" />
                            Partner offers {offers.length > 0 && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-extrabold text-[#087F5B]">{offers.length}</span>}
                        </h2>
                        {offers.length === 0 ? (
                            <div className="rounded-2xl bg-[#F9FAFB] px-4 py-5 text-center">
                                <span className="relative mx-auto flex h-3 w-3">
                                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#087F5B] opacity-60" />
                                    <span className="relative inline-flex h-3 w-3 rounded-full bg-[#087F5B]" />
                                </span>
                                <p className="mt-3 text-sm font-bold">Waiting for nearby partners…</p>
                                <p className="mt-1 text-xs text-slate-500">Offers appear here with each partner&apos;s delivery fee. This page updates automatically.</p>
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {offers.map((offer) => (
                                    <article key={offer._id} className="rounded-2xl border border-slate-100 bg-[#F9FAFB] p-3.5">
                                        <div className="flex items-start justify-between gap-3">
                                            <div className="min-w-0">
                                                <p className="truncate text-[15px] font-extrabold">{offerPartnerName(offer)}</p>
                                                <p className="mt-0.5 text-xs font-semibold text-slate-500">
                                                    {offer.driver?.rating ? `★ ${Number(offer.driver.rating).toFixed(1)} (${offer.driver.ratingCount || 0})` : "New partner"}
                                                    {vehicleText(offer.driver?.vehicle) ? ` · ${vehicleText(offer.driver.vehicle)}` : ""}
                                                </p>
                                            </div>
                                            <div className="shrink-0 text-right">
                                                <p className="text-lg font-extrabold text-[#087F5B]">{formatPKR(offer.deliveryFee)}</p>
                                                <p className="text-[11px] font-bold text-amber-600">{expiryText(offer.expiresAt, now)}</p>
                                            </div>
                                        </div>
                                        <div className="mt-3 flex gap-2">
                                            <button
                                                type="button"
                                                disabled={!offerPartnerUserId(offer)}
                                                onClick={() => setChatPartner({ partnerUserId: String(offerPartnerUserId(offer)), label: offerPartnerName(offer) })}
                                                className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-[#111111] text-sm font-bold text-white disabled:opacity-40"
                                            >
                                                <MessageCircle size={16} /> Chat
                                            </button>
                                            <button
                                                type="button"
                                                disabled={busy === `accept:${offer._id}`}
                                                onClick={() => void acceptOffer(offer)}
                                                className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-[#087F5B] text-sm font-extrabold text-white disabled:opacity-50"
                                            >
                                                <BadgeCheck size={16} /> Accept
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
                    <section className="flex items-center gap-3 rounded-[24px] bg-white p-4 shadow-sm">
                        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-emerald-50 text-[#087F5B]">
                            <ShoppingBag size={22} />
                        </span>
                        <div className="min-w-0 flex-1">
                            <p className="text-[15px] font-extrabold">Your shopping partner</p>
                            <p className="text-xs font-semibold text-slate-500">
                                {order.shoppingLocation?.name ? `Shopping at ${order.shoppingLocation.name} · ` : ""}
                                Delivery fee {formatPKR(order.deliveryFee)}
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={() => setChatPartner({ partnerUserId: String(order.driverId), label: "your shopping partner" })}
                            className="flex h-11 shrink-0 items-center gap-2 rounded-xl bg-[#111111] px-4 text-sm font-bold text-white"
                        >
                            <MessageCircle size={16} /> Chat
                        </button>
                    </section>
                )}

                {/* Approval */}
                {order.status === "AWAITING_APPROVAL" && (
                    <section className="space-y-3 rounded-[24px] border-2 border-orange-200 bg-orange-50 p-4 shadow-sm" aria-labelledby="approval-title">
                        <h2 id="approval-title" className="text-[15px] font-extrabold text-orange-900">Approve the shopping cost</h2>
                        <div className="space-y-1.5 rounded-2xl bg-white p-3.5 text-sm font-semibold">
                            <p className="flex justify-between"><span className="text-slate-500">Partner&apos;s estimate</span><span className="font-extrabold">{formatPKR(order.estimatedCost)}</span></p>
                            <p className="flex justify-between"><span className="text-slate-500">Your budget</span><span>{formatPKR(order.estimatedBudget)}</span></p>
                            {order.estimatedCost > order.estimatedBudget && (
                                <p className="pt-1 text-xs font-bold text-orange-700">
                                    This is {formatPKR(order.estimatedCost - order.estimatedBudget)} above your budget — approve only if you are happy with it.
                                </p>
                            )}
                            <p className="pt-1 text-xs text-slate-500">
                                Approving means the partner may spend up to {formatPKR(order.estimatedCost)}. You pay the actual items cost + {formatPKR(order.deliveryFee)} delivery fee in cash at delivery.
                            </p>
                        </div>
                        <div className="flex gap-2">
                            <button
                                type="button"
                                disabled={busy === "approve"}
                                onClick={() => void run("approve", () => approvePurchaseAmount(id, order.estimatedCost, token), "Amount approved — your partner can buy your items now.")}
                                className="h-12 flex-1 rounded-xl bg-[#087F5B] text-sm font-extrabold text-white disabled:opacity-50"
                            >
                                Approve {formatPKR(order.estimatedCost)}
                            </button>
                            <button
                                type="button"
                                disabled={busy === "reject"}
                                onClick={() => {
                                    const note = window.prompt("Anything the partner should change? (optional)", "");
                                    if (note === null) return;
                                    void run("reject", () => rejectPurchaseEstimate(id, note || "", token), "Estimate sent back — your partner will revise it.");
                                }}
                                className="h-12 flex-1 rounded-xl bg-white text-sm font-bold text-slate-700 ring-1 ring-slate-200 disabled:opacity-50"
                            >
                                Not yet
                            </button>
                        </div>
                    </section>
                )}

                {/* Substitutions */}
                {pendingSubstitutions.length > 0 && (
                    <section className="space-y-3 rounded-[24px] bg-white p-4 shadow-sm" aria-labelledby="subs-title">
                        <h2 id="subs-title" className="text-[15px] font-extrabold">Substitution requests</h2>
                        {pendingSubstitutions.map((sub) => (
                            <article key={sub._id} className="rounded-2xl bg-[#F9FAFB] p-3.5">
                                <p className="text-sm font-semibold leading-relaxed">{sub.description}</p>
                                <p className="mt-1 text-[11px] font-medium text-slate-400">
                                    {sub.createdAt ? new Date(sub.createdAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : ""}
                                </p>
                                <div className="mt-3 flex gap-2">
                                    <button
                                        type="button"
                                        disabled={busy === `sub:${sub._id}`}
                                        onClick={() => void run(`sub:${sub._id}`, () => decideSubstitution(id, { substitutionId: sub._id, approved: true }, token), "Substitution approved.")}
                                        className="h-10 flex-1 rounded-xl bg-[#087F5B] text-sm font-extrabold text-white disabled:opacity-50"
                                    >
                                        Approve
                                    </button>
                                    <button
                                        type="button"
                                        disabled={busy === `sub:${sub._id}`}
                                        onClick={() => void run(`sub:${sub._id}`, () => decideSubstitution(id, { substitutionId: sub._id, approved: false }, token), "Substitution declined.")}
                                        className="h-10 flex-1 rounded-xl bg-white text-sm font-bold text-slate-700 ring-1 ring-slate-200 disabled:opacity-50"
                                    >
                                        Reject
                                    </button>
                                </div>
                            </article>
                        ))}
                    </section>
                )}
                {decidedSubstitutions.length > 0 && (
                    <section className="rounded-[24px] bg-white p-4 shadow-sm">
                        <h2 className="mb-2 text-[15px] font-extrabold">Substitutions decided</h2>
                        <ul className="space-y-2">
                            {decidedSubstitutions.map((sub) => (
                                <li key={sub._id} className="flex items-start justify-between gap-3 text-sm">
                                    <span className="min-w-0 flex-1 font-medium text-slate-600">{sub.description}</span>
                                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-extrabold ${sub.status === "APPROVED" ? "bg-emerald-50 text-[#087F5B]" : "bg-red-50 text-red-600"}`}>
                                        {sub.status}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    </section>
                )}

                {/* Items */}
                <section className="space-y-3 rounded-[24px] bg-white p-4 shadow-sm">
                    <h2 className="text-[15px] font-extrabold">Shopping list</h2>
                    <p className="whitespace-pre-wrap rounded-2xl bg-[#F9FAFB] p-3.5 text-sm leading-relaxed">{order.itemsText}</p>
                    {(order.imageUrls || []).length > 0 && (
                        <div className="flex flex-wrap gap-2">
                            {order.imageUrls.map((url) => (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img key={url} src={url} alt="Reference" className="h-20 w-20 rounded-2xl object-cover" />
                            ))}
                        </div>
                    )}
                    <dl className="space-y-1.5 text-sm">
                        <div className="flex justify-between gap-3"><dt className="text-slate-500">Budget</dt><dd className="font-bold">{formatPKR(order.estimatedBudget)}</dd></div>
                        {order.preferences?.preferredShop && <div className="flex justify-between gap-3"><dt className="text-slate-500">Preferred shop</dt><dd className="font-semibold">{order.preferences.preferredShop}</dd></div>}
                        {order.preferences?.preferredBrand && <div className="flex justify-between gap-3"><dt className="text-slate-500">Preferred brand</dt><dd className="font-semibold">{order.preferences.preferredBrand}</dd></div>}
                        <div className="flex justify-between gap-3"><dt className="text-slate-500">Alternatives</dt><dd className="font-semibold">{order.preferences?.alternativesAllowed ? "Allowed" : "Not allowed"}</dd></div>
                        {order.preferences?.alternativesNote && <div className="flex justify-between gap-3"><dt className="text-slate-500">Alternatives note</dt><dd className="text-right font-medium">{order.preferences.alternativesNote}</dd></div>}
                        {order.deliveryNotes && <div className="flex justify-between gap-3"><dt className="text-slate-500">Delivery notes</dt><dd className="text-right font-medium">{order.deliveryNotes}</dd></div>}
                    </dl>
                    <p className="flex items-start gap-2 rounded-2xl bg-[#F9FAFB] px-3.5 py-3 text-sm font-medium text-slate-600">
                        <MapPin size={16} className="mt-0.5 shrink-0 text-[#087F5B]" />
                        <span>{order.deliveryLabel ? `${order.deliveryLabel} — ` : ""}{deliveryAddressText || "Delivery address on file"}</span>
                    </p>
                </section>

                {/* Receipts */}
                {(order.receiptImageUrls || []).length > 0 && (
                    <section className="rounded-[24px] bg-white p-4 shadow-sm">
                        <h2 className="mb-3 flex items-center gap-2 text-[15px] font-extrabold">
                            <ReceiptText size={17} className="text-[#087F5B]" /> Receipts
                        </h2>
                        <div className="flex flex-wrap gap-2">
                            {order.receiptImageUrls.map((url) => (
                                <a key={url} href={url} target="_blank" rel="noreferrer" className="block">
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img src={url} alt="Purchase receipt" className="h-24 w-24 rounded-2xl object-cover" />
                                </a>
                            ))}
                        </div>
                    </section>
                )}

                {/* Delivery OTP */}
                {OTP_STAGES.includes(order.status) && (
                    <section className="rounded-[24px] bg-white p-4 shadow-sm">
                        <h2 className="flex items-center gap-2 text-[15px] font-extrabold">
                            <KeyRound size={17} className="text-[#087F5B]" /> Delivery code
                        </h2>
                        <p className="mt-1 text-sm text-slate-500">
                            Share this code with your partner only when your items are at your door.
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
                                {busy === "otp" ? "Generating…" : "Show my delivery code"}
                            </button>
                        )}
                    </section>
                )}

                {/* COD breakdown + confirm payment */}
                {(order.status === "DELIVERED" || order.status === "COMPLETED") && (
                    <section className="space-y-2 rounded-[24px] bg-white p-4 shadow-sm">
                        <h2 className="flex items-center gap-2 text-[15px] font-extrabold">
                            <Banknote size={17} className="text-[#087F5B]" /> Cash on delivery
                        </h2>
                        <dl className="space-y-1.5 pt-1 text-sm font-semibold">
                            <div className="flex justify-between"><dt className="text-slate-500">Shopping (actual)</dt><dd>{formatPKR(order.actualCost)}</dd></div>
                            <div className="flex justify-between"><dt className="text-slate-500">Delivery fee</dt><dd>{formatPKR(order.deliveryFee)}</dd></div>
                            <div className="flex justify-between border-t border-slate-100 pt-2 text-[15px]"><dt>Total payable</dt><dd className="font-extrabold">{formatPKR(order.customerTotalPayable)}</dd></div>
                            <div className="flex justify-between"><dt className="text-slate-500">Paid so far</dt><dd>{formatPKR(order.reimbursementReceived || 0)}</dd></div>
                            <div className="flex justify-between"><dt className="text-slate-500">Still unpaid</dt><dd className={order.unpaidAmount > 0 ? "font-extrabold text-red-600" : "font-bold text-[#087F5B]"}>{formatPKR(order.unpaidAmount || 0)}</dd></div>
                        </dl>
                        {order.status === "DELIVERED" && (order.unpaidAmount || 0) > 0 && (
                            <button
                                type="button"
                                disabled={busy === "pay"}
                                onClick={() => void run("pay", () => confirmPurchasePayment(id, order.customerTotalPayable, token), "Payment confirmed — thank you!")}
                                className="h-12 w-full rounded-xl bg-[#087F5B] text-sm font-extrabold text-white disabled:opacity-50"
                            >
                                I paid {formatPKR(order.customerTotalPayable)} in cash
                            </button>
                        )}
                        {order.status === "COMPLETED" && (
                            <p className="flex items-center gap-2 pt-1 text-sm font-bold text-[#087F5B]">
                                <BadgeCheck size={17} /> Fully paid — order complete.
                            </p>
                        )}
                    </section>
                )}

                {/* Rating */}
                {canRate && (
                    <section className="space-y-3 rounded-[24px] bg-white p-4 shadow-sm">
                        <h2 className="text-[15px] font-extrabold">Rate your partner</h2>
                        <div className="flex gap-1.5" role="radiogroup" aria-label="Your rating">
                            {[1, 2, 3, 4, 5].map((value) => (
                                <button
                                    key={value}
                                    type="button"
                                    role="radio"
                                    aria-checked={rating === value}
                                    aria-label={`${value} star${value > 1 ? "s" : ""}`}
                                    onClick={() => setRating(value)}
                                    className="grid h-11 w-11 place-items-center rounded-xl bg-[#F9FAFB]"
                                >
                                    <Star size={22} className={value <= rating ? "fill-amber-400 text-amber-400" : "text-slate-300"} />
                                </button>
                            ))}
                        </div>
                        <textarea
                            value={ratingComment}
                            onChange={(e) => setRatingComment(e.target.value)}
                            rows={2}
                            maxLength={1000}
                            placeholder="How was the shopping and delivery? (optional)"
                            className="w-full resize-none rounded-2xl border border-slate-200 bg-[#F9FAFB] px-4 py-3 text-[15px] outline-none placeholder:text-slate-400 focus:border-[#087F5B] focus:ring-2 focus:ring-[#087F5B]/25"
                        />
                        <button
                            type="button"
                            disabled={!rating || busy === "rate"}
                            onClick={() => void run("rate", () => ratePurchasePartner(id, { rating, comment: ratingComment.trim() }, token), "Thanks for your feedback!")}
                            className="h-12 w-full rounded-xl bg-[#111111] text-sm font-extrabold text-white disabled:opacity-50"
                        >
                            Submit rating
                        </button>
                    </section>
                )}
                {order.ratedAt && (
                    <p className="rounded-[24px] bg-white px-4 py-3 text-center text-sm font-bold text-[#087F5B] shadow-sm">
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
                                className="flex h-12 flex-1 items-center justify-center gap-2 rounded-2xl bg-white text-sm font-bold text-red-600 shadow-sm ring-1 ring-red-100 disabled:opacity-50"
                            >
                                <XCircle size={17} /> Cancel request
                            </button>
                        )}
                        {DISPUTABLE.includes(order.status) && (
                            <button
                                type="button"
                                disabled={busy === "dispute"}
                                onClick={() => void handleDispute()}
                                className="flex h-12 flex-1 items-center justify-center gap-2 rounded-2xl bg-white text-sm font-bold text-amber-700 shadow-sm ring-1 ring-amber-100 disabled:opacity-50"
                            >
                                <TriangleAlert size={17} /> Raise a dispute
                            </button>
                        )}
                    </section>
                )}
                {order.status === "DISPUTED" && (
                    <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
                        This order is under dispute review{order.disputeReason ? ` — “${order.disputeReason}”` : ""}. Our team will contact you.
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

            <MobileBottomNav role="PASSENGER" />
        </main>
    );
}
