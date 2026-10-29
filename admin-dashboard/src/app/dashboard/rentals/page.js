"use client";

import { useCallback, useEffect, useState } from "react";
import {
    RefreshCw, ShieldCheck, AlertCircle,
    CheckCircle2, XCircle, Eye,
} from "lucide-react";
import AdminShell from "@/components/AdminShell";
import { authenticatedAdminRequest } from "@/lib/adminSession";

const TABS = [
    { id: "payments", label: "Fee Payment Queue" },
    { id: "bookings", label: "Bookings" },
    { id: "listings", label: "Listings" },
    { id: "partners", label: "Partners" },
    { id: "reports", label: "Reports" },
    { id: "settings", label: "Settings" },
];

const BOOKING_STATUSES = [
    "REQUESTED", "PROVIDER_ACCEPTED", "PAYMENT_PENDING", "CONFIRMED",
    "PICKUP_VERIFIED", "RENTAL_ACTIVE", "RETURN_PENDING", "COMPLETED",
    "CANCELLED", "NO_SHOW", "DISPUTED",
];

const LISTING_STATUSES = ["PENDING", "APPROVED", "REJECTED", "SUSPENDED"];

const STATUS_CLASSES = {
    REQUESTED: "bg-amber-50 text-amber-700",
    PROVIDER_ACCEPTED: "bg-sky-50 text-sky-700",
    PAYMENT_PENDING: "bg-amber-50 text-amber-700",
    CONFIRMED: "bg-sky-50 text-sky-700",
    PICKUP_VERIFIED: "bg-sky-50 text-sky-700",
    RENTAL_ACTIVE: "bg-sky-50 text-sky-700",
    RETURN_PENDING: "bg-sky-50 text-sky-700",
    COMPLETED: "bg-emerald-50 text-[#087F5B]",
    CANCELLED: "bg-slate-100 text-slate-600",
    NO_SHOW: "bg-slate-100 text-slate-600",
    DISPUTED: "bg-red-50 text-red-600",
    PENDING: "bg-amber-50 text-amber-700",
    UNDER_REVIEW: "bg-amber-50 text-amber-700",
    APPROVED: "bg-emerald-50 text-[#087F5B]",
    REJECTED: "bg-red-50 text-red-600",
    SUSPENDED: "bg-red-50 text-red-600",
};

const money = (amount) =>
    amount == null ? "—" : `PKR ${Number(amount).toLocaleString("en-PK")}`;

const pretty = (value) => String(value || "").replaceAll("_", " ");

const when = (value) =>
    value ? new Date(value).toLocaleString("en-PK") : "—";

function StatusChip({ status }) {
    return (
        <span className={`rounded-lg px-2.5 py-1 text-[11px] font-bold ${STATUS_CLASSES[status] || "bg-slate-100 text-slate-600"}`}>
            {pretty(status)}
        </span>
    );
}

export default function RentalsAdminPage() {
    const [tab, setTab] = useState("payments");
    const [error, setError] = useState("");
    const [message, setMessage] = useState("");

    return (
        <AdminShell title="Rentals">
            <div className="space-y-5">
                <div className="rounded-2xl bg-white p-6 shadow-sm">
                    <h2 className="text-2xl font-extrabold">Rental Operations</h2>
                    <p className="mt-2 text-sm text-slate-500">
                        Booking-fee verification is the only route to a CONFIRMED booking —
                        verify the manual bank transfer against the platform account before approving.
                    </p>

                    <div className="mt-4 flex flex-wrap gap-2">
                        {TABS.map(({ id, label }) => (
                            <button
                                key={id}
                                type="button"
                                onClick={() => {
                                    setTab(id);
                                    setError("");
                                    setMessage("");
                                }}
                                className={`rounded-xl px-4 py-2.5 text-sm font-bold ${tab === id
                                    ? "bg-[#087F5B] text-white"
                                    : "bg-slate-100 text-slate-600"
                                    }`}
                            >
                                {label}
                            </button>
                        ))}
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

                {tab === "payments" && (
                    <PaymentsTab setError={setError} setMessage={setMessage} />
                )}
                {tab === "bookings" && (
                    <BookingsTab setError={setError} setMessage={setMessage} />
                )}
                {tab === "listings" && (
                    <ListingsTab setError={setError} setMessage={setMessage} />
                )}
                {tab === "partners" && (
                    <PartnersTab setError={setError} setMessage={setMessage} />
                )}
                {tab === "reports" && <ReportsTab setError={setError} />}
                {tab === "settings" && (
                    <SettingsTab setError={setError} setMessage={setMessage} />
                )}
            </div>
        </AdminShell>
    );
}

// ---------------------------------------------------------------------
// Manual booking-fee verification queue
// ---------------------------------------------------------------------

function PaymentsTab({ setError, setMessage }) {
    const [payments, setPayments] = useState([]);
    const [loading, setLoading] = useState(true);
    const [busyId, setBusyId] = useState("");
    const [rejectReasons, setRejectReasons] = useState({});

    const load = useCallback(async () => {
        setLoading(true);
        setError("");
        try {
            const data = await authenticatedAdminRequest(
                "/admin/rentals/payments/pending"
            );
            setPayments(data.payments || []);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, [setError]);

    useEffect(() => {
        void (async () => {
            await Promise.resolve();
            await load();
        })();
    }, [load]);

    async function verify(payment) {
        if (!window.confirm(
            `Verify that the booking fee of ${money(payment.bookingFee)} for ${payment.bookingRef} was received in the platform bank account? This CONFIRMS the booking.`
        )) return;

        setBusyId(payment.bookingId);
        setError("");
        setMessage("");
        try {
            await authenticatedAdminRequest(
                `/admin/rentals/bookings/${payment.bookingId}/verify-payment`,
                { method: "POST", body: JSON.stringify({}) }
            );
            setMessage(`Booking ${payment.bookingRef} confirmed.`);
            await load();
        } catch (err) {
            setError(err.message);
        } finally {
            setBusyId("");
        }
    }

    async function reject(payment) {
        const reason = (rejectReasons[payment.bookingId] || "").trim();
        if (!reason) {
            setError("A rejection reason is required — the passenger sees it and can resubmit.");
            return;
        }

        setBusyId(payment.bookingId);
        setError("");
        setMessage("");
        try {
            await authenticatedAdminRequest(
                `/admin/rentals/bookings/${payment.bookingId}/reject-payment`,
                { method: "POST", body: JSON.stringify({ reason }) }
            );
            setMessage(`Proof rejected for ${payment.bookingRef}; the booking stays open for resubmission.`);
            await load();
        } catch (err) {
            setError(err.message);
        } finally {
            setBusyId("");
        }
    }

    return (
        <section className="rounded-2xl bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between gap-3">
                <h3 className="text-lg font-extrabold">Awaiting verification</h3>
                <button
                    type="button"
                    onClick={load}
                    disabled={loading}
                    className="flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold disabled:opacity-50"
                >
                    <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
                    Refresh
                </button>
            </div>

            {loading ? (
                <p className="py-8 text-sm text-slate-500">Loading…</p>
            ) : payments.length === 0 ? (
                <p className="py-8 text-sm text-slate-500">
                    No fee payments are awaiting verification.
                </p>
            ) : (
                <div className="mt-4 space-y-4">
                    {payments.map((payment) => (
                        <article key={payment.bookingId} className="rounded-xl border border-slate-200 p-4">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                                <div>
                                    <p className="text-sm font-bold">
                                        Booking {payment.bookingRef}
                                    </p>
                                    <p className="mt-1 text-xs text-slate-500">
                                        Submitted {when(payment.feePayment?.submittedAt)} ·
                                        payment deadline {when(payment.paymentDeadlineAt)}
                                    </p>
                                    <p className="mt-1 text-xs text-slate-500">
                                        Reference: {payment.feePayment?.reference || "—"} ·
                                        sender: {payment.feePayment?.senderAccountTitle || "—"}
                                    </p>
                                    {payment.feePayment?.proofImageUrl && (
                                        <a
                                            href={payment.feePayment.proofImageUrl}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="mt-1 inline-block text-xs font-bold text-[#087F5B] underline"
                                        >
                                            View payment proof
                                        </a>
                                    )}
                                </div>
                                <div className="text-right">
                                    <p className="text-lg font-extrabold">{money(payment.bookingFee)}</p>
                                    <p className="text-xs text-slate-500">
                                        booking fee · rental charges {money(payment.rentalCharges)}
                                    </p>
                                </div>
                            </div>

                            <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto_auto]">
                                <input
                                    type="text"
                                    maxLength={500}
                                    value={rejectReasons[payment.bookingId] || ""}
                                    onChange={(e) =>
                                        setRejectReasons((prev) => ({
                                            ...prev,
                                            [payment.bookingId]: e.target.value,
                                        }))
                                    }
                                    placeholder="Rejection reason (only needed to reject)"
                                    className="rounded-xl border p-3 text-sm"
                                />
                                <button
                                    type="button"
                                    disabled={Boolean(busyId)}
                                    onClick={() => reject(payment)}
                                    className="flex items-center justify-center gap-2 rounded-xl border border-red-200 px-4 py-3 text-sm font-bold text-red-600 disabled:opacity-50"
                                >
                                    <XCircle size={16} />
                                    Reject proof
                                </button>
                                <button
                                    type="button"
                                    disabled={Boolean(busyId)}
                                    onClick={() => verify(payment)}
                                    className="flex items-center justify-center gap-2 rounded-xl bg-[#087F5B] px-4 py-3 text-sm font-bold text-white disabled:opacity-50"
                                >
                                    <ShieldCheck size={16} />
                                    {busyId === payment.bookingId ? "Processing…" : "Verify & confirm booking"}
                                </button>
                            </div>
                        </article>
                    ))}
                </div>
            )}
        </section>
    );
}

// ---------------------------------------------------------------------
// Bookings + detail (events, inspections, disputes, refunds)
// ---------------------------------------------------------------------

function BookingsTab({ setError, setMessage }) {
    const [bookings, setBookings] = useState([]);
    const [status, setStatus] = useState("ALL");
    const [loading, setLoading] = useState(true);
    const [detail, setDetail] = useState(null);
    const [detailLoading, setDetailLoading] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        setError("");
        try {
            const params = new URLSearchParams();
            if (status !== "ALL") params.set("status", status);
            const data = await authenticatedAdminRequest(
                `/admin/rentals/bookings?${params}`
            );
            setBookings(data.bookings || []);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, [status, setError]);

    useEffect(() => {
        void (async () => {
            await Promise.resolve();
            await load();
        })();
    }, [load]);

    async function openBooking(booking) {
        setDetailLoading(true);
        setError("");
        try {
            const data = await authenticatedAdminRequest(
                `/admin/rentals/bookings/${booking.id || booking._id}`
            );
            setDetail(data);
        } catch (err) {
            setError(err.message);
        } finally {
            setDetailLoading(false);
        }
    }

    return (
        <section className="rounded-2xl bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="text-lg font-extrabold">Bookings</h3>
                <div className="flex items-center gap-3">
                    <select
                        value={status}
                        onChange={(e) => setStatus(e.target.value)}
                        className="rounded-xl border p-2.5 text-sm"
                    >
                        <option value="ALL">All statuses</option>
                        {BOOKING_STATUSES.map((value) => (
                            <option key={value} value={value}>{pretty(value)}</option>
                        ))}
                    </select>
                    <button
                        type="button"
                        onClick={load}
                        disabled={loading}
                        className="flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold disabled:opacity-50"
                    >
                        <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
                        Refresh
                    </button>
                </div>
            </div>

            <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[760px] text-left text-sm">
                    <thead>
                        <tr className="border-b text-xs uppercase tracking-wide text-slate-400">
                            <th className="px-3 py-3 font-bold">Ref</th>
                            <th className="px-3 py-3 font-bold">Window</th>
                            <th className="px-3 py-3 font-bold">Charges</th>
                            <th className="px-3 py-3 font-bold">Fee</th>
                            <th className="px-3 py-3 font-bold">Deposit</th>
                            <th className="px-3 py-3 font-bold">Status</th>
                            <th className="px-3 py-3 font-bold">Action</th>
                        </tr>
                    </thead>
                    <tbody>
                        {bookings.map((booking) => (
                            <tr key={booking.id || booking._id} className="border-b last:border-0">
                                <td className="px-3 py-3 font-bold">{booking.bookingRef}</td>
                                <td className="whitespace-nowrap px-3 py-3 text-slate-500">
                                    {when(booking.startAt)} → {when(booking.endAt)}
                                </td>
                                <td className="px-3 py-3">{money(booking.rentalCharges)}</td>
                                <td className="px-3 py-3">{money(booking.bookingFee)}</td>
                                <td className="px-3 py-3">{money(booking.securityDeposit)}</td>
                                <td className="px-3 py-3"><StatusChip status={booking.status} /></td>
                                <td className="px-3 py-3">
                                    <button
                                        type="button"
                                        onClick={() => openBooking(booking)}
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
                {!loading && bookings.length === 0 && (
                    <p className="p-4 text-slate-500">No bookings found.</p>
                )}
                {loading && <p className="p-4 text-slate-500">Loading bookings…</p>}
            </div>

            {(detail || detailLoading) && (
                <BookingDetailModal
                    key={detail?.booking?._id || "loading"}
                    detail={detail}
                    loading={detailLoading}
                    onClose={() => setDetail(null)}
                    setError={setError}
                    setMessage={setMessage}
                    onChanged={async () => {
                        await load();
                        const id = detail?.booking?._id;
                        if (id) {
                            const data = await authenticatedAdminRequest(
                                `/admin/rentals/bookings/${id}`
                            );
                            setDetail(data);
                        }
                    }}
                />
            )}
        </section>
    );
}

function InspectionBlock({ title, inspection }) {
    if (!inspection?.recordedAt) {
        return (
            <div>
                <h5 className="text-xs font-extrabold uppercase tracking-wide text-slate-400">{title}</h5>
                <p className="mt-1 text-sm text-slate-500">Not recorded.</p>
            </div>
        );
    }

    return (
        <div>
            <h5 className="text-xs font-extrabold uppercase tracking-wide text-slate-400">{title}</h5>
            <p className="mt-1 text-sm">
                {when(inspection.recordedAt)} · fuel {inspection.fuelLevelPercent ?? "—"}% ·
                odometer {inspection.odometerKm ?? "—"} km
                {inspection.notes ? ` · ${inspection.notes}` : ""}
            </p>
            {inspection.photoUrls?.length > 0 && (
                <p className="mt-1 text-sm">
                    Photos:{" "}
                    {inspection.photoUrls.map((url, i) => (
                        <a key={url} href={url} target="_blank" rel="noreferrer" className="font-bold text-[#087F5B] underline">
                            {i + 1}{" "}
                        </a>
                    ))}
                </p>
            )}
        </div>
    );
}

function BookingDetailModal({ detail, loading, onClose, setError, setMessage, onChanged }) {
    const [outcome, setOutcome] = useState("COMPLETED");
    const [fault, setFault] = useState("NONE");
    const [note, setNote] = useState("");
    const [busy, setBusy] = useState(false);
    const [localError, setLocalError] = useState("");

    const booking = detail?.booking;

    // State starts fresh for every booking: the parent mounts this
    // component with key={booking id}, so no reset effect is needed.

    if (!booking) {
        return (
            <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-6" role="dialog" aria-modal="true">
                <div className="rounded-3xl bg-white p-8 text-sm text-slate-500 shadow-xl">
                    {loading ? "Loading booking…" : "Booking unavailable."}
                    <button type="button" onClick={onClose} className="ml-4 rounded-xl border px-4 py-2 font-bold text-slate-700">
                        Close
                    </button>
                </div>
            </div>
        );
    }

    async function resolveDispute() {
        if (!note.trim()) {
            setLocalError("A resolution note is required.");
            return;
        }
        if (!window.confirm(`Resolve this dispute as ${outcome}?`)) return;

        setBusy(true);
        setLocalError("");
        try {
            await authenticatedAdminRequest(
                `/admin/rentals/bookings/${booking._id}/resolve-dispute`,
                {
                    method: "POST",
                    body: JSON.stringify({ outcome, fault, note: note.trim() }),
                }
            );
            setMessage(`Dispute on ${booking.bookingRef} resolved as ${pretty(outcome)}.`);
            await onChanged();
        } catch (err) {
            setLocalError(err.message);
        } finally {
            setBusy(false);
        }
    }

    async function markRefunded() {
        if (!window.confirm("Confirm the booking-fee refund has actually been transferred back to the passenger?")) return;

        setBusy(true);
        setLocalError("");
        try {
            await authenticatedAdminRequest(
                `/admin/rentals/bookings/${booking._id}/mark-refunded`,
                { method: "POST", body: JSON.stringify({}) }
            );
            setMessage(`Fee refund marked as paid for ${booking.bookingRef}.`);
            await onChanged();
        } catch (err) {
            setLocalError(err.message);
        } finally {
            setBusy(false);
        }
    }

    return (
        <div
            className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-6"
            role="dialog"
            aria-modal="true"
            aria-label="Rental booking details"
            onClick={onClose}
        >
            <div
                className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-t-3xl bg-white p-6 shadow-xl sm:rounded-3xl"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-start justify-between gap-3">
                    <div>
                        <h3 className="text-xl font-extrabold">Booking {booking.bookingRef}</h3>
                        <p className="mt-1 text-sm text-slate-500">
                            {when(booking.startAt)} → {when(booking.endAt)} · {pretty(booking.mode || "")}
                        </p>
                    </div>
                    <StatusChip status={booking.status} />
                </div>

                {localError && (
                    <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-600">
                        {localError}
                    </p>
                )}

                <div className="mt-5 grid gap-5 lg:grid-cols-2">
                    <section>
                        <h4 className="text-sm font-extrabold uppercase tracking-wide text-slate-400">Amounts (always separate)</h4>
                        <dl className="mt-2 divide-y rounded-xl border text-sm">
                            {[
                                ["Rental charges", money(booking.rentalCharges)],
                                ["Booking fee (platform)", money(booking.bookingFee)],
                                ["Security deposit", money(booking.securityDeposit)],
                                ["Fee payment", `${pretty(booking.feePayment?.status || "—")}${booking.feePayment?.reference ? ` · ${booking.feePayment.reference}` : ""}`],
                                ["Fee refund", `${pretty(booking.feeRefund?.status || "NONE")}${booking.feeRefund?.amount ? ` · ${money(booking.feeRefund.amount)}` : ""}`],
                                ["Return dues remaining", money(booking.returnDues?.remainingDues)],
                            ].map(([label, value]) => (
                                <div key={label} className="flex items-center justify-between px-3 py-2">
                                    <dt className="text-slate-500">{label}</dt>
                                    <dd className="font-bold">{value}</dd>
                                </div>
                            ))}
                        </dl>

                        {booking.feeRefund?.status === "DUE" && booking.status === "CANCELLED" && (
                            <button
                                type="button"
                                onClick={markRefunded}
                                disabled={busy}
                                className="mt-3 flex items-center gap-2 rounded-xl bg-[#087F5B] px-4 py-3 text-sm font-bold text-white disabled:opacity-50"
                            >
                                <CheckCircle2 size={16} />
                                Mark fee refund as paid ({money(booking.feeRefund.amount)})
                            </button>
                        )}
                    </section>

                    <section className="space-y-4">
                        <InspectionBlock title="Handover inspection" inspection={booking.handover} />
                        <InspectionBlock title="Return inspection" inspection={booking.returnInspection} />
                        {booking.exactPickupAddress && (
                            <div>
                                <h5 className="text-xs font-extrabold uppercase tracking-wide text-slate-400">Pickup (admin view)</h5>
                                <p className="mt-1 text-sm">
                                    {booking.exactPickupAddress}
                                    {booking.pickupContactName ? ` · ${booking.pickupContactName}` : ""}
                                    {booking.pickupContactPhone ? ` · ${booking.pickupContactPhone}` : ""}
                                </p>
                            </div>
                        )}
                    </section>
                </div>

                {(booking.disputedBy || booking.disputeResolution?.outcome) && (
                    <section className="mt-6 rounded-2xl border border-red-100 bg-red-50/50 p-4">
                        <h4 className="text-sm font-extrabold uppercase tracking-wide text-red-500">Dispute</h4>
                        {booking.disputedBy && (
                            <p className="mt-2 text-sm">
                                Raised by {pretty(booking.disputedBy)} on {when(booking.disputedAt)}: {booking.disputeReason || "—"}
                            </p>
                        )}
                        {booking.disputeResolution?.outcome ? (
                            <p className="mt-2 text-sm">
                                Resolved as <span className="font-bold">{pretty(booking.disputeResolution.outcome)}</span>
                                {booking.disputeResolution.fault ? ` · fault: ${pretty(booking.disputeResolution.fault)}` : ""} on{" "}
                                {when(booking.disputeResolution.resolvedAt)} — {booking.disputeResolution.note}
                            </p>
                        ) : booking.status === "DISPUTED" ? (
                            <div className="mt-3 grid gap-3 sm:grid-cols-[170px_150px_1fr]">
                                <label className="block">
                                    <span className="mb-1.5 block text-xs font-bold text-slate-500">Outcome</span>
                                    <select
                                        value={outcome}
                                        onChange={(e) => setOutcome(e.target.value)}
                                        className="w-full rounded-xl border p-3 text-sm"
                                    >
                                        <option value="COMPLETED">Completed</option>
                                        <option value="CANCELLED">Cancelled (fee refund per rules)</option>
                                        <option value="NO_SHOW">No show</option>
                                    </select>
                                </label>
                                <label className="block">
                                    <span className="mb-1.5 block text-xs font-bold text-slate-500">Fault</span>
                                    <select
                                        value={fault}
                                        onChange={(e) => setFault(e.target.value)}
                                        className="w-full rounded-xl border p-3 text-sm"
                                    >
                                        <option value="NONE">None / platform</option>
                                        <option value="PARTNER">Partner</option>
                                        <option value="PASSENGER">Passenger</option>
                                    </select>
                                </label>
                                <label className="block">
                                    <span className="mb-1.5 block text-xs font-bold text-slate-500">Resolution note</span>
                                    <input
                                        type="text"
                                        maxLength={500}
                                        value={note}
                                        onChange={(e) => setNote(e.target.value)}
                                        placeholder="What was decided and why"
                                        className="w-full rounded-xl border p-3 text-sm"
                                    />
                                </label>
                                <button
                                    type="button"
                                    onClick={resolveDispute}
                                    disabled={busy}
                                    className="rounded-xl bg-red-600 px-5 py-3 text-sm font-bold text-white disabled:opacity-50 sm:col-span-3"
                                >
                                    {busy ? "Resolving…" : "Resolve dispute"}
                                </button>
                            </div>
                        ) : null}
                    </section>
                )}

                <section className="mt-6">
                    <h4 className="text-sm font-extrabold uppercase tracking-wide text-slate-400">Audit trail</h4>
                    <ol className="mt-2 space-y-1.5 text-sm">
                        {(booking.events || []).map((event, i) => (
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
                        {(booking.events || []).length === 0 && (
                            <li className="text-slate-500">No events recorded.</li>
                        )}
                    </ol>
                </section>

                <div className="mt-6 flex justify-end">
                    <button type="button" onClick={onClose} className="rounded-xl border px-5 py-3 font-bold">
                        Close
                    </button>
                </div>
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------
// Listing moderation
// ---------------------------------------------------------------------

function ListingsTab({ setError, setMessage }) {
    const [vehicles, setVehicles] = useState([]);
    const [status, setStatus] = useState("PENDING");
    const [loading, setLoading] = useState(true);
    const [busyId, setBusyId] = useState("");

    const load = useCallback(async () => {
        setLoading(true);
        setError("");
        try {
            const params = new URLSearchParams();
            if (status !== "ALL") params.set("status", status);
            const data = await authenticatedAdminRequest(
                `/admin/rentals/vehicles?${params}`
            );
            setVehicles(data.vehicles || []);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, [status, setError]);

    useEffect(() => {
        void (async () => {
            await Promise.resolve();
            await load();
        })();
    }, [load]);

    async function moderate(vehicle, nextStatus) {
        let note = "";
        if (nextStatus !== "APPROVED") {
            const entered = window.prompt(`Note for ${nextStatus.toLowerCase()} this listing (optional):`, "");
            if (entered === null) return;
            note = entered.trim();
        } else if (!window.confirm("Approve this listing? The partner must have accepted the provider agreement.")) {
            return;
        }

        setBusyId(vehicle.id);
        setError("");
        setMessage("");
        try {
            await authenticatedAdminRequest(
                `/admin/rentals/vehicles/${vehicle.id}/moderate`,
                {
                    method: "PATCH",
                    body: JSON.stringify({ status: nextStatus, note }),
                }
            );
            setMessage(`Listing ${nextStatus.toLowerCase()}.`);
            await load();
        } catch (err) {
            setError(err.message);
        } finally {
            setBusyId("");
        }
    }

    return (
        <section className="rounded-2xl bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="text-lg font-extrabold">Vehicle listings</h3>
                <div className="flex items-center gap-3">
                    <select
                        value={status}
                        onChange={(e) => setStatus(e.target.value)}
                        className="rounded-xl border p-2.5 text-sm"
                    >
                        <option value="ALL">All statuses</option>
                        {LISTING_STATUSES.map((value) => (
                            <option key={value} value={value}>{pretty(value)}</option>
                        ))}
                    </select>
                    <button
                        type="button"
                        onClick={load}
                        disabled={loading}
                        className="flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold disabled:opacity-50"
                    >
                        <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
                        Refresh
                    </button>
                </div>
            </div>

            {loading ? (
                <p className="py-8 text-sm text-slate-500">Loading…</p>
            ) : vehicles.length === 0 ? (
                <p className="py-8 text-sm text-slate-500">No listings in this state.</p>
            ) : (
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                    {vehicles.map((vehicle) => (
                        <article key={vehicle.id} className="rounded-xl border border-slate-200 p-4">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                                <div>
                                    <p className="font-bold">
                                        {vehicle.brand} {vehicle.model} · {vehicle.year}
                                    </p>
                                    <p className="mt-1 text-xs text-slate-500">
                                        {pretty(vehicle.transmission || "")} · {vehicle.seats ?? "—"} seats ·
                                        AC {vehicle.hasAC ? "yes" : "no"} · modes {(vehicle.rentalModes || []).map(pretty).join(", ") || "—"}
                                    </p>
                                    <p className="mt-1 text-xs text-slate-500">
                                        Daily {money(vehicle.pricing?.daily)} · deposit {money(vehicle.securityDeposit)} ·
                                        policy {pretty(vehicle.cancellationPolicy || "MODERATE")} · area {vehicle.pickupAreaLabel || "—"}
                                    </p>
                                </div>
                                <StatusChip status={vehicle.listingStatus} />
                            </div>

                            {vehicle.photos?.exterior?.[0] && (
                                <a
                                    href={vehicle.photos.exterior[0]}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="mt-2 inline-block text-xs font-bold text-[#087F5B] underline"
                                >
                                    View exterior photo
                                </a>
                            )}

                            <div className="mt-3 flex flex-wrap gap-2">
                                {vehicle.listingStatus !== "APPROVED" && (
                                    <button
                                        type="button"
                                        disabled={Boolean(busyId)}
                                        onClick={() => moderate(vehicle, "APPROVED")}
                                        className="flex items-center gap-1.5 rounded-lg bg-[#087F5B] px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
                                    >
                                        <CheckCircle2 size={14} />
                                        Approve
                                    </button>
                                )}
                                {vehicle.listingStatus !== "REJECTED" && (
                                    <button
                                        type="button"
                                        disabled={Boolean(busyId)}
                                        onClick={() => moderate(vehicle, "REJECTED")}
                                        className="flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-2 text-xs font-bold text-red-600 disabled:opacity-50"
                                    >
                                        <XCircle size={14} />
                                        Reject
                                    </button>
                                )}
                                {vehicle.listingStatus === "APPROVED" && (
                                    <button
                                        type="button"
                                        disabled={Boolean(busyId)}
                                        onClick={() => moderate(vehicle, "SUSPENDED")}
                                        className="flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-2 text-xs font-bold text-red-600 disabled:opacity-50"
                                    >
                                        <XCircle size={14} />
                                        Suspend
                                    </button>
                                )}
                            </div>
                        </article>
                    ))}
                </div>
            )}
        </section>
    );
}

// ---------------------------------------------------------------------
// Reports — fee reconciliation + suspicious cancellations
// ---------------------------------------------------------------------


// ---------------------------------------------------------------------
// Rental Partner approvals — KYC documents + application status.
// Backend: /admin/rental-partners (Phase 2 admin API).
// Chauffeur verification is display-only here: no admin endpoint
// approves it yet, so With-Driver stays gated until that ships.
// ---------------------------------------------------------------------

const PARTNER_DOC_LABELS = {
    CNIC_FRONT: "CNIC front",
    CNIC_BACK: "CNIC back",
    PROFILE_PHOTO: "Profile photo",
    DRIVING_LICENSE: "Driving licence",
    BUSINESS_REGISTRATION: "Business registration",
    AUTHORIZATION_LETTER: "Authorization letter",
    VEHICLE_OWNERSHIP: "Vehicle ownership",
};

function PartnersTab({ setError, setMessage }) {
    const [mode, setMode] = useState("PENDING");
    const [partners, setPartners] = useState([]);
    const [loading, setLoading] = useState(true);
    const [busyId, setBusyId] = useState("");
    const [docsFor, setDocsFor] = useState("");
    const [documents, setDocuments] = useState([]);
    const [docsLoading, setDocsLoading] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        setError("");
        try {
            const data = await authenticatedAdminRequest(
                mode === "PENDING"
                    ? "/admin/rental-partners/pending"
                    : "/admin/rental-partners"
            );
            setPartners(data.rentalPartners || []);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, [mode, setError]);

    useEffect(() => {
        void (async () => {
            await Promise.resolve();
            await load();
        })();
    }, [load]);

    async function setStatus(partner, nextStatus) {
        const body = { status: nextStatus };
        if (nextStatus === "APPROVED") {
            if (!partner.agreementAcceptedAt) {
                if (!window.confirm("This partner has NOT accepted the provider agreement yet. Approve anyway?")) return;
            } else if (!window.confirm(`Approve rental partner "${partner.businessName || "Unnamed"}"?`)) {
                return;
            }
        }
        if (nextStatus === "REJECTED") {
            const reason = window.prompt("Rejection reason (required):", "");
            if (reason === null) return;
            if (!reason.trim()) {
                setError("A rejection reason is required.");
                return;
            }
            body.rejectionReason = reason.trim();
        }
        if (nextStatus === "SUSPENDED") {
            const reason = window.prompt("Suspension reason (optional):", "");
            if (reason === null) return;
            body.suspensionReason = reason.trim();
        }

        setBusyId(partner._id);
        setError("");
        setMessage("");
        try {
            await authenticatedAdminRequest(
                `/admin/rental-partners/${partner._id}/status`,
                { method: "PATCH", body: JSON.stringify(body) }
            );
            setMessage(`Partner ${nextStatus.toLowerCase()}.`);
            await load();
        } catch (err) {
            setError(err.message);
        } finally {
            setBusyId("");
        }
    }

    async function toggleDocuments(partner) {
        if (docsFor === partner._id) {
            setDocsFor("");
            setDocuments([]);
            return;
        }
        setDocsFor(partner._id);
        setDocuments([]);
        setDocsLoading(true);
        setError("");
        try {
            const data = await authenticatedAdminRequest(
                `/admin/rental-partners/${partner._id}/documents`
            );
            setDocuments(data.documents || []);
        } catch (err) {
            setError(err.message);
        } finally {
            setDocsLoading(false);
        }
    }

    async function viewDocument(documentId) {
        setError("");
        try {
            const data = await authenticatedAdminRequest(
                `/admin/rental-partners/documents/${documentId}/view`
            );
            if (data.imageUrl) window.open(data.imageUrl, "_blank", "noopener");
        } catch (err) {
            setError(err.message);
        }
    }

    async function reviewDocument(partner, document, nextStatus) {
        const body = { status: nextStatus };
        if (nextStatus === "REJECTED") {
            const reason = window.prompt("Document rejection reason (required):", "");
            if (reason === null) return;
            if (!reason.trim()) {
                setError("A rejection reason is required.");
                return;
            }
            body.rejectionReason = reason.trim();
        }
        setBusyId(document._id);
        setError("");
        setMessage("");
        try {
            await authenticatedAdminRequest(
                `/admin/rental-partners/documents/${document._id}/review`,
                { method: "PATCH", body: JSON.stringify(body) }
            );
            setMessage(`Document ${nextStatus.toLowerCase()}.`);
            const data = await authenticatedAdminRequest(
                `/admin/rental-partners/${partner._id}/documents`
            );
            setDocuments(data.documents || []);
        } catch (err) {
            setError(err.message);
        } finally {
            setBusyId("");
        }
    }

    return (
        <section className="rounded-2xl bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="text-lg font-extrabold">Rental Partners</h3>
                <div className="flex gap-2">
                    {[
                        { id: "PENDING", label: "Pending queue" },
                        { id: "ALL", label: "All partners" },
                    ].map(({ id, label }) => (
                        <button
                            key={id}
                            type="button"
                            onClick={() => setMode(id)}
                            className={`rounded-xl px-3.5 py-2 text-xs font-bold ${mode === id
                                ? "bg-[#087F5B] text-white"
                                : "bg-slate-100 text-slate-600"
                                }`}
                        >
                            {label}
                        </button>
                    ))}
                    <button
                        type="button"
                        onClick={load}
                        className="rounded-xl bg-slate-100 px-3.5 py-2 text-xs font-bold text-slate-600"
                    >
                        <RefreshCw size={14} className="mr-1 inline" /> Refresh
                    </button>
                </div>
            </div>

            {loading ? (
                <p className="mt-4 text-sm text-slate-500">Loading partners…</p>
            ) : partners.length === 0 ? (
                <p className="mt-4 text-sm text-slate-500">
                    {mode === "PENDING"
                        ? "No partners are waiting for review."
                        : "No rental partners yet."}
                </p>
            ) : (
                <div className="mt-4 space-y-3">
                    {partners.map((partner) => {
                        const user = partner.userId || {};
                        const fullName = [user.firstName, user.lastName].filter(Boolean).join(" ");
                        return (
                            <div key={partner._id} className="rounded-xl border border-slate-100 p-4">
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                    <div>
                                        <p className="font-extrabold">
                                            {partner.businessName || "Unnamed business"}
                                        </p>
                                        <p className="text-xs text-slate-500">
                                            {fullName || "—"}{user.email ? ` • ${user.email}` : ""}
                                        </p>
                                        <p className="mt-1 text-xs text-slate-500">
                                            Applied {when(partner.createdAt)} •{" "}
                                            {partner.agreementAcceptedAt
                                                ? `Agreement accepted ${when(partner.agreementAcceptedAt)}`
                                                : "Agreement NOT accepted"}
                                            {partner.providesChauffeur
                                                ? ` • Chauffeur: ${pretty(partner.chauffeurVerificationStatus || "NOT APPLIED")}`
                                                : ""}
                                        </p>
                                    </div>
                                    <StatusChip status={partner.applicationStatus} />
                                </div>

                                <div className="mt-3 flex flex-wrap gap-2">
                                    <button
                                        type="button"
                                        onClick={() => toggleDocuments(partner)}
                                        className="rounded-xl bg-slate-100 px-3.5 py-2 text-xs font-bold text-slate-600"
                                    >
                                        <Eye size={14} className="mr-1 inline" /> KYC Documents
                                    </button>
                                    {partner.applicationStatus !== "APPROVED" && (
                                        <button
                                            type="button"
                                            disabled={busyId === partner._id}
                                            onClick={() => setStatus(partner, "APPROVED")}
                                            className="rounded-xl bg-[#087F5B] px-3.5 py-2 text-xs font-bold text-white disabled:opacity-50"
                                        >
                                            <CheckCircle2 size={14} className="mr-1 inline" /> Approve
                                        </button>
                                    )}
                                    {partner.applicationStatus !== "REJECTED" && (
                                        <button
                                            type="button"
                                            disabled={busyId === partner._id}
                                            onClick={() => setStatus(partner, "REJECTED")}
                                            className="rounded-xl bg-red-50 px-3.5 py-2 text-xs font-bold text-red-600 disabled:opacity-50"
                                        >
                                            <XCircle size={14} className="mr-1 inline" /> Reject
                                        </button>
                                    )}
                                    {partner.applicationStatus === "APPROVED" && (
                                        <button
                                            type="button"
                                            disabled={busyId === partner._id}
                                            onClick={() => setStatus(partner, "SUSPENDED")}
                                            className="rounded-xl bg-red-50 px-3.5 py-2 text-xs font-bold text-red-600 disabled:opacity-50"
                                        >
                                            Suspend
                                        </button>
                                    )}
                                </div>

                                {docsFor === partner._id && (
                                    <div className="mt-3 rounded-xl bg-slate-50 p-3">
                                        {docsLoading ? (
                                            <p className="text-xs text-slate-500">Loading documents…</p>
                                        ) : documents.length === 0 ? (
                                            <p className="text-xs text-slate-500">No KYC documents uploaded.</p>
                                        ) : (
                                            <div className="space-y-2">
                                                {documents.map((document) => (
                                                    <div
                                                        key={document._id}
                                                        className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white px-3 py-2"
                                                    >
                                                        <div className="flex items-center gap-2">
                                                            <ShieldCheck size={14} className="text-[#087F5B]" />
                                                            <span className="text-xs font-bold">
                                                                {PARTNER_DOC_LABELS[document.documentType] || pretty(document.documentType)}
                                                            </span>
                                                            <StatusChip status={document.verificationStatus} />
                                                            {document.rejectionReason && (
                                                                <span className="text-[11px] text-red-500">
                                                                    {document.rejectionReason}
                                                                </span>
                                                            )}
                                                        </div>
                                                        <div className="flex gap-2">
                                                            <button
                                                                type="button"
                                                                onClick={() => viewDocument(document._id)}
                                                                className="rounded-lg bg-slate-100 px-3 py-1.5 text-[11px] font-bold text-slate-600"
                                                            >
                                                                View
                                                            </button>
                                                            {document.verificationStatus !== "APPROVED" && (
                                                                <button
                                                                    type="button"
                                                                    disabled={busyId === document._id}
                                                                    onClick={() => reviewDocument(partner, document, "APPROVED")}
                                                                    className="rounded-lg bg-[#087F5B] px-3 py-1.5 text-[11px] font-bold text-white disabled:opacity-50"
                                                                >
                                                                    Approve
                                                                </button>
                                                            )}
                                                            {document.verificationStatus !== "REJECTED" && (
                                                                <button
                                                                    type="button"
                                                                    disabled={busyId === document._id}
                                                                    onClick={() => reviewDocument(partner, document, "REJECTED")}
                                                                    className="rounded-lg bg-red-50 px-3 py-1.5 text-[11px] font-bold text-red-600 disabled:opacity-50"
                                                                >
                                                                    Reject
                                                                </button>
                                                            )}
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </section>
    );
}

function ReportsTab({ setError }) {
    const [from, setFrom] = useState(() =>
        new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    );
    const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
    const [recon, setRecon] = useState(null);
    const [suspicious, setSuspicious] = useState(null);
    const [loading, setLoading] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        setError("");
        try {
            const [reconData, suspiciousData] = await Promise.all([
                authenticatedAdminRequest(
                    `/admin/rentals/reports/fee-reconciliation?from=${from}&to=${to}`
                ),
                authenticatedAdminRequest(
                    "/admin/rentals/reports/suspicious-cancellations?days=30&minCount=3"
                ),
            ]);
            setRecon(reconData);
            setSuspicious(suspiciousData);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, [from, to, setError]);

    useEffect(() => {
        void (async () => {
            await Promise.resolve();
            await load();
        })();
    }, [load]);

    return (
        <div className="space-y-5">
            <section className="rounded-2xl bg-white p-5 shadow-sm">
                <div className="flex flex-wrap items-end justify-between gap-3">
                    <h3 className="text-lg font-extrabold">Booking-fee reconciliation</h3>
                    <div className="flex items-end gap-3">
                        <label className="block">
                            <span className="mb-1.5 block text-xs font-bold text-slate-500">From</span>
                            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded-xl border p-2.5 text-sm" />
                        </label>
                        <label className="block">
                            <span className="mb-1.5 block text-xs font-bold text-slate-500">To</span>
                            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="rounded-xl border p-2.5 text-sm" />
                        </label>
                        <button
                            type="button"
                            onClick={load}
                            disabled={loading}
                            className="flex items-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-semibold disabled:opacity-50"
                        >
                            <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
                            Run
                        </button>
                    </div>
                </div>

                {recon ? (
                    <>
                        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                            {[
                                ["Verified fees (window)", `${money(recon.verifiedFees?.totalFee)} · ${recon.verifiedFees?.count ?? 0} bookings`],
                                ["Awaiting verification", `${money(recon.pendingVerification?.totalFee)} · ${recon.pendingVerification?.count ?? 0} bookings`],
                                ["Refunds due (live)", `${money(recon.refundsDue?.totalAmount)} · ${recon.refundsDue?.count ?? 0} bookings`],
                                ["Refunds paid (window)", `${money(recon.refundsPaid?.totalAmount)} · ${recon.refundsPaid?.count ?? 0} bookings`],
                            ].map(([label, value]) => (
                                <div key={label} className="rounded-xl bg-slate-50 p-4">
                                    <p className="text-xs font-bold uppercase tracking-wide text-slate-400">{label}</p>
                                    <p className="mt-1.5 font-extrabold">{value}</p>
                                </div>
                            ))}
                        </div>

                        {recon.verifiedFees?.byCurrentStatus?.length > 0 && (
                            <p className="mt-3 text-sm text-slate-600">
                                Verified fees by current booking status:{" "}
                                {recon.verifiedFees.byCurrentStatus
                                    .map((row) => `${pretty(row.status)} ${money(row.totalFee)} (${row.count})`)
                                    .join(" · ")}
                            </p>
                        )}
                    </>
                ) : (
                    <p className="py-6 text-sm text-slate-500">{loading ? "Loading…" : "No data."}</p>
                )}
            </section>

            <section className="rounded-2xl bg-white p-5 shadow-sm">
                <h3 className="text-lg font-extrabold">Suspicious cancellations (30 days)</h3>
                <p className="mt-1 text-sm text-slate-500">
                    Repeat cancellers and partners cancelling after a fee was verified — the
                    off-platform conversion pattern the provider agreement prohibits.
                </p>

                <div className="mt-4 grid gap-5 lg:grid-cols-2">
                    <div>
                        <h4 className="text-sm font-extrabold">Passengers</h4>
                        {suspicious?.suspiciousPassengers?.length ? (
                            <ul className="mt-2 space-y-1.5 text-sm">
                                {suspicious.suspiciousPassengers.map((row) => (
                                    <li key={row.passengerId} className="rounded-lg bg-slate-50 px-3 py-2">
                                        {row.passengerId} — {row.cancellations} cancellations
                                        ({row.cancellationsAfterConfirmation} after confirmation) · last {when(row.lastCancelledAt)}
                                    </li>
                                ))}
                            </ul>
                        ) : (
                            <p className="mt-2 text-sm text-slate-500">None flagged.</p>
                        )}
                    </div>
                    <div>
                        <h4 className="text-sm font-extrabold">Partners</h4>
                        {suspicious?.suspiciousPartners?.length ? (
                            <ul className="mt-2 space-y-1.5 text-sm">
                                {suspicious.suspiciousPartners.map((row) => (
                                    <li key={row.rentalPartnerId} className="rounded-lg bg-slate-50 px-3 py-2">
                                        {row.rentalPartnerId} — {row.totalCancellations} cancellations
                                        ({row.cancellationsAfterFeeVerified} after fee verified) · last {when(row.lastCancelledAt)}
                                    </li>
                                ))}
                            </ul>
                        ) : (
                            <p className="mt-2 text-sm text-slate-500">None flagged.</p>
                        )}
                    </div>
                </div>
            </section>
        </div>
    );
}

// ---------------------------------------------------------------------
// Settings — booking fee %, launch gates, deadline, receiving bank
// ---------------------------------------------------------------------

function SettingsTab({ setError, setMessage }) {
    const [form, setForm] = useState(null);
    const [saving, setSaving] = useState(false);

    const load = useCallback(async () => {
        setError("");
        try {
            const data = await authenticatedAdminRequest("/admin/rentals/settings");
            setForm(data.settings || null);
        } catch (err) {
            setError(err.message);
        }
    }, [setError]);

    useEffect(() => {
        void (async () => {
            await Promise.resolve();
            await load();
        })();
    }, [load]);

    async function save() {
        if (!form) return;
        setSaving(true);
        setError("");
        setMessage("");
        try {
            const data = await authenticatedAdminRequest("/admin/rentals/settings", {
                method: "PATCH",
                body: JSON.stringify({
                    rentalsEnabled: form.rentalsEnabled === true,
                    rentalBookingFeePercent: Number(form.rentalBookingFeePercent),
                    rentalsSelfDriveEnabled: form.rentalsSelfDriveEnabled === true,
                    rentalPaymentDeadlineHours: Number(form.rentalPaymentDeadlineHours),
                }),
            });
            setForm((prev) => ({ ...prev, ...data.settings }));
            setMessage("Rental settings saved.");
        } catch (err) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    }

    if (!form) {
        return (
            <section className="rounded-2xl bg-white p-5 shadow-sm">
                <p className="py-6 text-sm text-slate-500">Loading settings…</p>
            </section>
        );
    }

    return (
        <section className="rounded-2xl bg-white p-5 shadow-sm">
            <h3 className="text-lg font-extrabold">Rental platform settings</h3>
            <p className="mt-1 text-sm text-slate-500">
                Booking fees are paid by manual transfer to the platform receiving account
                ({form.bankName || "bank not set"} {form.bankAccountNumber ? `· ${form.bankAccountNumber}` : ""}) —
                the account itself is managed under Commission Settings.
            </p>

            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <label className="flex items-center gap-3 rounded-xl border p-3 text-sm font-semibold">
                    <input
                        type="checkbox"
                        checked={form.rentalsEnabled === true}
                        onChange={(e) => setForm((prev) => ({ ...prev, rentalsEnabled: e.target.checked }))}
                        className="h-4 w-4 accent-[#087F5B]"
                    />
                    Rentals enabled
                </label>

                <label className="block">
                    <span className="mb-1.5 block text-xs font-bold text-slate-500">Booking fee (% of rental charges)</span>
                    <input
                        type="number"
                        min="0"
                        max="100"
                        step="0.5"
                        value={form.rentalBookingFeePercent ?? 5}
                        onChange={(e) => setForm((prev) => ({ ...prev, rentalBookingFeePercent: e.target.value }))}
                        className="w-full rounded-xl border p-3 text-sm"
                    />
                </label>

                <label className="block">
                    <span className="mb-1.5 block text-xs font-bold text-slate-500">Fee payment deadline (hours)</span>
                    <input
                        type="number"
                        min="1"
                        max="168"
                        step="1"
                        value={form.rentalPaymentDeadlineHours ?? 24}
                        onChange={(e) => setForm((prev) => ({ ...prev, rentalPaymentDeadlineHours: e.target.value }))}
                        className="w-full rounded-xl border p-3 text-sm"
                    />
                </label>

                <label className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-900">
                    <input
                        type="checkbox"
                        checked={form.rentalsSelfDriveEnabled === true}
                        onChange={(e) => setForm((prev) => ({ ...prev, rentalsSelfDriveEnabled: e.target.checked }))}
                        className="h-4 w-4 accent-[#087F5B]"
                    />
                    Self-Drive enabled (launch gate — With Driver launches first)
                </label>
            </div>

            <button
                type="button"
                onClick={save}
                disabled={saving}
                className="mt-4 rounded-xl bg-[#087F5B] px-5 py-3 text-sm font-bold text-white disabled:opacity-50"
            >
                {saving ? "Saving…" : "Save settings"}
            </button>
        </section>
    );
}
