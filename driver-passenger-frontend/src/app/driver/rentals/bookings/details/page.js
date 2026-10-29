"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
    ArrowLeft,
    Banknote,
    Camera,
    CarFront,
    CheckCircle2,
    CircleAlert,
    Fuel,
    Gauge,
    Hourglass,
    KeyRound,
    MessageCircle,
    Play,
    RefreshCw,
    Undo2,
    UserRound,
    X,
    XCircle,
} from "lucide-react";

import AuthGuard from "@/components/AuthGuard";
import MobileBottomNav from "@/components/MobileBottomNav";
import OrderChat from "@/components/OrderChat";
import { RentalTimeline } from "@/components/order/PurchaseTimeline";
// RentalTimeline is a named export; PurchaseTimeline is that module's default.
import { RENTAL_BOOKING_META } from "@/components/driver/RentalPartnerBookings";
import { useAuth } from "@/context/AuthContext";
import { getRealtimeSocket } from "@/lib/socket";
import { uploadOrderImage } from "@/lib/orderChatService";
import {
    acceptRentalBooking,
    getPartnerRentalBooking,
    rejectRentalBooking,
    startRental,
    submitRentalReturn,
    verifyRentalPickup,
} from "@/lib/rentalService";

// Rental Partner booking execution — accept/reject, OTP pickup
// verification with handover evidence, rental start, and the return
// inspection that settles extra-km / overtime dues.
//
// Money stays three-way separated, exactly as the backend stores it:
// rental charges (the partner's money), the platform booking fee
// (Safar's money — the partner never collects it) and the refundable
// security deposit.

const money = (value) =>
    value == null ? "—" : `PKR ${Number(value).toLocaleString("en-PK")}`;

const fmtDateTime = (value) =>
    value
        ? new Date(value).toLocaleString("en-PK", {
              day: "numeric",
              month: "short",
              hour: "numeric",
              minute: "2-digit",
          })
        : "—";

export default function PartnerRentalBookingPage() {
    return (
        <AuthGuard role="DRIVER">
            <BookingScreen />
        </AuthGuard>
    );
}

function BookingScreen() {
    const { token, user } = useAuth();
    const searchParams = useSearchParams();
    const bookingId = searchParams.get("id");

    const [booking, setBooking] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState(null);
    const [busy, setBusy] = useState("");
    const [chatOpen, setChatOpen] = useState(false);

    const [rejectReason, setRejectReason] = useState("");
    const [rejectOpen, setRejectOpen] = useState(false);
    const [otp, setOtp] = useState("");
    const [handover, setHandover] = useState({
        fuelLevelPercent: "",
        odometerKm: "",
        photoUrls: [],
        notes: "",
    });
    const [returnForm, setReturnForm] = useState({
        fuelLevelPercent: "",
        odometerKm: "",
        photoUrls: [],
        notes: "",
        otherDues: "",
    });
    const [uploading, setUploading] = useState("");
    const loadRef = useRef(null);

    const load = useCallback(async () => {
        if (!token || !bookingId) return;
        try {
            const data = await getPartnerRentalBooking(bookingId, token);
            setBooking(data.booking || null);
            setError("");
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, [token, bookingId]);

    useEffect(() => {
        loadRef.current = load;
    }, [load]);

    useEffect(() => {
        if (!token || !bookingId) return;
        void (async () => {
            await Promise.resolve();
            await load();
        })();
        const poll = setInterval(() => void loadRef.current?.(), 20000);
        const socket = getRealtimeSocket();
        const refresh = (payload) => {
            if (
                !payload?.bookingId ||
                String(payload.bookingId) === String(bookingId)
            ) {
                void loadRef.current?.();
            }
        };
        socket?.on("rental:booking:updated", refresh);
        return () => {
            clearInterval(poll);
            socket?.off("rental:booking:updated", refresh);
        };
    }, [token, bookingId, load]);

    async function run(key, action, successText) {
        if (busy) return;
        setBusy(key);
        setNotice(null);
        try {
            const data = await action();
            if (data?.booking) setBooking(data.booking);
            else void load();
            if (successText) setNotice({ kind: "success", text: successText });
        } catch (err) {
            setNotice({ kind: "error", text: err.message });
        } finally {
            setBusy("");
        }
    }

    async function uploadPhotos(target, files) {
        if (!files?.length || uploading) return;
        setUploading(target);
        setNotice(null);
        try {
            const urls = [];
            for (const file of files) {
                const result = await uploadOrderImage(file, token);
                if (result?.imageUrl) urls.push(result.imageUrl);
            }
            const setter = target === "handover" ? setHandover : setReturnForm;
            setter((prev) => ({
                ...prev,
                photoUrls: [...prev.photoUrls, ...urls].slice(0, 12),
            }));
        } catch (err) {
            setNotice({ kind: "error", text: err.message });
        } finally {
            setUploading("");
        }
    }

    const status = booking?.status;
    const meta = RENTAL_BOOKING_META[status] || {
        label: status || "",
        pill: "bg-slate-100 text-slate-600",
    };
    const vehicle = booking?.vehicle;
    const feeStatus = booking?.feePayment?.status;

    return (
        <main className="driver-subpage min-h-dvh bg-[#F7F9F8] pb-28 text-slate-900">
            <MobileBottomNav role="DRIVER" />

            <header className="bg-[#087F5B] px-5 pb-8 pt-[max(24px,env(safe-area-inset-top))] text-white">
                <div className="mx-auto max-w-xl">
                    <div className="flex items-center justify-between">
                        <Link
                            href="/driver/rentals"
                            className="inline-flex items-center gap-2 text-sm font-semibold"
                        >
                            <ArrowLeft size={19} /> My Rental Business
                        </Link>
                        <button
                            type="button"
                            onClick={() => void load()}
                            aria-label="Refresh booking"
                            className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/15"
                        >
                            <RefreshCw size={18} />
                        </button>
                    </div>
                    <h1 className="mt-6 flex items-center gap-3 text-3xl font-extrabold">
                        <KeyRound size={30} />
                        {booking?.bookingRef || "Rental Booking"}
                    </h1>
                    <p className="mt-2 text-sm text-white/75">
                        {vehicle
                            ? `${vehicle.brand} ${vehicle.model} (${vehicle.year}) · ${booking.mode === "WITH_DRIVER" ? "With Driver" : "Self-Drive"}`
                            : "Booking execution for rental partners."}
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
                ) : error && !booking ? (
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
                ) : booking ? (
                    <>
                        <section className="rounded-[24px] bg-white p-5 shadow-sm">
                            <div className="flex items-center gap-2">
                                <span
                                    className={`rounded-full px-3 py-1 text-xs font-extrabold ${meta.pill}`}
                                >
                                    {meta.label}
                                </span>
                                <span className="text-xs font-bold text-slate-400">
                                    {fmtDateTime(booking.startAt)} →{" "}
                                    {fmtDateTime(booking.endAt)}
                                </span>
                            </div>
                            <div className="mt-4">
                                <RentalTimeline status={status} />
                            </div>
                        </section>

                        <section className="grid grid-cols-2 gap-3">
                            <div className="rounded-[24px] bg-white p-5 shadow-sm">
                                <p className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-wider text-slate-500">
                                    <UserRound size={14} /> Customer
                                </p>
                                <p className="mt-2 text-sm font-bold">
                                    Renter
                                </p>
                                <p className="text-xs text-slate-500">
                                    {booking.mode === "WITH_DRIVER"
                                        ? "With Driver booking"
                                        : "Self-Drive booking"}
                                    {booking.renterLicence?.number
                                        ? ` · Licence ${booking.renterLicence.number}`
                                        : ""}
                                </p>
                                <button
                                    type="button"
                                    onClick={() => setChatOpen(true)}
                                    className="mt-3 inline-flex h-10 items-center gap-1.5 rounded-xl bg-[#087F5B] px-3.5 text-sm font-bold text-white"
                                >
                                    <MessageCircle size={15} /> Chat
                                </button>
                            </div>
                            <div className="rounded-[24px] bg-white p-5 shadow-sm">
                                <p className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-wider text-slate-500">
                                    <CarFront size={14} /> Vehicle
                                </p>
                                <p className="mt-2 text-sm font-bold">
                                    {vehicle
                                        ? `${vehicle.brand} ${vehicle.model}`
                                        : "—"}
                                </p>
                                <p className="text-xs text-slate-500">
                                    {vehicle
                                        ? `${vehicle.transmission === "AUTOMATIC" ? "Automatic" : "Manual"} · ${vehicle.seats} seats${vehicle.hasAC ? " · AC" : ""}`
                                        : ""}
                                </p>
                                <p className="mt-1 text-xs text-slate-500">
                                    Pickup:{" "}
                                    {vehicle?.contactUnlocked &&
                                    vehicle?.exactPickupAddress
                                        ? vehicle.exactPickupAddress
                                        : vehicle?.pickupAreaLabel || "Area shared at confirmation"}
                                </p>
                                {vehicle?.contactUnlocked &&
                                    vehicle?.pickupContactPhone && (
                                        <p className="text-xs font-semibold text-slate-600">
                                            {vehicle.pickupContactName} ·{" "}
                                            {vehicle.pickupContactPhone}
                                        </p>
                                    )}
                            </div>
                        </section>

                        <section className="rounded-[24px] bg-white p-5 shadow-sm">
                            <h2 className="flex items-center gap-2 text-sm font-extrabold">
                                <Banknote size={17} className="text-[#087F5B]" />
                                Amounts
                            </h2>
                            <div className="mt-3 space-y-2 text-sm">
                                <Row label="Rental charges — your money" value={money(booking.rentalCharges)} strong />
                                <Row
                                    label={`Booking fee — Safar's platform fee (${booking.bookingFeePercent ?? 0}%)`}
                                    value={money(booking.bookingFee)}
                                />
                                <Row label="Security deposit — refundable" value={money(booking.securityDeposit)} />
                                <Row
                                    label="Rate"
                                    value={`${money(booking.ratePerUnit)} × ${booking.units} ${String(booking.billingUnit || "").toLowerCase()}`}
                                />
                            </div>
                            <div className="mt-3 rounded-xl bg-slate-50 p-3 text-xs leading-5 text-slate-600">
                                <p className="font-bold">
                                    Booking fee payment:{" "}
                                    {feeStatus === "VERIFIED"
                                        ? "Verified by Safar"
                                        : feeStatus === "SUBMITTED"
                                          ? "Submitted — awaiting admin verification"
                                          : feeStatus === "REJECTED"
                                            ? "Rejected — the customer must resubmit proof"
                                            : "Not submitted yet"}
                                </p>
                                {feeStatus === "SUBMITTED" && (
                                    <p className="mt-1 flex items-start gap-1.5">
                                        <Hourglass size={13} className="mt-0.5 shrink-0" />
                                        Nothing for you to do — Safar verifies the
                                        transfer, then the booking confirms.
                                    </p>
                                )}
                                <p className="mt-1">
                                    The booking fee is Safar&apos;s — never
                                    collect it from the customer yourself. The
                                    deposit is collected at handover and
                                    returned at the end of a clean rental.
                                </p>
                            </div>
                            {booking.returnDues?.remainingDues != null && (
                                <div className="mt-3 rounded-xl bg-amber-50 p-3 text-xs leading-5 text-amber-800">
                                    <p className="font-bold">
                                        Return dues: {money(booking.returnDues.remainingDues)}
                                    </p>
                                    <p>
                                        Driven {booking.returnDues.drivenKm ?? "—"} km
                                        {booking.returnDues.extraKmCharges
                                            ? ` · Extra km ${money(booking.returnDues.extraKmCharges)}`
                                            : ""}
                                        {booking.returnDues.overtimeCharges
                                            ? ` · Overtime ${money(booking.returnDues.overtimeCharges)}`
                                            : ""}
                                        {booking.returnDues.otherDues
                                            ? ` · Other ${money(booking.returnDues.otherDues)}`
                                            : ""}
                                    </p>
                                </div>
                            )}
                        </section>

                        {(booking.handover?.recordedAt ||
                            booking.returnInspection?.recordedAt) && (
                            <section className="rounded-[24px] bg-white p-5 shadow-sm">
                                <h2 className="text-sm font-extrabold">
                                    Inspection record
                                </h2>
                                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                                    {booking.handover?.recordedAt && (
                                        <InspectionCard title="Handover (pickup)" inspection={booking.handover} />
                                    )}
                                    {booking.returnInspection?.recordedAt && (
                                        <InspectionCard title="Return" inspection={booking.returnInspection} />
                                    )}
                                </div>
                            </section>
                        )}

                        {status === "REQUESTED" && (
                            <section className="rounded-[24px] bg-white p-5 shadow-sm">
                                <h2 className="text-base font-extrabold">
                                    New booking request
                                </h2>
                                <p className="mt-1 text-sm leading-6 text-slate-500">
                                    Accepting holds the vehicle for this window
                                    and asks the customer to pay the Safar
                                    booking fee. The booking confirms once
                                    Safar verifies that payment.
                                </p>
                                {!rejectOpen ? (
                                    <div className="mt-4 flex gap-2">
                                        <button
                                            type="button"
                                            disabled={Boolean(busy)}
                                            onClick={() =>
                                                void run(
                                                    "accept",
                                                    () => acceptRentalBooking(bookingId, token),
                                                    "Booking accepted."
                                                )
                                            }
                                            className="flex h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-[#087F5B] font-bold text-white disabled:opacity-40"
                                        >
                                            <CheckCircle2 size={18} />
                                            {busy === "accept" ? "Accepting…" : "Accept booking"}
                                        </button>
                                        <button
                                            type="button"
                                            disabled={Boolean(busy)}
                                            onClick={() => setRejectOpen(true)}
                                            className="flex h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-red-50 font-bold text-red-600 disabled:opacity-40"
                                        >
                                            <XCircle size={18} /> Reject
                                        </button>
                                    </div>
                                ) : (
                                    <div className="mt-4 space-y-2">
                                        <input
                                            type="text"
                                            value={rejectReason}
                                            onChange={(e) => setRejectReason(e.target.value)}
                                            placeholder="Reason — e.g. vehicle in workshop that week"
                                            className="h-12 w-full rounded-xl border px-4 text-sm font-semibold"
                                        />
                                        <div className="flex gap-2">
                                            <button
                                                type="button"
                                                disabled={Boolean(busy) || !rejectReason.trim()}
                                                onClick={() =>
                                                    void run(
                                                        "reject",
                                                        () =>
                                                            rejectRentalBooking(
                                                                bookingId,
                                                                rejectReason.trim(),
                                                                token
                                                            ),
                                                        "Booking rejected."
                                                    )
                                                }
                                                className="flex h-12 flex-1 items-center justify-center rounded-xl bg-red-500 font-bold text-white disabled:opacity-40"
                                            >
                                                {busy === "reject" ? "Rejecting…" : "Confirm reject"}
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => setRejectOpen(false)}
                                                className="h-12 rounded-xl bg-slate-100 px-4 text-sm font-bold text-slate-600"
                                            >
                                                Back
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </section>
                        )}

                        {(status === "PROVIDER_ACCEPTED" ||
                            status === "PAYMENT_PENDING") && (
                            <section className="rounded-[24px] bg-blue-50 p-5 shadow-sm">
                                <p className="flex items-start gap-2 text-sm font-semibold leading-6 text-blue-800">
                                    <Hourglass size={18} className="mt-0.5 shrink-0" />
                                    Waiting on the booking fee. The booking
                                    confirms automatically once Safar verifies
                                    the customer&apos;s payment — keep the
                                    vehicle free for this window.
                                </p>
                            </section>
                        )}

                        {status === "CONFIRMED" && (
                            <section className="rounded-[24px] bg-white p-5 shadow-sm">
                                <h2 className="text-base font-extrabold">
                                    Verify the pickup
                                </h2>
                                <p className="mt-1 text-sm leading-6 text-slate-500">
                                    Collect the refundable deposit of{" "}
                                    <strong>{money(booking.securityDeposit)}</strong>,
                                    ask the customer for their pickup OTP, and
                                    record the car&apos;s condition before
                                    handing over the keys.
                                </p>
                                <div className="mt-3 space-y-3">
                                    <input
                                        type="text"
                                        inputMode="numeric"
                                        maxLength={6}
                                        value={otp}
                                        onChange={(e) =>
                                            setOtp(e.target.value.replace(/\D/g, ""))
                                        }
                                        placeholder="Pickup OTP from customer"
                                        className="h-12 w-full rounded-xl border px-4 text-center text-lg font-extrabold tracking-[0.3em]"
                                    />
                                    <InspectionForm
                                        form={handover}
                                        setForm={setHandover}
                                        uploading={uploading === "handover"}
                                        onUpload={(files) => void uploadPhotos("handover", files)}
                                    />
                                    <button
                                        type="button"
                                        disabled={
                                            Boolean(busy) ||
                                            otp.length !== 6 ||
                                            handover.photoUrls.length === 0 ||
                                            handover.fuelLevelPercent === "" ||
                                            handover.odometerKm === ""
                                        }
                                        onClick={() =>
                                            void run(
                                                "pickup",
                                                () =>
                                                    verifyRentalPickup(
                                                        bookingId,
                                                        {
                                                            otp,
                                                            handover: {
                                                                fuelLevelPercent: Number(handover.fuelLevelPercent),
                                                                odometerKm: Number(handover.odometerKm),
                                                                photoUrls: handover.photoUrls,
                                                                notes: handover.notes,
                                                            },
                                                        },
                                                        token
                                                    ),
                                                "Pickup verified — you can start the rental."
                                            )
                                        }
                                        className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#087F5B] font-bold text-white disabled:opacity-40"
                                    >
                                        <CheckCircle2 size={18} />
                                        {busy === "pickup" ? "Verifying…" : "Verify pickup & record handover"}
                                    </button>
                                    {handover.photoUrls.length === 0 && (
                                        <p className="text-center text-[11px] font-semibold text-slate-400">
                                            At least one handover photo is required.
                                        </p>
                                    )}
                                </div>
                            </section>
                        )}

                        {status === "PICKUP_VERIFIED" && (
                            <section className="rounded-[24px] bg-white p-5 shadow-sm">
                                <h2 className="text-base font-extrabold">
                                    Handover recorded
                                </h2>
                                <p className="mt-1 text-sm text-slate-500">
                                    Start the rental clock when the customer
                                    drives away.
                                </p>
                                <button
                                    type="button"
                                    disabled={Boolean(busy)}
                                    onClick={() =>
                                        void run(
                                            "start",
                                            () => startRental(bookingId, token),
                                            "Rental started. Drive safe!"
                                        )
                                    }
                                    className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#087F5B] font-bold text-white disabled:opacity-40"
                                >
                                    <Play size={18} />
                                    {busy === "start" ? "Starting…" : "Start rental"}
                                </button>
                            </section>
                        )}

                        {status === "RENTAL_ACTIVE" && (
                            <section className="rounded-[24px] bg-white p-5 shadow-sm">
                                <h2 className="flex items-center gap-2 text-base font-extrabold">
                                    <Undo2 size={18} className="text-[#087F5B]" />
                                    Record the return
                                </h2>
                                <p className="mt-1 text-sm leading-6 text-slate-500">
                                    Inspect the car with the customer, record
                                    fuel and odometer, and add any other dues
                                    (damage, fines). Safar works out extra-km
                                    and overtime charges from the two
                                    inspections.
                                </p>
                                <div className="mt-3 space-y-3">
                                    <InspectionForm
                                        form={returnForm}
                                        setForm={setReturnForm}
                                        uploading={uploading === "return"}
                                        onUpload={(files) => void uploadPhotos("return", files)}
                                    />
                                    <label className="block">
                                        <span className="text-xs font-semibold text-slate-500">
                                            Other dues (PKR) — damage, fines, cleaning
                                        </span>
                                        <input
                                            type="number"
                                            min="0"
                                            step="1"
                                            inputMode="numeric"
                                            value={returnForm.otherDues}
                                            onChange={(e) =>
                                                setReturnForm((prev) => ({
                                                    ...prev,
                                                    otherDues: e.target.value,
                                                }))
                                            }
                                            placeholder="0"
                                            className="mt-1 h-12 w-full rounded-xl border px-4 text-sm font-semibold"
                                        />
                                    </label>
                                    <button
                                        type="button"
                                        disabled={
                                            Boolean(busy) ||
                                            returnForm.photoUrls.length === 0 ||
                                            returnForm.fuelLevelPercent === "" ||
                                            returnForm.odometerKm === ""
                                        }
                                        onClick={() =>
                                            void run(
                                                "return",
                                                () =>
                                                    submitRentalReturn(
                                                        bookingId,
                                                        {
                                                            inspection: {
                                                                fuelLevelPercent: Number(returnForm.fuelLevelPercent),
                                                                odometerKm: Number(returnForm.odometerKm),
                                                                photoUrls: returnForm.photoUrls,
                                                                notes: returnForm.notes,
                                                            },
                                                            otherDues:
                                                                returnForm.otherDues === ""
                                                                    ? 0
                                                                    : Number(returnForm.otherDues),
                                                        },
                                                        token
                                                    ),
                                                "Return recorded — waiting for the customer to confirm."
                                            )
                                        }
                                        className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#087F5B] font-bold text-white disabled:opacity-40"
                                    >
                                        <Undo2 size={17} />
                                        {busy === "return" ? "Saving…" : "Submit return inspection"}
                                    </button>
                                    {returnForm.photoUrls.length === 0 && (
                                        <p className="text-center text-[11px] font-semibold text-slate-400">
                                            At least one return photo is required.
                                        </p>
                                    )}
                                </div>
                            </section>
                        )}

                        {status === "RETURN_PENDING" && (
                            <section className="rounded-[24px] bg-amber-50 p-5 shadow-sm">
                                <p className="flex items-start gap-2 text-sm font-semibold leading-6 text-amber-800">
                                    <Hourglass size={18} className="mt-0.5 shrink-0" />
                                    Return submitted — waiting for the customer
                                    to confirm the inspection and settle any
                                    remaining dues
                                    {booking.returnDues?.remainingDues != null
                                        ? ` (${money(booking.returnDues.remainingDues)})`
                                        : ""}
                                    . Refund the deposit once everything is
                                    settled.
                                </p>
                            </section>
                        )}

                        {status === "COMPLETED" && (
                            <section className="rounded-[24px] bg-emerald-50 p-5 text-center shadow-sm">
                                <CheckCircle2 size={34} className="mx-auto text-[#087F5B]" />
                                <p className="mt-2 font-extrabold text-[#087F5B]">
                                    Rental complete
                                </p>
                                <p className="mt-1 text-sm text-slate-600">
                                    You earned {money(booking.rentalCharges)} on
                                    this booking.
                                </p>
                            </section>
                        )}

                        {(status === "CANCELLED" ||
                            status === "NO_SHOW" ||
                            status === "DISPUTED") && (
                            <section className="rounded-[24px] bg-white p-5 shadow-sm">
                                <p className="text-sm font-semibold leading-6 text-slate-600">
                                    This booking is {meta.label.toLowerCase()}.
                                    {booking.cancelReason
                                        ? ` Reason: ${booking.cancelReason}`
                                        : ""}{" "}
                                    No further action is available here.
                                </p>
                            </section>
                        )}
                    </>
                ) : null}
            </div>

            {chatOpen && booking && (
                <OrderChat
                    orderType="RENTAL"
                    orderId={booking._id}
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

function Row({ label, value, strong = false }) {
    return (
        <div className="flex items-center justify-between gap-3">
            <span className="text-slate-500">{label}</span>
            <span className={strong ? "font-extrabold text-[#087F5B]" : "font-bold"}>
                {value}
            </span>
        </div>
    );
}

function InspectionCard({ title, inspection }) {
    return (
        <div className="rounded-2xl bg-slate-50 p-3.5">
            <p className="text-xs font-extrabold uppercase tracking-wider text-slate-500">
                {title}
            </p>
            <p className="mt-2 flex items-center gap-1.5 text-sm font-bold">
                <Fuel size={15} className="text-[#087F5B]" />
                {inspection.fuelLevelPercent}% fuel
            </p>
            <p className="mt-1 flex items-center gap-1.5 text-sm font-bold">
                <Gauge size={15} className="text-[#087F5B]" />
                {Number(inspection.odometerKm ?? 0).toLocaleString("en-PK")} km
            </p>
            {inspection.notes && (
                <p className="mt-1.5 text-xs leading-5 text-slate-500">
                    {inspection.notes}
                </p>
            )}
            {(inspection.photoUrls || []).length > 0 && (
                <div className="mt-2 flex gap-1.5 overflow-x-auto">
                    {inspection.photoUrls.map((url) => (
                        <Image
                            key={url}
                            src={url}
                            alt={title}
                            width={52}
                            height={52}
                            unoptimized
                            className="h-[52px] w-[52px] shrink-0 rounded-lg object-cover"
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

function InspectionForm({ form, setForm, uploading, onUpload }) {
    const set = (field, value) =>
        setForm((prev) => ({ ...prev, [field]: value }));
    return (
        <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
                <label className="block">
                    <span className="flex items-center gap-1 text-xs font-semibold text-slate-500">
                        <Fuel size={12} /> Fuel level %
                    </span>
                    <input
                        type="number"
                        min="0"
                        max="100"
                        step="1"
                        inputMode="numeric"
                        value={form.fuelLevelPercent}
                        onChange={(e) => set("fuelLevelPercent", e.target.value)}
                        placeholder="0–100"
                        className="mt-1 h-12 w-full rounded-xl border px-3 text-sm font-semibold"
                    />
                </label>
                <label className="block">
                    <span className="flex items-center gap-1 text-xs font-semibold text-slate-500">
                        <Gauge size={12} /> Odometer (km)
                    </span>
                    <input
                        type="number"
                        min="0"
                        step="1"
                        inputMode="numeric"
                        value={form.odometerKm}
                        onChange={(e) => set("odometerKm", e.target.value)}
                        placeholder="e.g. 45210"
                        className="mt-1 h-12 w-full rounded-xl border px-3 text-sm font-semibold"
                    />
                </label>
            </div>
            <label className="block cursor-pointer rounded-xl border-2 border-dashed border-emerald-200 bg-emerald-50/40 p-3 text-center">
                <Camera size={20} className="mx-auto text-[#087F5B]" />
                <span className="mt-1 block text-xs font-semibold">
                    {uploading
                        ? "Uploading photos…"
                        : form.photoUrls.length
                          ? `${form.photoUrls.length} photo(s) added — tap to add more`
                          : "Add inspection photos (at least 1)"}
                </span>
                <input
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                        onUpload(e.target.files);
                        e.target.value = "";
                    }}
                />
            </label>
            {form.photoUrls.length > 0 && (
                <div className="flex gap-2 overflow-x-auto">
                    {form.photoUrls.map((url) => (
                        <span key={url} className="relative shrink-0">
                            <Image
                                src={url}
                                alt="Inspection"
                                width={56}
                                height={56}
                                unoptimized
                                className="h-14 w-14 rounded-xl object-cover"
                            />
                            <button
                                type="button"
                                aria-label="Remove photo"
                                onClick={() =>
                                    setForm((prev) => ({
                                        ...prev,
                                        photoUrls: prev.photoUrls.filter(
                                            (u) => u !== url
                                        ),
                                    }))
                                }
                                className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-slate-900 text-white"
                            >
                                <X size={11} />
                            </button>
                        </span>
                    ))}
                </div>
            )}
            <input
                type="text"
                value={form.notes}
                onChange={(e) => set("notes", e.target.value)}
                placeholder="Notes — scratches, dents, accessories (optional)"
                className="h-12 w-full rounded-xl border px-4 text-sm font-semibold"
            />
        </div>
    );
}
