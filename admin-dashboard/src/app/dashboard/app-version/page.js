"use client";

import { useEffect, useState } from "react";
import AdminShell from "@/components/AdminShell";
import { authenticatedAdminRequest } from "@/lib/adminSession";

export default function AppVersionPage() {
    const [code, setCode] = useState("");
    const [name, setName] = useState("");
    const [message, setMessage] = useState("");
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const [usage, setUsage] = useState(null);
    const [usageError, setUsageError] = useState("");

    useEffect(() => {
        (async () => {
            try {
                const result = await authenticatedAdminRequest(
                    "/admin/app-version"
                );
                if (result.configured) {
                    setCode(String(result.latestVersionCode));
                    setName(result.latestVersionName || "");
                    setMessage(result.message || "");
                }
            } catch (err) {
                setError(err.message);
            } finally {
                setLoading(false);
            }
        })();
    }, []);

    useEffect(() => {
        (async () => {
            try {
                const result = await authenticatedAdminRequest(
                    "/admin/app-version/usage"
                );
                setUsage(result);
            } catch (err) {
                setUsageError(err.message);
            }
        })();
    }, []);

    async function save(event) {
        event.preventDefault();
        setSaving(true);
        setError("");
        setNotice("");
        try {
            await authenticatedAdminRequest("/admin/app-version", {
                method: "PUT",
                body: JSON.stringify({
                    latestVersionCode: Number(code),
                    latestVersionName: name.trim(),
                    message: message.trim(),
                }),
            });
            setNotice(
                "Saved. Users on an older app version will now see the update popup on every app launch until they update."
            );
        } catch (err) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    }

    return (
        <AdminShell title="App Version">
            <div className="mx-auto max-w-2xl space-y-6">
                <section className="rounded-2xl bg-white p-6 shadow-sm">
                    <h2 className="text-xl font-extrabold">App Update Version</h2>
                    <p className="mt-1 text-sm text-slate-500">
                        Set this AFTER a new version goes live on Play Store.
                        Users on an older version will see an update popup on
                        every app launch, with an Update button that opens
                        Safar&apos;s Play Store page. Cancel (Later) only hides
                        it for that session — it returns on the next launch
                        until they update. The popup never blocks the app.
                    </p>

                    {loading ? (
                        <p className="mt-6 text-sm text-slate-500">Loading...</p>
                    ) : (
                        <form onSubmit={save} className="mt-6 space-y-4">
                            <label className="block text-sm font-bold">
                                Latest version code (number, e.g. 6)
                                <input
                                    type="number"
                                    min="1"
                                    value={code}
                                    onChange={(event) => setCode(event.target.value)}
                                    required
                                    className="mt-2 w-full rounded-xl border p-3 font-normal"
                                />
                            </label>
                            <label className="block text-sm font-bold">
                                Latest version name (e.g. 1.0.4)
                                <input
                                    value={name}
                                    onChange={(event) => setName(event.target.value)}
                                    maxLength={50}
                                    required
                                    className="mt-2 w-full rounded-xl border p-3 font-normal"
                                />
                            </label>
                            <label className="block text-sm font-bold">
                                Popup message (optional, shown in the app)
                                <textarea
                                    value={message}
                                    onChange={(event) => setMessage(event.target.value)}
                                    maxLength={240}
                                    rows={3}
                                    className="mt-2 w-full rounded-xl border p-3 font-normal"
                                />
                            </label>
                            <button
                                type="submit"
                                disabled={saving}
                                className="w-full rounded-xl bg-[#087F5B] p-3 font-bold text-white disabled:opacity-50"
                            >
                                {saving ? "Saving..." : "Save"}
                            </button>
                        </form>
                    )}

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
                </section>

                <section className="rounded-2xl bg-white p-6 shadow-sm">
                    <h2 className="text-xl font-extrabold">Users by app version</h2>
                    <p className="mt-1 text-sm text-slate-500">
                        Counted from the version each user&apos;s app last
                        reported on launch. Users on builds older than this
                        reporting feature show as Unknown until they update
                        to a reporting build.
                    </p>

                    {usageError && (
                        <p role="alert" className="mt-4 rounded-xl bg-red-50 p-4 text-sm text-red-700">
                            {usageError}
                        </p>
                    )}

                    {!usage && !usageError && (
                        <p className="mt-4 text-sm text-slate-500">Loading…</p>
                    )}

                    {usage && (
                        <div className="mt-4">
                            <p className="text-sm text-slate-500">
                                {usage.reportedUsers} of {usage.totalUsers} users
                                reported a version · {usage.unknownUsers} unknown
                            </p>

                            <div className="mt-3 divide-y divide-slate-100">
                                {usage.versions.map((row) => {
                                    const share = usage.totalUsers
                                        ? Math.round((row.users / usage.totalUsers) * 100)
                                        : 0;
                                    return (
                                        <div
                                            key={row.appVersionCode}
                                            className="flex items-center justify-between gap-3 py-3"
                                        >
                                            <p className="font-bold">
                                                {row.appVersion}
                                                <span className="ml-2 text-xs font-normal text-slate-500">
                                                    code {row.appVersionCode}
                                                </span>
                                            </p>
                                            <p className="text-sm font-bold">
                                                {row.users} users · {share}%
                                            </p>
                                        </div>
                                    );
                                })}

                                {usage.unknownUsers > 0 && (
                                    <div className="flex items-center justify-between gap-3 py-3">
                                        <p className="font-bold">
                                            Unknown
                                            <span className="ml-2 text-xs font-normal text-slate-500">
                                                old builds, not reported yet
                                            </span>
                                        </p>
                                        <p className="text-sm font-bold">
                                            {usage.unknownUsers} users ·{" "}
                                            {usage.totalUsers
                                                ? Math.round((usage.unknownUsers / usage.totalUsers) * 100)
                                                : 0}
                                            %
                                        </p>
                                    </div>
                                )}

                                {usage.versions.length === 0 && usage.unknownUsers === 0 && (
                                    <p className="py-3 text-sm text-slate-500">
                                        No users yet.
                                    </p>
                                )}
                            </div>
                        </div>
                    )}
                </section>
            </div>
        </AdminShell>
    );
}
