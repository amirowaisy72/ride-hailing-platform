"use client";

import { useState, useEffect } from "react";
import { Bell, Search, Send, UserRound } from "lucide-react";
import AdminShell from "@/components/AdminShell";
import { authenticatedAdminRequest } from "@/lib/adminSession";

export default function CustomNotificationsPage() {
    const [query, setQuery] = useState("");
    const [users, setUsers] = useState([]);
    const [selected, setSelected] = useState(null);
    const [title, setTitle] = useState("");
    const [body, setBody] = useState("");
    const [searching, setSearching] = useState(false);
    const [sending, setSending] = useState(false);
    const [error, setError] = useState("");
    const [message, setMessage] = useState("");

    // Bulk send state (new section; the single-user section above is untouched).
    const [bulkAudience, setBulkAudience] = useState("ALL");
    const [bulkLastHours, setBulkLastHours] = useState("");
    const [bulkDocuments, setBulkDocuments] = useState("ALL");
    const [bulkNotNotifiedHours, setBulkNotNotifiedHours] = useState("");
    const [bulkOnlyNotUpdated, setBulkOnlyNotUpdated] = useState(false);
    const [bulkTitle, setBulkTitle] = useState("");
    const [bulkBody, setBulkBody] = useState("");
    const [bulkPreview, setBulkPreview] = useState(null);
    const [bulkPreviewing, setBulkPreviewing] = useState(false);
    const [bulkSending, setBulkSending] = useState(false);
    const [bulkError, setBulkError] = useState("");
    const [bulkMessage, setBulkMessage] = useState("");
    const [bulkHistory, setBulkHistory] = useState([]);

    function bulkFilters() {
        return {
            audience: bulkAudience,
            lastHours: bulkLastHours === "" ? null : Number(bulkLastHours),
            driverDocuments: bulkDocuments,
            onlyNotBulkNotified: false,
            onlyNotUpdated: bulkOnlyNotUpdated,
            notNotifiedInLastHours:
                bulkNotNotifiedHours === "" ? null : Number(bulkNotNotifiedHours),
        };
    }

    async function loadBulkHistory() {
        try {
            const result = await authenticatedAdminRequest(
                "/admin/notifications/bulk/history"
            );
            setBulkHistory(result.history || []);
        } catch (err) {
            // History is informational; a failed load must not block sending.
        }
    }

    useEffect(() => {
        loadBulkHistory();
    }, []);

    async function previewBulk(event) {
        event.preventDefault();
        setBulkPreviewing(true);
        setBulkError("");
        setBulkMessage("");
        setBulkPreview(null);
        try {
            const result = await authenticatedAdminRequest(
                "/admin/notifications/bulk/preview",
                { method: "POST", body: JSON.stringify(bulkFilters()) }
            );
            setBulkPreview(result);
        } catch (err) {
            setBulkError(err.message);
        } finally {
            setBulkPreviewing(false);
        }
    }

    async function sendBulk(event) {
        event.preventDefault();
        if (!bulkPreview || bulkPreview.pushEnabledCount < 1) {
            setBulkError("Preview recipients first, and make sure at least one push-enabled user matches.");
            return;
        }
        if (
            !window.confirm(
                `Send this notification to ${Math.min(bulkPreview.pushEnabledCount, bulkPreview.sendLimit)} user(s)?`
            )
        ) {
            return;
        }
        setBulkSending(true);
        setBulkError("");
        setBulkMessage("");
        try {
            const result = await authenticatedAdminRequest(
                "/admin/notifications/bulk/send",
                {
                    method: "POST",
                    body: JSON.stringify({
                        ...bulkFilters(),
                        title: bulkTitle.trim(),
                        body: bulkBody.trim(),
                    }),
                }
            );
            setBulkMessage(
                `${result.message} Attempted: ${result.recipientsAttempted}; successful devices: ${result.delivery.successCount}; failed: ${result.delivery.failureCount}; skipped (no device): ${result.skippedNoDeviceCount}.`
            );
            setBulkPreview(null);
            setBulkTitle("");
            setBulkBody("");
            loadBulkHistory();
        } catch (err) {
            setBulkError(err.message);
        } finally {
            setBulkSending(false);
        }
    }

    async function searchUsers(event) {
        event.preventDefault();
        if (query.trim().length < 2) {
            setError("Enter at least 2 characters to search.");
            return;
        }

        setSearching(true);
        setError("");
        setMessage("");
        setSelected(null);
        setUsers([]);

        try {
            const result = await authenticatedAdminRequest(
                `/admin/notifications/users?q=${encodeURIComponent(query.trim())}`
            );
            setUsers(result.users || []);
        } catch (err) {
            setError(err.message);
        } finally {
            setSearching(false);
        }
    }

    async function sendNotification(event) {
        event.preventDefault();

        if (!selected || selected.pushDevices < 1) {
            setError("Select a user with a registered push-enabled device.");
            return;
        }

        setSending(true);
        setError("");
        setMessage("");

        try {
            const result = await authenticatedAdminRequest(
                "/admin/notifications/send",
                {
                    method: "POST",
                    body: JSON.stringify({
                        userId: selected.id,
                        title: title.trim(),
                        body: body.trim(),
                    }),
                }
            );

            setMessage(
                `${result.message} Successful devices: ${result.delivery.successCount}; failed: ${result.delivery.failureCount}.`
            );
            setTitle("");
            setBody("");
        } catch (err) {
            setError(err.message);
        } finally {
            setSending(false);
        }
    }

    return (
        <AdminShell title="Custom Notifications">
            <div className="mx-auto max-w-4xl space-y-6">
                <section className="rounded-2xl bg-white p-6 shadow-sm">
                    <div className="flex items-center gap-3">
                        <Bell className="text-[#087F5B]" size={27} />
                        <div>
                            <h2 className="text-xl font-extrabold">
                                Send Native Push Notification
                            </h2>
                            <p className="mt-1 text-sm text-slate-500">
                                Search for a specific account and send it a custom message.
                            </p>
                        </div>
                    </div>

                    <form onSubmit={searchUsers} className="mt-6 flex gap-3">
                        <input
                            value={query}
                            onChange={(event) => setQuery(event.target.value)}
                            placeholder="Search by user name or email"
                            minLength={2}
                            maxLength={100}
                            required
                            className="min-w-0 flex-1 rounded-xl border p-3"
                        />
                        <button
                            type="submit"
                            disabled={searching}
                            className="flex items-center gap-2 rounded-xl bg-[#087F5B] px-4 py-3 font-bold text-white disabled:opacity-50"
                        >
                            <Search size={18} />
                            {searching ? "Searching..." : "Search"}
                        </button>
                    </form>
                </section>

                {error && (
                    <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-700">
                        {error}
                    </p>
                )}

                {message && (
                    <p role="status" className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-800">
                        {message}
                    </p>
                )}

                {users.length > 0 && (
                    <section className="rounded-2xl bg-white p-5 shadow-sm">
                        <h3 className="font-extrabold">
                            Search Results ({users.length})
                        </h3>

                        <div className="mt-4 divide-y">
                            {users.map((user) => (
                                <div
                                    key={user.id}
                                    className="flex flex-wrap items-center gap-3 py-4"
                                >
                                    <UserRound className="text-[#087F5B]" size={22} />

                                    <div className="min-w-0 flex-1">
                                        <p className="font-bold">{user.name}</p>
                                        <p className="break-all text-sm text-slate-500">
                                            {user.email}
                                        </p>
                                        <p className="mt-1 text-xs text-slate-500">
                                            {user.role} · {user.pushDevices} registered device(s)
                                        </p>
                                    </div>

                                    <button
                                        type="button"
                                        disabled={user.pushDevices < 1}
                                        onClick={() => {
                                            setSelected(user);
                                            setError("");
                                            setMessage("");
                                        }}
                                        className={`rounded-xl px-4 py-2 text-sm font-bold ${selected?.id === user.id
                                            ? "bg-slate-900 text-white"
                                            : "bg-emerald-50 text-[#087F5B]"
                                            } disabled:cursor-not-allowed disabled:opacity-40`}
                                    >
                                        {user.pushDevices < 1
                                            ? "No Device"
                                            : selected?.id === user.id
                                                ? "Selected"
                                                : "Select User"}
                                    </button>
                                </div>
                            ))}
                        </div>
                    </section>
                )}

                {selected && (
                    <section className="rounded-2xl bg-white p-6 shadow-sm">
                        <h3 className="text-lg font-extrabold">
                            Send to {selected.name}
                        </h3>
                        <p className="mt-1 text-sm text-slate-500">
                            {selected.email} · {selected.pushDevices} registered device(s)
                        </p>

                        <form onSubmit={sendNotification} className="mt-5 space-y-4">
                            <label className="block text-sm font-bold">
                                Notification Title
                                <input
                                    value={title}
                                    onChange={(event) => setTitle(event.target.value)}
                                    minLength={2}
                                    maxLength={80}
                                    required
                                    placeholder="Action required: complete your profile"
                                    className="mt-2 w-full rounded-xl border p-3 font-normal"
                                />
                            </label>

                            <label className="block text-sm font-bold">
                                Notification Message
                                <textarea
                                    value={body}
                                    onChange={(event) => setBody(event.target.value)}
                                    minLength={2}
                                    maxLength={240}
                                    required
                                    rows={4}
                                    placeholder="Please upload your required documents to complete driver verification."
                                    className="mt-2 w-full rounded-xl border p-3 font-normal"
                                />
                            </label>

                            <button
                                type="submit"
                                disabled={sending || selected.pushDevices < 1}
                                className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#087F5B] p-3 font-bold text-white disabled:opacity-50"
                            >
                                <Send size={18} />
                                {sending ? "Sending..." : "Send Push Notification"}
                            </button>
                        </form>
                    </section>
                )}

                <section className="rounded-2xl bg-white p-6 shadow-sm">
                    <div className="flex items-center gap-3">
                        <Bell className="text-[#087F5B]" size={27} />
                        <div>
                            <h2 className="text-xl font-extrabold">
                                Send Bulk Push Notification
                            </h2>
                            <p className="mt-1 text-sm text-slate-500">
                                Filter people, preview who will receive it, then send.
                                Max 500 push-enabled recipients per bulk send.
                            </p>
                        </div>
                    </div>

                    <form onSubmit={previewBulk} className="mt-6 space-y-4">
                        <label className="block text-sm font-bold">
                            Audience
                            <select
                                value={bulkAudience}
                                onChange={(event) => setBulkAudience(event.target.value)}
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
                                value={bulkLastHours}
                                onChange={(event) => setBulkLastHours(event.target.value)}
                                placeholder="e.g. 8"
                                className="mt-2 w-full rounded-xl border p-3 font-normal"
                            />
                        </label>

                        <label className="block text-sm font-bold">
                            Driver documents
                            <select
                                value={bulkDocuments}
                                onChange={(event) => setBulkDocuments(event.target.value)}
                                className="mt-2 w-full rounded-xl border p-3 font-normal"
                            >
                                <option value="ALL">Any document status</option>
                                <option value="NO_DOCUMENTS">No documents uploaded yet</option>
                            </select>
                        </label>

                        <label className="block text-sm font-bold">
                            Only users NOT notified in last hours (leave empty for no such filter)
                            <input
                                type="number"
                                min="1"
                                max="720"
                                value={bulkNotNotifiedHours}
                                onChange={(event) => setBulkNotNotifiedHours(event.target.value)}
                                placeholder="e.g. 8"
                                className="mt-2 w-full rounded-xl border p-3 font-normal"
                            />
                            <span className="block font-normal text-slate-500">
                                Users never notified before are included, because they
                                have no last notification. Only the latest notification
                                per user is stored, so this uses almost no database.
                            </span>
                        </label>

                        <label className="flex items-start gap-3 text-sm font-bold">
                            <input
                                type="checkbox"
                                checked={bulkOnlyNotUpdated}
                                onChange={(event) => setBulkOnlyNotUpdated(event.target.checked)}
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
                            disabled={bulkPreviewing}
                            className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 p-3 font-bold text-white disabled:opacity-50"
                        >
                            {bulkPreviewing ? "Previewing..." : "Preview Recipients"}
                        </button>
                    </form>

                    {bulkError && (
                        <p role="alert" className="mt-4 rounded-xl bg-red-50 p-4 text-sm text-red-700">
                            {bulkError}
                        </p>
                    )}

                    {bulkMessage && (
                        <p role="status" className="mt-4 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-800">
                            {bulkMessage}
                        </p>
                    )}

                    {bulkPreview && (
                        <div className="mt-5 space-y-4">
                            <p className="text-sm font-bold">
                                Matched: {bulkPreview.totalMatched} · Push-enabled:{" "}
                                {bulkPreview.pushEnabledCount} · Skipped (no device):{" "}
                                {bulkPreview.skippedNoDeviceCount}
                            </p>
                            {bulkPreview.filter?.onlyNotUpdated && (
                                <p className="text-sm text-slate-500">
                                    {bulkPreview.latestVersionCode
                                        ? `Latest version: ${bulkPreview.latestVersionName || ""} (code ${bulkPreview.latestVersionCode}). Only users below it, plus users with no reported version, match.`
                                        : "Latest version: not set anywhere — only users with no reported version match."}
                                </p>
                            )}
                            {bulkPreview.sample.length > 0 && (
                                <div className="divide-y rounded-xl border">
                                    {bulkPreview.sample.map((user) => (
                                        <div key={user.id} className="flex flex-wrap items-center gap-3 p-3">
                                            <div className="min-w-0 flex-1">
                                                <p className="font-bold">{user.name}</p>
                                                <p className="break-all text-sm text-slate-500">{user.email}</p>
                                                <p className="mt-1 text-xs text-slate-500">
                                                    {user.role} · {user.pushDevices} registered device(s)
                                                </p>
                                                <p className="mt-1 text-xs text-slate-500">
                                                    {user.lastNotification
                                                        ? `Last notification: ${new Date(user.lastNotification.sentAt).toLocaleString()} — ${user.lastNotification.title}`
                                                        : "Last notification: none yet"}
                                                </p>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                            <form onSubmit={sendBulk} className="space-y-4">
                                <label className="block text-sm font-bold">
                                    Notification Title
                                    <input
                                        value={bulkTitle}
                                        onChange={(event) => setBulkTitle(event.target.value)}
                                        minLength={2}
                                        maxLength={80}
                                        required
                                        className="mt-2 w-full rounded-xl border p-3 font-normal"
                                    />
                                </label>
                                <label className="block text-sm font-bold">
                                    Notification Message
                                    <textarea
                                        value={bulkBody}
                                        onChange={(event) => setBulkBody(event.target.value)}
                                        minLength={2}
                                        maxLength={240}
                                        required
                                        rows={4}
                                        className="mt-2 w-full rounded-xl border p-3 font-normal"
                                    />
                                </label>
                                <button
                                    type="submit"
                                    disabled={bulkSending || bulkPreview.pushEnabledCount < 1}
                                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#087F5B] p-3 font-bold text-white disabled:opacity-50"
                                >
                                    <Send size={18} />
                                    {bulkSending
                                        ? "Sending..."
                                        : `Send to ${Math.min(bulkPreview.pushEnabledCount, bulkPreview.sendLimit)} user(s)`}
                                </button>
                            </form>
                        </div>
                    )}
                </section>

                {bulkHistory.length > 0 && (
                    <section className="rounded-2xl bg-white p-5 shadow-sm">
                        <h3 className="font-extrabold">Bulk Send History</h3>
                        <div className="mt-4 divide-y">
                            {bulkHistory.map((item) => (
                                <div key={item.id} className="py-4">
                                    <p className="font-bold">{item.title}</p>
                                    <p className="text-sm text-slate-500">{item.body}</p>
                                    <p className="mt-1 text-xs text-slate-500">
                                        {new Date(item.sentAt).toLocaleString()} · Attempted:{" "}
                                        {item.recipientsAttempted} · Notified: {item.notifiedCount} ·
                                        Successful devices: {item.successCount} · Failed:{" "}
                                        {item.failureCount} · Skipped (no device):{" "}
                                        {item.skippedNoDeviceCount}
                                    </p>
                                </div>
                            ))}
                        </div>
                    </section>
                )}

                <p className="text-xs leading-5 text-slate-500">
                    The recipient must have Safar installed, notifications permitted,
                    and a registered device. Native system notifications are shown by
                    Android when the app is in the background; foreground behavior
                    remains governed by the app's existing notification handling.
                </p>
            </div>
        </AdminShell>
    );
}