"use client";

import { useState } from "react";
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

        if (!window.confirm(`Send this notification to ${selected.name}?`)) {
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