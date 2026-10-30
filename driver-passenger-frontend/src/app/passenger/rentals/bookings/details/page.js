"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
    ArrowLeft,
    BadgeCheck,
    Banknote,
    CalendarDays,
    CarFront,
    ImagePlus,
    KeyRound,
    Landmark,
    Loader2,
    MapPin,
    MessageCircle,
    Phone,
    RefreshCw,
    Star,
    TriangleAlert,
    XCircle,
} from "lucide-react";
import AuthGuard from "@/components/AuthGuard";
import { useActionDialog } from "@/components/ActionDialog";
import MobileBottomNav from "@/components/MobileBottomNav";
import OrderChat from "@/components/OrderChat";
import { useAuth } from "@/context/AuthContext";
import { getRealtimeSocket } from "@/lib/socket";
import { formatPKR } from "@/lib/rideDisplay";
import { vehiclePhoto, vehicleTitle } from "@/lib/rentalDisplay";
import { uploadOrderImage } from "@/lib/orderChatService";
import {
    RentalTimeline,
    StatusPill,
    rentalStatusMeta,
} from "@/components/order/PurchaseTimeline";
import {
    cancelRentalBooking,
    confirmRentalReturn,
    getRentalBooking,
    getRentalFeeInstructions,
    getRentalPickupOtp,
    raiseRentalDispute,
    rateRentalBooking,
    submitRentalFeePayment,
} from "@/lib/rentalService";

export default function RentalBookingPage() {
    return (
        <AuthGuard role="PASSENGER">
            <BookingDetail />
        </AuthGuard>
    );
}

const CANCELLABLE = ["REQUESTED", "PROVIDER_ACCEPTED", "PAYMENT_PENDING", "CONFIRMED"];
const DISPUTABLE = ["CONFIRMED", "PICKUP_VERIFIED", "RENTAL_ACTIVE", "RETURN_PENDING"];

function countdown(deadline, now) {
    if (!deadline) return "";
    const ms = new Date(deadline).getTime() - now;
    if (ms <= 0) return "Deadline passed";
    const totalMinutes = Math.floor(ms / 60000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours >= 24) return `${Math.floor(hours / 24)}d ${hours % 24}h left`;
    if (hours > 0) return `${hours}h ${minutes}m left`;
    return `${minutes}m left`;
}

function BookingDetail() {
    const { token, user } = useAuth();
    const dialog = useActionDialog();
    const searchParams = useSearchParams();
    const id = String(searchParams.get("id") || "");

    const [booking, setBooking] = useState(null);
    const [feeInfo, setFeeInfo] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const [busy, setBusy] = useState("");
    const [now, setNow] = useState(() => Date.now());
    // T-16/T-17: ?chat=open (chat alert / push tap) opens the chat directly.
    const [chatOpen, setChatOpen] = useState(() => searchParams.get("chat") === "open");
    const [otp, setOtp] = useState("");

    const [feeReference, setFeeReference] = useState("");
    const [feeSender, setFeeSender] = useState("");
    const [proofUrl, setProofUrl] = useState("");
    const [proofUploading, setProofUploading] = useState(false);
    const proofRef = useRef(null);

    const [rating, setRating] = useState(0);
    const [ratingComment, setRatingComment] = useState("");

    const load = useCallback(async () => {
        if (!token || !id) return;
        try {
            const data = await getRentalBooking(id, token);
            setBooking(data.booking || null);
            setError("");
            const status = data.booking?.status;
            if (status === "PROVIDER_ACCEPTED" || status === "PAYMENT_PENDING") {
                try {
                    const fee = await getRentalFeeInstructions(id, token);
                    setFeeInfo(fee);
                } catch { /* Panel falls back to booking amounts. */ }
            } else {
                setFeeInfo(null);
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
        const timer = setInterval(() => setNow(Date.now()), 30000);
        return () => clearInterval(timer);
    }, []);

    // Live updates for this booking + a 15s poll fallback.
    useEffect(() => {
        if (!token || !id) return;
        const socket = getRealtimeSocket();
        const refresh = (payload) => {
            if (payload?.bookingId && String(payload.bookingId) !== id) return;
            void load();
        };
        socket?.on("rental:booking:updated", refresh);
        socket?.on("rental:payment:submitted", refresh);
        socket?.on("connect", refresh);
        const timer = setInterval(() => {
            if (!document.hidden) void load();
        }, 15_000);
        return () => {
            socket?.off("rental:booking:updated", refresh);
            socket?.off("rental:payment:submitted", refresh);
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

    async function uploadProof(file) {
        if (!file) return;
        setProofUploading(true);
        setError("");
        try {
            const uploaded = await uploadOrderImage(file, token);
            const url = uploaded.imageUrl || uploaded.url;
            if (!url) throw new Error("Proof upload failed");
            setProofUrl(url);
        } catch (e) {
            setError(e.message);
        } finally {
            setProofUploading(false);
        }
    }

    async function submitFee(event) {
        event.preventDefault();
        if (!feeReference.trim()) { setError("Enter the bank transfer reference."); return; }
        if (!proofUrl) { setError("Attach a photo or screenshot of your payment proof."); return; }
        await run("fee", () => submitRentalFeePayment(id, {
            reference: feeReference.trim(),
            proofImageUrl: proofUrl,
            senderAccountTitle: feeSender.trim(),
        }, token), "Payment proof submitted — Safar will verify it and confirm your booking.");
    }

    async function showPickupOtp() {
        await run("otp", async () => {
            const data = await getRentalPickupOtp(id, token);
            // Verified response: { success, bookingRef, otp }
            setOtp(data.otp || "");
            if (!data.otp) throw new Error("Pickup code unavailable at this stage");
        });
    }

    async function handleCancel() {
        const reason = await dialog.prompt({
            title: "Cancel this booking?",
            label: "Why are you cancelling?",
            confirmLabel: "Continue",
        });
        if (reason === null) return;
        if (!(await dialog.confirm({
            title: "Cancel this booking?",
            message: "Any booking-fee refund follows the vehicle's cancellation policy.",
            confirmLabel: "Cancel booking",
            cancelLabel: "Keep booking",
            danger: true,
        }))) return;
        await run("cancel", () => cancelRentalBooking(id, reason || "", token), "Booking cancelled.");
    }

    async function handleDispute() {
        const reason = await dialog.prompt({
            title: "Raise a dispute",
            label: "Tell us what went wrong — our team will review this booking.",
            optional: false,
            confirmLabel: "Send dispute",
        });
        if (!reason?.trim()) return;
        await run("dispute", () => raiseRentalDispute(id, reason.trim(), token), "Dispute raised. Our team will review it.");
    }

    if (loading && !booking) {
        return (
            <main className="flex min-h-dvh items-center justify-center bg-pd-bg text-sm font-semibold text-pd-muted">
                Loading your booking…
            </main>
        );
    }

    if (!booking) {
        return (
            <main className="min-h-dvh bg-pd-bg pb-28 text-pd-text">
                <div className="mx-auto max-w-xl px-4 pt-16 text-center">
                    <p className="font-extrabold">Booking not found</p>
                    {error && <p className="mt-2 text-sm text-pd-danger">{error}</p>}
                    <Link href="/passenger/rentals" className="mt-4 inline-block rounded-2xl bg-[#087F5B] px-5 py-3 text-sm font-extrabold text-white">
                        Back to Rentals
                    </Link>
                </div>
                <MobileBottomNav role="PASSENGER" />
            </main>
        );
    }

    const vehicle = booking.vehicle;
    const photo = vehiclePhoto(vehicle);
    const meta = rentalStatusMeta(booking.status);
    const feeStatus = feeInfo?.feePaymentStatus || booking.feePayment?.status || "NOT_SUBMITTED";
    const feeDue = ["PROVIDER_ACCEPTED", "PAYMENT_PENDING"].includes(booking.status);
    const showFeeForm = feeDue && feeStatus !== "VERIFIED" && feeStatus !== "SUBMITTED";
    const canRate = booking.status === "COMPLETED" && !booking.ratedAt;
    const dues = booking.returnDues || {};

    return (
        <main className="min-h-dvh bg-pd-bg pb-28 text-pd-text">
            <div className="sticky top-0 z-20 border-b border-pd-line bg-pd-elevated backdrop-blur-xl">
                <div className="mx-auto flex max-w-xl items-center gap-2 px-3 pb-3 pt-[max(12px,env(safe-area-inset-top))]">
                    <Link href="/passenger/rentals" aria-label="Back to Rentals" className="grid h-11 w-11 place-items-center rounded-2xl hover:bg-pd-bg">
                        <ArrowLeft size={21} />
                    </Link>
                    <div className="min-w-0 flex-1">
                        <h1 className="truncate text-lg font-extrabold leading-tight tracking-tight">{vehicleTitle(vehicle)}</h1>
                        <p className="text-xs text-pd-muted">Ref {booking.bookingRef} · {booking.mode === "SELF_DRIVE" ? "Self-drive" : "With driver"}</p>
                    </div>
                    <StatusPill meta={meta} />
                    <button type="button" aria-label="Refresh" onClick={() => void load()} className="grid h-11 w-11 place-items-center rounded-2xl text-pd-muted hover:bg-pd-bg">
                        <RefreshCw size={18} />
                    </button>
                </div>
            </div>

            <div className="mx-auto max-w-xl space-y-4 px-4 pt-4">
                {error && <p role="alert" className="rounded-2xl bg-pd-danger-soft px-4 py-3 text-sm font-semibold text-pd-danger">{error}</p>}
                {notice && <p role="status" className="rounded-2xl bg-pd-success-soft px-4 py-3 text-sm font-semibold text-[#087F5B]">{notice}</p>}

                <section className="rounded-[24px] bg-pd-surface p-4 shadow-sm">
                    <RentalTimeline status={booking.status} />
                </section>

                {/* Vehicle + window */}
                <section className="rounded-[24px] bg-pd-surface p-4 shadow-sm">
                    <div className="flex gap-3">
                        <span className="grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-2xl bg-pd-surface-3 text-pd-faint">
                            {photo ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={photo} alt={vehicleTitle(vehicle)} className="h-full w-full object-cover" />
                            ) : (
                                <CarFront size={28} />
                            )}
                        </span>
                        <div className="min-w-0 flex-1 text-sm">
                            <p className="text-[15px] font-extrabold">{vehicleTitle(vehicle)}</p>
                            <p className="mt-0.5 flex items-center gap-1.5 font-semibold text-pd-muted">
                                <CalendarDays size={13} />
                                {booking.startAt ? new Date(booking.startAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : ""}
                            </p>
                            <p className="font-semibold text-pd-muted">
                                → {booking.endAt ? new Date(booking.endAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : ""}
                            </p>
                            <p className="mt-0.5 text-xs font-semibold text-pd-faint">
                                {booking.units} × {String(booking.billingUnit || "").toLowerCase()} @ {formatPKR(booking.ratePerUnit)}
                            </p>
                        </div>
                    </div>
                    <dl className="mt-4 space-y-1.5 border-t border-pd-line pt-3 text-sm font-semibold">
                        <div className="flex justify-between"><dt className="text-pd-muted">Rental charges</dt><dd>{formatPKR(booking.rentalCharges)}</dd></div>
                        <div className="flex justify-between"><dt className="text-pd-muted">Booking fee ({booking.bookingFeePercent}%)</dt><dd>{formatPKR(booking.bookingFee)}</dd></div>
                        <div className="flex justify-between"><dt className="text-pd-muted">Security deposit (at pickup, refundable)</dt><dd>{formatPKR(booking.securityDeposit)}</dd></div>
                    </dl>
                    <button
                        type="button"
                        disabled={!booking.partnerUserId}
                        onClick={() => setChatOpen(true)}
                        className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-pd-ink text-sm font-bold text-pd-ink-text disabled:opacity-40"
                    >
                        <MessageCircle size={17} /> Chat with the vehicle owner
                    </button>
                </section>

                {/* Fee instructions + proof */}
                {feeDue && (
                    <section className="space-y-3 rounded-[24px] border-2 border-pd-line bg-pd-warning-soft p-4 shadow-sm" aria-labelledby="fee-title">
                        <h2 id="fee-title" className="flex items-center gap-2 text-[15px] font-extrabold text-pd-warning">
                            <Landmark size={17} /> Pay the booking fee to confirm
                        </h2>
                        <div className="space-y-1.5 rounded-2xl bg-pd-surface p-3.5 text-sm font-semibold">
                            <p className="flex justify-between"><span className="text-pd-muted">Booking fee due</span><span className="font-extrabold">{formatPKR(feeInfo?.bookingFee ?? booking.bookingFee)}</span></p>
                            <p className="flex justify-between"><span className="text-pd-muted">Status</span>
                                <span className={feeStatus === "REJECTED" ? "font-extrabold text-pd-danger" : feeStatus === "SUBMITTED" ? "font-extrabold text-pd-warning" : "font-bold"}>
                                    {feeStatus === "NOT_SUBMITTED" ? "Not submitted" : feeStatus === "SUBMITTED" ? "Submitted — verifying" : feeStatus === "VERIFIED" ? "Verified" : "Rejected — please resubmit"}
                                </span>
                            </p>
                            {(feeInfo?.paymentDeadlineAt || booking.paymentDeadlineAt) && (
                                <p className="flex justify-between"><span className="text-pd-muted">Pay before</span>
                                    <span className="font-bold text-pd-warning">
                                        {new Date(feeInfo?.paymentDeadlineAt || booking.paymentDeadlineAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                                        {" · "}{countdown(feeInfo?.paymentDeadlineAt || booking.paymentDeadlineAt, now)}
                                    </span>
                                </p>
                            )}
                            {booking.feePayment?.rejectionReason && feeStatus === "REJECTED" && (
                                <p className="pt-1 text-xs font-bold text-pd-danger">Reason: {booking.feePayment.rejectionReason}</p>
                            )}
                        </div>

                        {feeInfo?.bank && (feeInfo.bank.bankName || feeInfo.bank.bankAccountNumber) && (
                            <div className="space-y-1 rounded-2xl bg-pd-surface p-3.5 text-sm">
                                <p className="font-extrabold">Transfer to Safar</p>
                                <p className="font-semibold">{feeInfo.bank.bankName}</p>
                                <p className="font-medium text-pd-muted">{feeInfo.bank.bankAccountTitle}</p>
                                <p className="select-all font-mono text-[15px] font-bold tracking-wide">{feeInfo.bank.bankAccountNumber}</p>
                                {feeInfo.bank.note && <p className="text-xs text-pd-faint">{feeInfo.bank.note}</p>}
                                <p className="text-xs text-pd-faint">Write your booking ref <span className="font-bold text-pd-muted">{booking.bookingRef}</span> in the transfer note.</p>
                            </div>
                        )}

                        {feeStatus === "SUBMITTED" && (
                            <p className="flex items-center gap-2 rounded-2xl bg-pd-surface px-3.5 py-3 text-sm font-bold text-pd-warning">
                                <Loader2 size={16} className="animate-spin" /> Proof received — Safar is verifying your payment.
                            </p>
                        )}

                        {showFeeForm && (
                            <form onSubmit={submitFee} className="space-y-3 rounded-2xl bg-pd-surface p-3.5" noValidate>
                                <p className="text-sm font-extrabold">{feeStatus === "REJECTED" ? "Resubmit your payment proof" : "Already transferred? Send your proof"}</p>
                                <div>
                                    <label htmlFor="fee-ref" className="mb-1.5 block text-xs font-bold text-pd-muted">Transfer reference / transaction ID</label>
                                    <input
                                        id="fee-ref"
                                        value={feeReference}
                                        onChange={(e) => setFeeReference(e.target.value)}
                                        maxLength={120}
                                        placeholder="e.g. FT123456789"
                                        className="w-full rounded-2xl border border-pd-line bg-pd-surface-2 px-4 py-3 text-sm font-semibold text-pd-text outline-none focus:border-[#087F5B] focus:ring-2 focus:ring-[#087F5B]/25"
                                    />
                                </div>
                                <div>
                                    <label htmlFor="fee-sender" className="mb-1.5 block text-xs font-bold text-pd-muted">Your bank account title</label>
                                    <input
                                        id="fee-sender"
                                        value={feeSender}
                                        onChange={(e) => setFeeSender(e.target.value)}
                                        maxLength={120}
                                        placeholder="Name on the sending account"
                                        className="w-full rounded-2xl border border-pd-line bg-pd-surface-2 px-4 py-3 text-sm font-semibold text-pd-text outline-none focus:border-[#087F5B] focus:ring-2 focus:ring-[#087F5B]/25"
                                    />
                                </div>
                                <div>
                                    <p className="mb-1.5 text-xs font-bold text-pd-muted">Payment proof (screenshot / receipt photo)</p>
                                    {proofUrl ? (
                                        <div className="relative">
                                            {/* eslint-disable-next-line @next/next/no-img-element */}
                                            <img src={proofUrl} alt="Payment proof" className="h-36 w-full rounded-2xl object-cover" />
                                            <button type="button" onClick={() => setProofUrl("")} className="absolute right-2 top-2 rounded-full bg-black/60 px-3 py-1.5 text-xs font-bold text-white">
                                                Replace
                                            </button>
                                        </div>
                                    ) : (
                                        <button
                                            type="button"
                                            disabled={proofUploading}
                                            onClick={() => proofRef.current?.click()}
                                            className="grid h-24 w-full place-items-center rounded-2xl border-2 border-dashed border-pd-line text-sm font-bold text-pd-faint disabled:opacity-50"
                                        >
                                            {proofUploading ? <Loader2 size={20} className="animate-spin" /> : <span className="flex items-center gap-2"><ImagePlus size={18} /> Attach proof image</span>}
                                        </button>
                                    )}
                                    <input
                                        ref={proofRef}
                                        type="file"
                                        accept="image/*"
                                        className="hidden"
                                        aria-hidden="true"
                                        tabIndex={-1}
                                        onChange={(e) => {
                                            void uploadProof(e.target.files?.[0]);
                                            e.target.value = "";
                                        }}
                                    />
                                </div>
                                <button
                                    type="submit"
                                    disabled={busy === "fee"}
                                    className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#087F5B] text-sm font-extrabold text-white disabled:opacity-50"
                                >
                                    <Banknote size={17} /> {busy === "fee" ? "Submitting…" : "Submit payment proof"}
                                </button>
                            </form>
                        )}
                    </section>
                )}
                {booking.feePayment?.status === "VERIFIED" && (
                    <p className="flex items-center gap-2 rounded-[24px] bg-pd-surface px-4 py-3 text-sm font-bold text-[#087F5B] shadow-sm">
                        <BadgeCheck size={17} /> Booking fee verified — you are all set.
                    </p>
                )}

                {/* Pickup details (unlocked after confirmation) */}
                {vehicle?.contactUnlocked && (
                    <section className="space-y-2 rounded-[24px] bg-pd-surface p-4 shadow-sm">
                        <h2 className="flex items-center gap-2 text-[15px] font-extrabold">
                            <MapPin size={17} className="text-[#087F5B]" /> Pickup details
                        </h2>
                        <p className="text-sm font-semibold">{vehicle.exactPickupAddress || "Address shared by the owner in chat"}</p>
                        {(vehicle.pickupContactName || vehicle.pickupContactPhone) && (
                            <p className="flex items-center justify-between gap-3 text-sm font-medium text-pd-muted">
                                <span>{vehicle.pickupContactName}{vehicle.pickupContactPhone ? ` · ${vehicle.pickupContactPhone}` : ""}</span>
                                {vehicle.pickupContactPhone && (
                                    <a
                                        href={`tel:${String(vehicle.pickupContactPhone).replace(/[^+\d]/g, "")}`}
                                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#087F5B] text-white"
                                        aria-label="Call pickup contact"
                                    >
                                        <Phone size={17} />
                                    </a>
                                )}
                            </p>
                        )}
                    </section>
                )}

                {/* Pickup OTP */}
                {booking.status === "CONFIRMED" && (
                    <section className="rounded-[24px] bg-pd-surface p-4 shadow-sm">
                        <h2 className="flex items-center gap-2 text-[15px] font-extrabold">
                            <KeyRound size={17} className="text-[#087F5B]" /> Pickup code
                        </h2>
                        <p className="mt-1 text-sm text-pd-muted">
                            Share this code with the owner at handover so they can release the vehicle.
                        </p>
                        {otp ? (
                            <p className="mt-3 rounded-2xl bg-pd-ink py-4 text-center text-3xl font-extrabold tracking-[0.35em] text-pd-ink-text">{otp}</p>
                        ) : (
                            <button
                                type="button"
                                disabled={busy === "otp"}
                                onClick={() => void showPickupOtp()}
                                className="mt-3 h-12 w-full rounded-xl bg-[#087F5B] text-sm font-extrabold text-white disabled:opacity-50"
                            >
                                {busy === "otp" ? "Generating…" : "Show my pickup code"}
                            </button>
                        )}
                    </section>
                )}

                {/* Return confirmation */}
                {booking.status === "RETURN_PENDING" && (
                    <section className="space-y-2 rounded-[24px] border-2 border-pd-line bg-pd-warning-soft p-4 shadow-sm">
                        <h2 className="text-[15px] font-extrabold text-pd-warning">Confirm the return</h2>
                        <dl className="space-y-1.5 rounded-2xl bg-pd-surface p-3.5 text-sm font-semibold">
                            <div className="flex justify-between"><dt className="text-pd-muted">Driven</dt><dd>{dues.drivenKm ?? "—"} km</dd></div>
                            <div className="flex justify-between"><dt className="text-pd-muted">Extra km charges</dt><dd>{formatPKR(dues.extraKmCharges || 0)}</dd></div>
                            <div className="flex justify-between"><dt className="text-pd-muted">Overtime charges</dt><dd>{formatPKR(dues.overtimeCharges || 0)}</dd></div>
                            <div className="flex justify-between"><dt className="text-pd-muted">Other dues</dt><dd>{formatPKR(dues.otherDues || 0)}</dd></div>
                            <div className="flex justify-between border-t border-pd-line pt-2"><dt>Remaining dues</dt><dd className="font-extrabold">{formatPKR(dues.remainingDues || 0)}</dd></div>
                        </dl>
                        <p className="text-xs text-pd-warning">
                            Confirming means the vehicle is back with the owner and the dues above are settled. If anything looks wrong, raise a dispute instead.
                        </p>
                        <button
                            type="button"
                            disabled={busy === "return"}
                            onClick={() => void run("return", () => confirmRentalReturn(id, token), "Return confirmed — rental complete. Thank you!")}
                            className="h-12 w-full rounded-xl bg-[#087F5B] text-sm font-extrabold text-white disabled:opacity-50"
                        >
                            Confirm return & settle {formatPKR(dues.remainingDues || 0)}
                        </button>
                    </section>
                )}

                {/* Rating */}
                {canRate && (
                    <section className="space-y-3 rounded-[24px] bg-pd-surface p-4 shadow-sm">
                        <h2 className="text-[15px] font-extrabold">Rate this rental</h2>
                        <div className="flex gap-1.5" role="radiogroup" aria-label="Your rating">
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
                            placeholder="How was the car and the owner? (optional)"
                            className="w-full resize-none rounded-2xl border border-pd-line bg-pd-surface-2 px-4 py-3 text-[15px] text-pd-text outline-none placeholder:text-pd-faint focus:border-[#087F5B] focus:ring-2 focus:ring-[#087F5B]/25"
                        />
                        <button
                            type="button"
                            disabled={!rating || busy === "rate"}
                            onClick={() => void run("rate", () => rateRentalBooking(id, { rating, comment: ratingComment.trim() }, token), "Thanks for your feedback!")}
                            className="h-12 w-full rounded-xl bg-pd-ink text-sm font-extrabold text-pd-ink-text disabled:opacity-50"
                        >
                            Submit rating
                        </button>
                    </section>
                )}
                {booking.ratedAt && (
                    <p className="rounded-[24px] bg-pd-surface px-4 py-3 text-center text-sm font-bold text-[#087F5B] shadow-sm">
                        ⭐ You rated this rental — thank you!
                    </p>
                )}

                {/* Cancel / dispute */}
                {(CANCELLABLE.includes(booking.status) || DISPUTABLE.includes(booking.status)) && (
                    <section className="flex gap-2">
                        {CANCELLABLE.includes(booking.status) && (
                            <button
                                type="button"
                                disabled={busy === "cancel"}
                                onClick={() => void handleCancel()}
                                className="flex h-12 flex-1 items-center justify-center gap-2 rounded-2xl bg-pd-surface text-sm font-bold text-pd-danger shadow-sm ring-1 ring-red-100 disabled:opacity-50"
                            >
                                <XCircle size={17} /> Cancel booking
                            </button>
                        )}
                        {DISPUTABLE.includes(booking.status) && (
                            <button
                                type="button"
                                disabled={busy === "dispute"}
                                onClick={() => void handleDispute()}
                                className="flex h-12 flex-1 items-center justify-center gap-2 rounded-2xl bg-pd-surface text-sm font-bold text-pd-warning shadow-sm ring-1 ring-amber-100 disabled:opacity-50"
                            >
                                <TriangleAlert size={17} /> Raise a dispute
                            </button>
                        )}
                    </section>
                )}
                {booking.status === "DISPUTED" && (
                    <p className="rounded-2xl bg-pd-danger-soft px-4 py-3 text-sm font-semibold text-pd-danger">
                        This booking is under dispute review{booking.disputeReason ? ` — “${booking.disputeReason}”` : ""}. Our team will contact you.
                    </p>
                )}
                {booking.status === "CANCELLED" && booking.cancelReason && (
                    <p className="rounded-2xl bg-pd-surface-3 px-4 py-3 text-sm font-semibold text-pd-muted">
                        Cancelled — {booking.cancelReason}
                        {booking.feeRefund?.amount > 0 && ` · Fee refund ${booking.feeRefund.status === "REFUNDED" ? "sent" : "due"}: ${formatPKR(booking.feeRefund.amount)}`}
                    </p>
                )}
            </div>

            {chatOpen && booking.partnerUserId && (
                <OrderChat
                    orderType="RENTAL"
                    orderId={id}
                    partnerUserId={String(booking.partnerUserId)}
                    token={token}
                    userId={user?._id || user?.id}
                    participantLabel="the vehicle owner"
                    directOpen
                    onClose={() => setChatOpen(false)}
                />
            )}

            <MobileBottomNav role="PASSENGER" />
        </main>
    );
}
