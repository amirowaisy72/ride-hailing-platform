"use client";

import { useCallback, useEffect, useState } from "react";
import AdminShell from "@/components/AdminShell";
import { authenticatedAdminRequest } from "@/lib/adminSession";

const STATUSES = ["ALL", "OPEN", "IN_REVIEW", "RESOLVED", "REJECTED"];
const EDITABLE_STATUSES = ["OPEN", "IN_REVIEW", "RESOLVED", "REJECTED"];

const STATUS_CLASSES = {
    OPEN: "bg-amber-100 text-amber-700",
    IN_REVIEW: "bg-sky-100 text-sky-700",
    RESOLVED: "bg-emerald-50 text-[#087F5B]",
    REJECTED: "bg-red-50 text-red-600",
};

const personName = (person) =>
    [person?.firstName, person?.lastName].filter(Boolean).join(" ") ||
    person?.email ||
    "—";

const pretty = (value) => String(value || "").replaceAll("_", " ");

export default function AdminComplaintsPage() {
    const [complaints, setComplaints] = useState([]);
    const [status, setStatus] = useState("ALL");
    const [page, setPage] = useState(1);
    const [total, setTotal] = useState(0);
    const [totalPages, setTotalPages] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    const [selected, setSelected] = useState(null);
    const [editStatus, setEditStatus] = useState("OPEN");
    const [editNote, setEditNote] = useState("");
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState("");

    const load = useCallback(async () => {
        setLoading(true);
        setError("");

        try {
            const params = new URLSearchParams({ page: String(page) });
            if (status !== "ALL") params.set("status", status);

            const data = await authenticatedAdminRequest(
                `/admin/complaints?${params}`
            );

            setComplaints(data.complaints || []);
            setTotal(data.total || 0);
            setTotalPages(data.totalPages || 0);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, [page, status]);

    useEffect(() => {
        load();
    }, [load]);

    function openComplaint(complaint) {
        setSelected(complaint);
        setEditStatus(complaint.status);
        setEditNote(complaint.adminNote || "");
        setSaveError("");
    }

    async function saveComplaint() {
        if (!selected) return;
        setSaving(true);
        setSaveError("");

        try {
            const data = await authenticatedAdminRequest(
                `/admin/complaints/${selected._id}`,
                {
                    method: "PATCH",
                    body: JSON.stringify({
                        status: editStatus,
                        adminNote: editNote,
                    }),
                }
            );

            setSelected(data.complaint);
            setComplaints((previous) =>
                previous.map((item) =>
                    item._id === data.complaint._id ? data.complaint : item
                )
            );
        } catch (err) {
            setSaveError(err.message);
        } finally {
            setSaving(false);
        }
    }

    return (
        <AdminShell title="Complaints">
            <div className="space-y-5">
                <div className="rounded-2xl bg-white p-6 shadow-sm">
                    <h2 className="text-2xl font-extrabold">Complaints</h2>
                    <p className="mt-2 text-sm text-slate-500">
                        Total matching complaints: {total}
                    </p>

                    <div className="mt-4 flex flex-wrap gap-3">
                        <select
                            value={status}
                            onChange={(e) => {
                                setStatus(e.target.value);
                                setPage(1);
                            }}
                            className="rounded-xl border p-3 text-sm"
                        >
                            {STATUSES.map((value) => (
                                <option key={value} value={value}>
                                    {pretty(value)}
                                </option>
                            ))}
                        </select>

                        <button
                            type="button"
                            onClick={load}
                            disabled={loading}
                            className="rounded-xl bg-[#087F5B] px-5 py-3 text-sm font-bold text-white disabled:opacity-50"
                        >
                            Refresh
                        </button>
                    </div>
                </div>

                {error && (
                    <p role="alert" className="rounded-xl bg-red-50 p-4 text-red-600">
                        {error}
                    </p>
                )}

                <div className="overflow-x-auto rounded-2xl bg-white shadow-sm">
                    <table className="w-full min-w-[820px] text-left text-sm">
                        <thead>
                            <tr className="border-b text-xs uppercase tracking-wide text-slate-400">
                                <th className="px-5 py-4 font-bold">Date</th>
                                <th className="px-5 py-4 font-bold">Filed by</th>
                                <th className="px-5 py-4 font-bold">Role</th>
                                <th className="px-5 py-4 font-bold">Category</th>
                                <th className="px-5 py-4 font-bold">Status</th>
                                <th className="px-5 py-4 font-bold">Description</th>
                                <th className="px-5 py-4 font-bold">Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            {complaints.map((complaint) => (
                                <tr key={complaint._id} className="border-b last:border-0">
                                    <td className="whitespace-nowrap px-5 py-4 text-slate-500">
                                        {new Date(complaint.createdAt).toLocaleString("en-PK")}
                                    </td>
                                    <td className="px-5 py-4">
                                        <p className="font-bold">{personName(complaint.complainant)}</p>
                                        <p className="text-xs text-slate-500">
                                            {complaint.complainant?.email || "—"}
                                        </p>
                                    </td>
                                    <td className="px-5 py-4">{pretty(complaint.complainantRole)}</td>
                                    <td className="px-5 py-4">{pretty(complaint.category)}</td>
                                    <td className="px-5 py-4">
                                        <span className={`rounded-lg px-2.5 py-1 text-[11px] font-bold ${STATUS_CLASSES[complaint.status] || ""}`}>
                                            {pretty(complaint.status)}
                                        </span>
                                    </td>
                                    <td className="max-w-[280px] px-5 py-4 text-slate-600">
                                        <span className="line-clamp-2">{complaint.description}</span>
                                    </td>
                                    <td className="px-5 py-4">
                                        <button
                                            type="button"
                                            onClick={() => openComplaint(complaint)}
                                            className="rounded-lg bg-emerald-50 px-3 py-2 text-xs font-bold text-[#087F5B]"
                                        >
                                            Review
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>

                    {!loading && !error && complaints.length === 0 && (
                        <p className="p-6 text-slate-500">No complaints found.</p>
                    )}
                </div>

                <div className="flex items-center justify-between">
                    <button
                        disabled={loading || page <= 1}
                        onClick={() => setPage(page - 1)}
                        className="rounded-xl border px-5 py-3 disabled:opacity-40"
                    >
                        Previous
                    </button>

                    <span className="text-sm font-bold">
                        Page {page} of {Math.max(1, totalPages)}
                    </span>

                    <button
                        disabled={loading || page >= totalPages}
                        onClick={() => setPage(page + 1)}
                        className="rounded-xl border px-5 py-3 disabled:opacity-40"
                    >
                        Next
                    </button>
                </div>
            </div>

            {selected && (
                <div
                    className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-6"
                    role="dialog"
                    aria-modal="true"
                    aria-label="Complaint details"
                    onClick={() => setSelected(null)}
                >
                    <div
                        className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-3xl bg-white p-6 shadow-xl sm:rounded-3xl"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex items-start justify-between gap-3">
                            <div>
                                <h3 className="text-xl font-extrabold">
                                    {pretty(selected.category)} complaint
                                </h3>
                                <p className="mt-1 text-sm text-slate-500">
                                    {new Date(selected.createdAt).toLocaleString("en-PK")}
                                </p>
                            </div>
                            <span className={`rounded-lg px-2.5 py-1 text-[11px] font-bold ${STATUS_CLASSES[selected.status] || ""}`}>
                                {pretty(selected.status)}
                            </span>
                        </div>

                        <dl className="mt-5 space-y-3 text-sm">
                            <div>
                                <dt className="font-bold text-slate-500">Filed by</dt>
                                <dd className="mt-0.5">
                                    {personName(selected.complainant)} ({pretty(selected.complainantRole)})
                                    {selected.complainant?.email ? ` · ${selected.complainant.email}` : ""}
                                </dd>
                            </div>
                            {selected.againstUser && (
                                <div>
                                    <dt className="font-bold text-slate-500">Reported user</dt>
                                    <dd className="mt-0.5">
                                        {personName(selected.againstUser)}
                                        {selected.againstUser?.email ? ` · ${selected.againstUser.email}` : ""}
                                    </dd>
                                </div>
                            )}
                            {selected.ride && (
                                <div>
                                    <dt className="font-bold text-slate-500">Linked trip</dt>
                                    <dd className="mt-0.5">
                                        {pretty(selected.ride.vehicleType)} · {pretty(selected.ride.status)} · {new Date(selected.ride.createdAt).toLocaleString("en-PK")}
                                    </dd>
                                </div>
                            )}
                            {selected.parcelOrder && (
                                <div>
                                    <dt className="font-bold text-slate-500">Linked parcel</dt>
                                    <dd className="mt-0.5">
                                        {pretty(selected.parcelOrder.vehicleType)} · {pretty(selected.parcelOrder.status)} · {new Date(selected.parcelOrder.createdAt).toLocaleString("en-PK")}
                                    </dd>
                                </div>
                            )}
                            <div>
                                <dt className="font-bold text-slate-500">Description</dt>
                                <dd className="mt-0.5 whitespace-pre-wrap rounded-xl bg-slate-50 p-3">
                                    {selected.description}
                                </dd>
                            </div>
                        </dl>

                        {saveError && (
                            <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-600">
                                {saveError}
                            </p>
                        )}

                        <div className="mt-5 grid gap-3 sm:grid-cols-[180px_1fr]">
                            <label className="block">
                                <span className="mb-1.5 block text-xs font-bold text-slate-500">Status</span>
                                <select
                                    value={editStatus}
                                    onChange={(e) => setEditStatus(e.target.value)}
                                    className="w-full rounded-xl border p-3 text-sm"
                                >
                                    {EDITABLE_STATUSES.map((value) => (
                                        <option key={value} value={value}>
                                            {pretty(value)}
                                        </option>
                                    ))}
                                </select>
                            </label>
                            <label className="block">
                                <span className="mb-1.5 block text-xs font-bold text-slate-500">
                                    Admin note (visible to the user)
                                </span>
                                <textarea
                                    rows={3}
                                    maxLength={1000}
                                    value={editNote}
                                    onChange={(e) => setEditNote(e.target.value)}
                                    placeholder="What was done about this complaint…"
                                    className="w-full resize-none rounded-xl border p-3 text-sm"
                                />
                            </label>
                        </div>

                        <div className="mt-5 flex gap-3">
                            <button
                                type="button"
                                onClick={saveComplaint}
                                disabled={saving}
                                className="flex-1 rounded-xl bg-[#087F5B] p-3 font-bold text-white disabled:opacity-50"
                            >
                                {saving ? "Saving..." : "Save changes"}
                            </button>
                            <button
                                type="button"
                                onClick={() => setSelected(null)}
                                className="rounded-xl border px-5 py-3 font-bold"
                            >
                                Close
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </AdminShell>
    );
}
