"use client";

import { useCallback, useEffect, useState } from "react";
import AdminShell from "@/components/AdminShell";
import { authenticatedAdminRequest } from "@/lib/adminSession";

const STATUSES = ["ALL", "NEW", "REVIEWED"];
const EDITABLE_STATUSES = ["NEW", "REVIEWED"];

const STATUS_CLASSES = {
    NEW: "bg-amber-100 text-amber-700",
    REVIEWED: "bg-emerald-50 text-[#087F5B]",
};

const personName = (person) =>
    [person?.firstName, person?.lastName].filter(Boolean).join(" ") ||
    person?.email ||
    "—";

const pretty = (value) => String(value || "").replaceAll("_", " ");

export default function AdminFeedbacksPage() {
    const [feedback, setFeedback] = useState([]);
    const [status, setStatus] = useState("ALL");
    const [page, setPage] = useState(1);
    const [total, setTotal] = useState(0);
    const [totalPages, setTotalPages] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    const [selected, setSelected] = useState(null);
    const [editStatus, setEditStatus] = useState("NEW");
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState("");

    const load = useCallback(async () => {
        setLoading(true);
        setError("");

        try {
            const params = new URLSearchParams({ page: String(page) });
            if (status !== "ALL") params.set("status", status);

            const data = await authenticatedAdminRequest(
                `/admin/feedback?${params}`
            );

            setFeedback(data.feedback || []);
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

    function openFeedback(item) {
        setSelected(item);
        setEditStatus(item.status);
        setSaveError("");
    }

    async function saveFeedback() {
        if (!selected) return;
        setSaving(true);
        setSaveError("");

        try {
            const data = await authenticatedAdminRequest(
                `/admin/feedback/${selected._id}`,
                {
                    method: "PATCH",
                    body: JSON.stringify({ status: editStatus }),
                }
            );

            setSelected(data.feedback);
            setFeedback((previous) =>
                previous.map((item) =>
                    item._id === data.feedback._id ? data.feedback : item
                )
            );
        } catch (err) {
            setSaveError(err.message);
        } finally {
            setSaving(false);
        }
    }

    return (
        <AdminShell title="Feedbacks">
            <div className="space-y-5">
                <div className="rounded-2xl bg-white p-6 shadow-sm">
                    <h2 className="text-2xl font-extrabold">Feedbacks</h2>
                    <p className="mt-2 text-sm text-slate-500">
                        General feedback about the Safar app itself
                        (suggestions for improvement) — not driver, ride,
                        rental or purchase ratings. Total matching
                        feedback: {total}
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
                                <th className="px-5 py-4 font-bold">From</th>
                                <th className="px-5 py-4 font-bold">Role</th>
                                <th className="px-5 py-4 font-bold">Category</th>
                                <th className="px-5 py-4 font-bold">Rating</th>
                                <th className="px-5 py-4 font-bold">Status</th>
                                <th className="px-5 py-4 font-bold">Suggestion</th>
                                <th className="px-5 py-4 font-bold">Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            {feedback.map((item) => (
                                <tr key={item._id} className="border-b last:border-0">
                                    <td className="whitespace-nowrap px-5 py-4 text-slate-500">
                                        {new Date(item.createdAt).toLocaleString("en-PK")}
                                    </td>
                                    <td className="px-5 py-4">
                                        <p className="font-bold">{personName(item.user)}</p>
                                        <p className="text-xs text-slate-500">
                                            {item.user?.email || "—"}
                                        </p>
                                    </td>
                                    <td className="px-5 py-4">{pretty(item.userRole)}</td>
                                    <td className="px-5 py-4">{pretty(item.category)}</td>
                                    <td className="px-5 py-4">{item.rating || "—"}</td>
                                    <td className="px-5 py-4">
                                        <span className={`rounded-lg px-2.5 py-1 text-[11px] font-bold ${STATUS_CLASSES[item.status] || ""}`}>
                                            {pretty(item.status)}
                                        </span>
                                    </td>
                                    <td className="max-w-[280px] px-5 py-4 text-slate-600">
                                        <span className="line-clamp-2">{item.message}</span>
                                    </td>
                                    <td className="px-5 py-4">
                                        <button
                                            type="button"
                                            onClick={() => openFeedback(item)}
                                            className="rounded-lg bg-emerald-50 px-3 py-2 text-xs font-bold text-[#087F5B]"
                                        >
                                            Review
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>

                    {!loading && !error && feedback.length === 0 && (
                        <p className="p-6 text-slate-500">No feedback found.</p>
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

                {selected && (
                    <div className="rounded-2xl bg-white p-6 shadow-sm">
                        <h3 className="text-lg font-extrabold">Feedback detail</h3>
                        <p className="mt-2 text-sm text-slate-500">
                            {personName(selected.user)} · {pretty(selected.userRole)} ·{" "}
                            {pretty(selected.category)} ·{" "}
                            {new Date(selected.createdAt).toLocaleString("en-PK")}
                        </p>
                        <p className="mt-3 whitespace-pre-wrap text-sm text-slate-700">
                            {selected.message}
                        </p>
                        {selected.rating && (
                            <p className="mt-2 text-sm text-slate-500">
                                Rating: {selected.rating} / 5
                            </p>
                        )}

                        <div className="mt-4 flex flex-wrap gap-3">
                            <select
                                value={editStatus}
                                onChange={(e) => setEditStatus(e.target.value)}
                                className="rounded-xl border p-3 text-sm"
                            >
                                {EDITABLE_STATUSES.map((value) => (
                                    <option key={value} value={value}>
                                        {pretty(value)}
                                    </option>
                                ))}
                            </select>

                            <button
                                type="button"
                                onClick={saveFeedback}
                                disabled={saving}
                                className="rounded-xl bg-[#087F5B] px-5 py-3 text-sm font-bold text-white disabled:opacity-50"
                            >
                                Save status
                            </button>

                            <button
                                type="button"
                                onClick={() => setSelected(null)}
                                className="rounded-xl border px-5 py-3 text-sm font-bold"
                            >
                                Close
                            </button>
                        </div>

                        {saveError && (
                            <p role="alert" className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-600">
                                {saveError}
                            </p>
                        )}
                    </div>
                )}
            </div>
        </AdminShell>
    );
}
