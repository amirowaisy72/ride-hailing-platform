"use client";

import { useEffect, useState } from "react";
import AdminShell from "@/components/AdminShell";
import { authenticatedAdminRequest } from "@/lib/adminSession";

export default function AnnouncementsPage() {
    const [audience, setAudience] = useState("ALL");
    const [lastHours, setLastHours] = useState("");
    const [documents, setDocuments] = useState("ALL");
    const [onlyNotUpdated, setOnlyNotUpdated] = useState(false);
    const [title, setTitle] = useState("");
    const [body, setBody] = useState("");
    const [preview, setPreview] = useState(null);
    const [previewing, setPreviewing] = useState(false);
    const [creating, setCreating] = useState(false);
    const [confirming, setConfirming] = useState(false);
    const [list, setList] = useState([]);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");

    function filters() {
        return {
            audience,
            lastHours: lastHours === "" ? null : Number(lastHours),
            driverDocuments: documents,
            onlyNotUpdated,
        };
    }

    async function loadList() {
        try {
            const result = await authenticatedAdminRequest(
                "/admin/announcements"
            );
            setList(result.announcements || []);
        } catch {
            /* List failure must not block creating. */
        }
    }

    useEffect(() => {
        loadList();
    }, []);

    async function previewTargets(event) {
        event.preventDefault();
        setPreviewing(true);
        setError("");
        setPreview(null);
        setConfirming(false);
        try {
            const result = await authenticatedAdminRequest(
                "/admin/announcements/preview",
                { method: "POST", body: JSON.stringify(filters()) }
            );
            setPreview(result);
        } catch (err) {
            setError(err.message);
        } finally {
            setPreviewing(false);
        }
    }

    async function create(event) {
        event.preventDefault();
        if (
            !preview ||
            preview.targetCount < 1
        ) {
            setError("Preview targets first, and make sure at least one user matches.");
            return;
        }
        // Two-step in-page confirm (no native window.confirm): the native
        // dialog cannot be answered by automation or in some mobile
        // browsers, which left the Create button dead. First click arms
        // the button, second click sends.
        if (!confirming) {
            setConfirming(true);
            return;
        }
        setConfirming(false);
        setCreating(true);
        setError("");
        setNotice("");
        try {
            const result = await authenticatedAdminRequest(
                "/admin/announcements",
                {
                    method: "POST",
                    body: JSON.stringify({
                        ...filters(),
                        title: title.trim(),
                        body: body.trim(),
                    }),
                }
            );
            setNotice(
                `${result.message} Targets: ${result.targetCount}. Each targeted user will see it once in the app, then never again.`
            );
            setPreview(null);
            setTitle("");
            setBody("");
            loadList();
        } catch (err) {
            setError(err.message);
        } finally {
            setCreating(false);
        }
    }

    async function toggle(item) {
        try {
            await authenticatedAdminRequest(`/admin/announcements/${item.id}`, {
                method: "PATCH",
                body: JSON.stringify({ active: !item.active }),
            });
            loadList();
        } catch (err) {
            setError(err.message);
        }
    }

    return (
        <AdminShell title="Announcements">
            <div className="mx-auto max-w-4xl space-y-6">
                <section className="rounded-2xl bg-white p-6 shadow-sm">
                    <h2 className="text-xl font-extrabold">
                        Send In-App Announcement
                    </h2>
                    <p className="mt-1 text-sm text-slate-500">
                        Filter users, preview how many match, then create. The
                        popup appears in the app for each targeted user exactly
                        once — after they close it, it never returns for them.
                    </p>

                    <form onSubmit={previewTargets} className="mt-6 space-y-4">
                        <label className="block text-sm font-bold">
                            Audience
                            <select
                                value={audience}
                                onChange={(event) => setAudience(event.target.value)}
                                className="mt-2 w-full rounded-xl border p-3 font-normal"
                            >
                                <option value="ALL">All users</option>
                                <option value="PASSENGER">Passengers only</option>
                                <option value="DRIVER">Drivers only</option>
                            </select>
                        </label>
                        <label className="block text-sm font-bold">
                            Account created in last hours (leave empty for all time)
                            <input
                                type="number"
                                min="1"
                                max="720"
                                value={lastHours}
                                onChange={(event) => setLastHours(event.target.value)}
                                placeholder="e.g. 8"
                                className="mt-2 w-full rounded-xl border p-3 font-normal"
                            />
                        </label>
                        <label className="block text-sm font-bold">
                            Driver documents
                            <select
                                value={documents}
                                onChange={(event) => setDocuments(event.target.value)}
                                className="mt-2 w-full rounded-xl border p-3 font-normal"
                            >
                                <option value="ALL">Any document status</option>
                                <option value="NO_DOCUMENTS">No documents uploaded yet</option>
                            </select>
                        </label>
                        <label className="flex items-start gap-3 text-sm font-bold">
                            <input
                                type="checkbox"
                                checked={onlyNotUpdated}
                                onChange={(event) => setOnlyNotUpdated(event.target.checked)}
                                className="mt-1"
                            />
                            <span>
                                Only users NOT on the latest app version
                                <span className="block font-normal text-slate-500">
                                    Users still on an older version, plus users who
                                    never reported a version (older builds), are
                                    included. Users already on the latest version
                                    are excluded.
                                </span>
                            </span>
                        </label>
                        <button
                            type="submit"
                            disabled={previewing}
                            className="w-full rounded-xl bg-slate-900 p-3 font-bold text-white disabled:opacity-50"
                        >
                            {previewing ? "Previewing..." : "Preview Targets"}
                        </button>
                    </form>

                    {error && (
                        <p role="alert" className="mt-4 rounded-xl bg-red-50 p-4 text-sm text-red-700">
                            {error}
                        </p>
                    )}
                    {notice && (
                        <p role="status" className="mt-4 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-800">
                            {notice}
                        </p>
                    )}

                    {preview && (
                        <div className="mt-5 space-y-4">
                            <p className="text-sm font-bold">
                                Matched users: {preview.targetCount}
                            </p>
                            {preview.filter?.onlyNotUpdated && (
                                <p className="text-sm text-slate-500">
                                    {preview.latestVersionCode
                                        ? `Latest version: ${preview.latestVersionName || ""} (code ${preview.latestVersionCode}). Only users below it, plus users with no reported version, match.`
                                        : "Latest version: not set anywhere — only users with no reported version match."}
                                </p>
                            )}
                            <form onSubmit={create} className="space-y-4">
                                <label className="block text-sm font-bold">
                                    Title
                                    <input
                                        value={title}
                                        onChange={(event) => setTitle(event.target.value)}
                                        minLength={2}
                                        maxLength={80}
                                        required
                                        className="mt-2 w-full rounded-xl border p-3 font-normal"
                                    />
                                </label>
                                <label className="block text-sm font-bold">
                                    Message
                                    <textarea
                                        value={body}
                                        onChange={(event) => setBody(event.target.value)}
                                        minLength={2}
                                        maxLength={1000}
                                        required
                                        rows={4}
                                        className="mt-2 w-full rounded-xl border p-3 font-normal"
                                    />
                                </label>
                                <button
                                    type="submit"
                                    disabled={creating || preview.targetCount < 1}
                                    className="w-full rounded-xl bg-[#087F5B] p-3 font-bold text-white disabled:opacity-50"
                                >
                                    {creating
                                        ? "Creating..."
                                        : confirming
                                          ? `Click again to confirm — send to ${preview.targetCount} user(s)`
                                          : `Create for ${preview.targetCount} user(s)`}
                                </button>
                            </form>
                        </div>
                    )}
                </section>

                {list.length > 0 && (
                    <section className="rounded-2xl bg-white p-5 shadow-sm">
                        <h3 className="font-extrabold">Announcements</h3>
                        <div className="mt-4 divide-y">
                            {list.map((item) => (
                                <div key={item.id} className="py-4">
                                    <p className="font-bold">{item.title}</p>
                                    <p className="text-sm text-slate-500">{item.body}</p>
                                    <p className="mt-1 text-xs text-slate-500">
                                        {new Date(item.createdAt).toLocaleString()} · Targets:{" "}
                                        {item.targetCount} · Read: {item.readCount} ·{" "}
                                        {item.active ? "Active" : "Inactive"}
                                    </p>
                                    <button
                                        type="button"
                                        onClick={() => toggle(item)}
                                        className="mt-2 rounded-xl bg-slate-100 px-4 py-2 text-xs font-bold text-slate-700"
                                    >
                                        {item.active ? "Deactivate" : "Activate"}
                                    </button>
                                </div>
                            ))}
                        </div>
                    </section>
                )}
            </div>
        </AdminShell>
    );
}
