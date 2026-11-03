"use client";

import { useCallback, useEffect, useState } from "react";
import {
    CheckCircle2, Clock3, LifeBuoy, MessageSquareWarning, RefreshCw, Send,
} from "lucide-react";
import { apiRequest } from "@/lib/api";

export const COMPLAINT_CATEGORIES = [
    { value: "BEHAVIOUR", label: "Behaviour" },
    { value: "FARE", label: "Fare" },
    { value: "SAFETY", label: "Safety" },
    { value: "VEHICLE", label: "Vehicle" },
    { value: "SERVICE", label: "Service" },
    { value: "OTHER", label: "Other" },
];

const STATUS_META = {
    OPEN: { label: "Open", classes: "bg-pd-warning-soft text-pd-warning" },
    IN_REVIEW: { label: "In review", classes: "bg-sky-100 text-sky-700" },
    RESOLVED: { label: "Resolved", classes: "bg-pd-success-soft text-[#087F5B]" },
    REJECTED: { label: "Rejected", classes: "bg-pd-danger-soft text-pd-danger" },
};

export const COMPLAINT_STATUS_META = STATUS_META;

const categoryLabel = (value) =>
    COMPLAINT_CATEGORIES.find((c) => c.value === value)?.label || "Other";

const formatDate = (value) =>
    new Date(value).toLocaleDateString("en-PK", {
        day: "numeric",
        month: "short",
        year: "numeric",
    });

const formatDateTime = (value) =>
    new Date(value).toLocaleString("en-PK", {
        day: "numeric",
        month: "short",
        hour: "numeric",
        minute: "2-digit",
    });

const prettyStatus = (value) => String(value || "").replaceAll("_", " ");

/**
 * Complaint form + "My complaints" list, shared by the passenger and
 * driver Help & Complaints pages. `role` selects the recent-trips source
 * used for the optional trip/parcel link picker.
 */
export default function ComplaintsSection({ token, role }) {
    const [complaints, setComplaints] = useState([]);
    const [loading, setLoading] = useState(true);
    const [listError, setListError] = useState("");
    const [replyText, setReplyText] = useState({});
    const [replyBusy, setReplyBusy] = useState({});
    const [replyError, setReplyError] = useState({});

    const [links, setLinks] = useState({ rides: [], parcels: [] });
    const [category, setCategory] = useState("");
    const [link, setLink] = useState("");
    const [description, setDescription] = useState("");
    const [formError, setFormError] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [submitted, setSubmitted] = useState(false);

    const loadComplaints = useCallback(async () => {
        if (!token) return;
        setLoading(true);
        try {
            const data = await apiRequest("/complaints/mine", { token });
            setComplaints(data.complaints || []);
            setListError("");
        } catch (error) {
            setListError(error.message);
        } finally {
            setLoading(false);
        }
    }, [token]);

    useEffect(() => {
        loadComplaints();
    }, [loadComplaints]);

    // Follow-up inside the same complaint thread. The server reopens
    // a RESOLVED complaint on a user reply, so the conversation runs
    // until the user agrees it is solved.
    async function sendReply(complaintId) {
        const text = (replyText[complaintId] || "").trim();
        if (!text || replyBusy[complaintId]) return;

        setReplyBusy((prev) => ({ ...prev, [complaintId]: true }));
        setReplyError((prev) => ({ ...prev, [complaintId]: "" }));

        try {
            const data = await apiRequest(`/complaints/${complaintId}/messages`, {
                method: "POST",
                token,
                body: JSON.stringify({ message: text }),
            });

            setComplaints((prev) =>
                prev.map((c) => (c._id === complaintId ? data.complaint : c))
            );
            setReplyText((prev) => ({ ...prev, [complaintId]: "" }));
        } catch (error) {
            setReplyError((prev) => ({ ...prev, [complaintId]: error.message }));
        } finally {
            setReplyBusy((prev) => ({ ...prev, [complaintId]: false }));
        }
    }

    // Optional link picker sources — failures just hide the picker.
    useEffect(() => {
        if (!token) return;
        let cancelled = false;

        const ridesPath = role === "DRIVER"
            ? "/drivers/me/history?page=1"
            : "/rides/history?page=1";
        const parcelsPath = role === "DRIVER"
            ? "/parcels/driver/my"
            : "/parcels/my";

        Promise.allSettled([
            apiRequest(ridesPath, { token }),
            apiRequest(parcelsPath, { token }),
        ]).then(([ridesResult, parcelsResult]) => {
            if (cancelled) return;
            setLinks({
                rides: ridesResult.status === "fulfilled"
                    ? (ridesResult.value.rides || []).slice(0, 10)
                    : [],
                parcels: parcelsResult.status === "fulfilled"
                    ? (parcelsResult.value.orders || []).slice(0, 10)
                    : [],
            });
        });

        return () => { cancelled = true; };
    }, [token, role]);

    async function submitComplaint(event) {
        event.preventDefault();
        setSubmitted(false);

        if (!category) {
            setFormError("Please choose a category for your complaint.");
            return;
        }
        if (!description.trim()) {
            setFormError("Please describe what happened.");
            return;
        }

        setSubmitting(true);
        setFormError("");

        const body = {
            category,
            description: description.trim(),
        };
        if (link.startsWith("ride:")) body.ride = link.slice(5);
        if (link.startsWith("parcel:")) body.parcelOrder = link.slice(7);

        try {
            await apiRequest("/complaints", {
                method: "POST",
                token,
                body: JSON.stringify(body),
            });
            setCategory("");
            setLink("");
            setDescription("");
            setSubmitted(true);
            loadComplaints();
        } catch (error) {
            setFormError(error.message);
        } finally {
            setSubmitting(false);
        }
    }

    const hasLinks = links.rides.length > 0 || links.parcels.length > 0;

    return (
        <div className="space-y-5">
            <section className="rounded-[24px] bg-pd-surface p-5 shadow-sm">
                <div className="mb-4 flex items-center gap-3">
                    <LifeBuoy size={22} className="text-[#087F5B]" />
                    <h3 className="text-lg font-extrabold">File a complaint</h3>
                </div>

                {submitted && (
                    <p role="status" className="mb-4 flex items-start gap-2 rounded-xl bg-pd-success-soft p-3 text-sm font-semibold text-[#087F5B]">
                        <CheckCircle2 size={18} className="mt-0.5 shrink-0" />
                        Complaint submitted. Our team will review it — you can
                        track its status below.
                    </p>
                )}

                {formError && (
                    <p role="alert" className="mb-4 rounded-xl bg-pd-danger-soft p-3 text-sm font-semibold text-pd-danger">
                        {formError}
                    </p>
                )}

                <form onSubmit={submitComplaint} noValidate className="space-y-4">
                    <div>
                        <p className="mb-2 text-xs font-bold text-pd-muted">
                            What is this about?
                        </p>
                        <div className="flex flex-wrap gap-2">
                            {COMPLAINT_CATEGORIES.map(({ value, label }) => (
                                <button
                                    key={value}
                                    type="button"
                                    aria-pressed={category === value}
                                    onClick={() => setCategory(value)}
                                    className={`min-h-10 rounded-xl px-3.5 text-sm font-bold transition ${category === value
                                        ? "bg-[#087F5B] text-white"
                                        : "bg-pd-surface-2 text-pd-text-2"
                                        }`}
                                >
                                    {label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {hasLinks && (
                        <div>
                            <label
                                htmlFor="complaint-link"
                                className="mb-2 block text-xs font-bold text-pd-muted"
                            >
                                Link to a trip or parcel (optional)
                            </label>
                            <select
                                id="complaint-link"
                                value={link}
                                onChange={(e) => setLink(e.target.value)}
                                className="w-full rounded-xl border border-pd-line bg-pd-surface p-3 text-sm font-semibold outline-none focus:border-[#087F5B]"
                            >
                                <option value="">General — no specific trip</option>
                                {links.rides.length > 0 && (
                                    <optgroup label="Recent trips">
                                        {links.rides.map((ride) => (
                                            <option key={ride._id} value={`ride:${ride._id}`}>
                                                {formatDate(ride.createdAt)} · {prettyStatus(ride.vehicleType)} · {prettyStatus(ride.status)}
                                            </option>
                                        ))}
                                    </optgroup>
                                )}
                                {links.parcels.length > 0 && (
                                    <optgroup label="Recent parcels">
                                        {links.parcels.map((order) => (
                                            <option key={order._id} value={`parcel:${order._id}`}>
                                                {formatDate(order.createdAt)} · {prettyStatus(order.parcel?.category || "Parcel")} · {prettyStatus(order.status)}
                                            </option>
                                        ))}
                                    </optgroup>
                                )}
                            </select>
                        </div>
                    )}

                    <div>
                        <label
                            htmlFor="complaint-description"
                            className="mb-2 block text-xs font-bold text-pd-muted"
                        >
                            Describe what happened
                        </label>
                        <textarea
                            id="complaint-description"
                            rows={4}
                            maxLength={1000}
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            placeholder="Tell us the details so we can help…"
                            className="w-full resize-none rounded-xl border border-pd-line p-3 text-sm font-medium outline-none focus:border-[#087F5B]"
                        />
                        <p className="mt-1 text-right text-xs text-pd-faint">
                            {description.length}/1000
                        </p>
                    </div>

                    <button
                        type="submit"
                        disabled={submitting}
                        className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#087F5B] p-3.5 font-bold text-white disabled:opacity-50"
                    >
                        <Send size={17} />
                        {submitting ? "Submitting..." : "Submit complaint"}
                    </button>
                </form>
            </section>

            <section className="rounded-[24px] bg-pd-surface p-5 shadow-sm">
                <div className="mb-4 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                        <MessageSquareWarning size={22} className="text-[#087F5B]" />
                        <h3 className="text-lg font-extrabold">My complaints</h3>
                    </div>
                    <button
                        type="button"
                        onClick={loadComplaints}
                        disabled={loading}
                        aria-label="Refresh complaints"
                        title="Refresh to check for new support replies"
                        className="flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-bold text-[#087F5B] disabled:opacity-50"
                    >
                        <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
                        Refresh
                    </button>
                </div>

                {loading && (
                    <p className="py-5 text-center text-sm text-pd-muted">
                        Loading complaints...
                    </p>
                )}

                {listError && (
                    <p role="alert" className="rounded-xl bg-pd-danger-soft p-3 text-sm text-pd-danger">
                        {listError}
                    </p>
                )}

                {!loading && !listError && complaints.length === 0 && (
                    <p className="py-6 text-center text-sm text-pd-muted">
                        You have not filed any complaints yet.
                    </p>
                )}

                {!loading && complaints.map((complaint) => {
                    const meta = STATUS_META[complaint.status] || STATUS_META.OPEN;
                    return (
                        <article
                            key={complaint._id}
                            className="border-b border-pd-line py-4 last:border-0"
                        >
                            <div className="flex items-start justify-between gap-3">
                                <p className="font-bold">
                                    {categoryLabel(complaint.category)}
                                </p>
                                <span className={`rounded-lg px-2.5 py-1 text-[11px] font-bold ${meta.classes}`}>
                                    {meta.label}
                                </span>
                            </div>
                            <p className="mt-1 flex items-center gap-1 text-xs text-pd-muted">
                                <Clock3 size={13} />
                                {formatDate(complaint.createdAt)}
                                {complaint.ride && " · Linked to a trip"}
                                {complaint.parcelOrder && " · Linked to a parcel"}
                            </p>
                            <p className="mt-2 line-clamp-3 text-sm text-pd-text-2">
                                {complaint.description}
                            </p>
                            {(complaint.messages || []).map((msg, index) => (
                                <p
                                    key={index}
                                    className={`mt-2 rounded-xl p-3 text-sm text-pd-text-2 ${msg.sender === "ADMIN"
                                        ? "bg-pd-success-soft"
                                        : "bg-pd-surface-2"
                                        }`}
                                >
                                    <span className="font-bold text-[#087F5B]">
                                        {msg.sender === "ADMIN" ? "Support reply: " : "You: "}
                                    </span>
                                    {msg.message}
                                    <span className="mt-1 block text-xs text-pd-muted">
                                        {msg.createdAt ? formatDateTime(msg.createdAt) : ""}
                                    </span>
                                </p>
                            ))}
                            {!(complaint.messages || []).length && complaint.adminNote && (
                                <p className="mt-2 rounded-xl bg-pd-success-soft p-3 text-sm text-pd-text-2">
                                    <span className="font-bold text-[#087F5B]">Support reply: </span>
                                    {complaint.adminNote}
                                </p>
                            )}
                            {complaint.status === "REJECTED" ? (
                                <p className="mt-2 text-xs text-pd-muted">
                                    This complaint is closed.
                                </p>
                            ) : (
                                <div className="mt-3">
                                    <textarea
                                        rows={2}
                                        maxLength={1000}
                                        value={replyText[complaint._id] || ""}
                                        onChange={(e) =>
                                            setReplyText((prev) => ({
                                                ...prev,
                                                [complaint._id]: e.target.value,
                                            }))
                                        }
                                        placeholder="Write a follow-up reply…"
                                        className="w-full resize-none rounded-xl border px-3 py-2 text-sm outline-none focus:border-[#087F5B]"
                                    />
                                    {replyError[complaint._id] && (
                                        <p role="alert" className="mt-1 text-xs text-pd-danger">
                                            {replyError[complaint._id]}
                                        </p>
                                    )}
                                    <button
                                        type="button"
                                        onClick={() => sendReply(complaint._id)}
                                        disabled={!((replyText[complaint._id] || "").trim()) || replyBusy[complaint._id]}
                                        className="mt-2 flex items-center gap-1.5 rounded-xl bg-[#087F5B] px-4 py-2 text-xs font-bold text-white disabled:opacity-50"
                                    >
                                        <Send size={14} />
                                        {replyBusy[complaint._id] ? "Sending…" : "Send reply"}
                                    </button>
                                </div>
                            )}
                        </article>
                    );
                })}
            </section>
        </div>
    );
}
