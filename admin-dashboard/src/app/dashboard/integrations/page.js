
"use client";

import { useEffect, useState } from "react";
import AdminShell from "@/components/AdminShell";
import { authenticatedAdminRequest } from "@/lib/adminSession";
import {
    Plug, ExternalLink, ShieldCheck, Server,
    Database, Mail, Map, GitBranch, Smartphone,
    Bell, Cloud, KeyRound,
} from "lucide-react";

const integrations = [
    {
        name: "OSRM Routing",
        purpose: "Driving routes, distance and ETA calculation",
        icon: Map,
        url: "https://project-osrm.org/",
    },
    {
        name: "OpenStreetMap Nominatim",
        purpose: "Address search and reverse geocoding",
        icon: Map,
        url: "https://nominatim.org/",
    },
    {
        name: "Firebase Authentication",
        purpose: "Google Sign-In and account authentication",
        icon: ShieldCheck,
        url: "https://console.firebase.google.com/",
    },
    {
        name: "Firebase Cloud Messaging",
        purpose: "Android push notifications",
        icon: Bell,
        url: "https://console.firebase.google.com/",
    },
    {
        name: "Google Cloud Console",
        purpose: "OAuth branding, credentials and APIs",
        icon: KeyRound,
        url: "https://console.cloud.google.com/",
    },
    {
        name: "Google Search Console",
        purpose: "Website ownership and verification",
        icon: ShieldCheck,
        url: "https://search.google.com/search-console",
    },
    {
        name: "Render",
        purpose: "Backend API, WebSocket and hosting",
        icon: Server,
        url: "https://dashboard.render.com/",
    },
    {
        name: "MongoDB",
        purpose: "Users, rides, parcels and application data",
        icon: Database,
        url: "https://cloud.mongodb.com/",
    },
    {
        name: "Gmail SMTP",
        purpose: "Email OTP delivery",
        icon: Mail,
        url: "https://myaccount.google.com/apppasswords",
    },
    {
        name: "Cloudinary",
        purpose: "Images and document uploads",
        icon: Cloud,
        url: "https://console.cloudinary.com/",
    },
    {
        name: "MapLibre / Map Services",
        purpose: "Maps, location and route visualization",
        icon: Map,
        url: "https://maplibre.org/",
    },
    {
        name: "GitHub",
        purpose: "Source code and deployment integration",
        icon: GitBranch,
        url: "https://github.com/",
    },
    {
        name: "Capacitor / Android",
        purpose: "Native APK, permissions and device features",
        icon: Smartphone,
        url: "https://capacitorjs.com/",
    },
];

export default function IntegrationsPage() {
    const [statuses, setStatuses] = useState({});
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(true);
    const [settings, setSettings] = useState([]);
    const [savingKey, setSavingKey] = useState(null);
    const [auditLogs, setAuditLogs] = useState([]);

    async function loadAuditLogs() {
        try {
            const data = await authenticatedAdminRequest(
                "/admin/integrations/audit-logs"
            );
            setAuditLogs(data.logs || []);
        } catch (err) {
            setError(err.message);
        }
    }

    async function loadSettings() {
        try {
            const data = await authenticatedAdminRequest("/admin/integrations/settings");
            setSettings(data.settings || []);
        } catch (err) {
            setError(err.message);
        }
    }

    async function toggleIntegration(key, enabled) {
        if (!window.confirm(
            `Are you sure you want to turn ${enabled ? "ON" : "OFF"} ${key.replaceAll("-", " ")}?`
        )) return;

        setSavingKey(key);
        setError("");

        try {
            await authenticatedAdminRequest(`/admin/integrations/settings/${key}`, {
                method: "PATCH",
                body: JSON.stringify({ enabled }),
            });
            await loadSettings();
            await loadAuditLogs();
        } catch (err) {
            setError(err.message);
        } finally {
            setSavingKey(null);
        }
    }

    async function refreshIntegrations() {
        setLoading(true);
        setError("");
        await Promise.all([loadSettings(), loadAuditLogs()]);

        try {
            const data = await authenticatedAdminRequest("/admin/integrations");
            const next = {};

            for (const item of data.integrations || []) {
                next[item.id] = item;
            }

            setStatuses(next);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        loadSettings();
        loadAuditLogs();

        authenticatedAdminRequest("/admin/integrations")
            .then((data) => {
                const next = {};
                for (const item of data.integrations || []) {
                    next[item.id] = item;
                }
                setStatuses(next);
            })
            .catch((err) => setError(err.message))
            .finally(() => setLoading(false));
    }, []);

    const ids = {
        "Firebase Authentication": "firebase",
        "Firebase Cloud Messaging": "firebase",
        "Google Cloud Console": "google-oauth",
        "Google Search Console": "search-console",
        "Render": "render",
        "MongoDB": "mongodb",
        "OSRM Routing": "osrm",
        "OpenStreetMap Nominatim": "nominatim",
        "Gmail SMTP": "smtp",
        "Cloudinary": "cloudinary",
        "MapLibre / Map Services": "maplibre",
        "GitHub": "github",
        "Capacitor / Android": "capacitor",
    };

    return (
        <AdminShell title="Integrations">
            <div className="space-y-6">
                {error && (
                    <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                        API Error: {error}
                    </div>
                )}
                <section className="rounded-3xl bg-white p-6 shadow-sm">
                    <div className="mb-5 flex justify-end">
                        <button
                            type="button"
                            onClick={refreshIntegrations}
                            disabled={loading}
                            className="rounded-xl bg-[#087F5B] px-5 py-3 text-sm font-bold text-white disabled:opacity-50"
                        >
                            {loading ? "Checking..." : "↻ Refresh Status"}
                        </button>
                    </div>
                    <div className="flex items-center gap-3">
                        <div className="rounded-2xl bg-emerald-50 p-3">
                            <Plug className="text-[#087F5B]" size={25} />
                        </div>
                        <div>
                            <h1 className="text-2xl font-extrabold">
                                Integrations Control Center
                            </h1>
                            <p className="mt-1 text-sm text-slate-500">
                                Manage Safar's external services and infrastructure.
                            </p>
                        </div>
                    </div>

                    <div className="mt-6 rounded-xl bg-slate-50 p-4">
                        <p className="text-sm font-semibold text-slate-700">
                            {integrations.length} integrations listed ·{" "}
                            {Object.values(statuses).filter((item) => item.configured).length} configured
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                            Configuration monitoring, service controls and audit history.
                        </p>
                    </div>
                </section>

                <section className="rounded-3xl bg-white p-6 shadow-sm">
                    <h2 className="text-xl font-bold">Integration Controls</h2>

                    <div className="mt-5 divide-y">
                        {settings.map((setting) => (
                            <div
                                key={setting.key}
                                className="flex items-center justify-between gap-4 py-4"
                            >
                                <div>
                                    <p className="font-semibold capitalize">
                                        {setting.key.replaceAll("-", " ")}
                                    </p>
                                    <p className="text-xs text-slate-500">
                                        {setting.key === "google-login"
                                            ? "Controls Google Sign-In"
                                            : setting.key === "push-notifications"
                                                ? "Controls Firebase push notifications"
                                                : "Controls OTP email delivery"}
                                    </p>
                                </div>

                                <button
                                    type="button"
                                    role="switch"
                                    aria-checked={setting.enabled}
                                    disabled={savingKey !== null}
                                    onClick={() =>
                                        toggleIntegration(setting.key, !setting.enabled)
                                    }
                                    className={`rounded-xl px-5 py-2 font-bold text-white disabled:opacity-50 ${setting.enabled ? "bg-[#087F5B]" : "bg-slate-500"
                                        }`}
                                >
                                    {savingKey === setting.key
                                        ? "Saving..."
                                        : setting.enabled ? "ON" : "OFF"}
                                </button>
                            </div>
                        ))}
                    </div>
                </section>

                <section className="rounded-3xl bg-white p-6 shadow-sm">
                    <h2 className="text-xl font-bold">Integration Audit Logs</h2>

                    <div className="mt-5 overflow-x-auto">
                        <table className="w-full text-left text-sm">
                            <thead>
                                <tr className="border-b text-slate-500">
                                    <th className="p-3">Integration</th>
                                    <th className="p-3">Change</th>
                                    <th className="p-3">Admin</th>
                                    <th className="p-3">Date</th>
                                </tr>
                            </thead>
                            <tbody>
                                {auditLogs.map((log) => (
                                    <tr key={log._id} className="border-b">
                                        <td className="p-3">{log.integration}</td>
                                        <td className="p-3">
                                            {log.previousValue ? "ON" : "OFF"}
                                            {" → "}
                                            {log.newValue ? "ON" : "OFF"}
                                        </td>
                                        <td className="p-3">
                                            {log.performedBy?.email || "Unknown"}
                                        </td>
                                        <td className="p-3">
                                            {new Date(log.createdAt).toLocaleString()}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>

                        {auditLogs.length === 0 && (
                            <p className="py-6 text-center text-slate-500">
                                No integration changes recorded yet.
                            </p>
                        )}
                    </div>
                </section>

                <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {integrations.map((item) => {
                        const Icon = item.icon;

                        return (
                            <article
                                key={item.name}
                                className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm"
                            >
                                <div className="flex items-start justify-between">
                                    <div className="rounded-xl bg-emerald-50 p-3">
                                        {Icon ? <Icon size={22} className="text-[#087F5B]" /> : <Plug size={22} className="text-[#087F5B]" />}
                                    </div>
                                    <span className="rounded-lg bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                                        {loading
                                            ? "Checking..."
                                            : !statuses[ids[item.name]]
                                                ? "Not checked"
                                                : statuses[ids[item.name]].healthy === false
                                                    ? "Disconnected"
                                                    : statuses[ids[item.name]].healthy === true
                                                        ? "Connected"
                                                        : statuses[ids[item.name]].initialized
                                                            ? "Initialized"
                                                            : statuses[ids[item.name]].configured
                                                                ? "Configured"
                                                                : "Not configured"}
                                    </span>
                                </div>

                                <h2 className="mt-4 font-bold">
                                    {item.name}
                                </h2>

                                {statuses[ids[item.name]]?.healthNote && (
                                    <p className="mt-2 text-xs text-slate-500">
                                        {statuses[ids[item.name]].healthNote}
                                    </p>
                                )}

                                <p className="mt-2 min-h-12 text-sm text-slate-500">
                                    {item.purpose}
                                </p>

                                <a
                                    href={item.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="mt-4 inline-flex items-center gap-2 text-sm font-bold text-[#087F5B]"
                                >
                                    Open Dashboard
                                    <ExternalLink size={15} />
                                </a>
                            </article>
                        );
                    })}
                </section>
            </div>
        </AdminShell>
    );
}
