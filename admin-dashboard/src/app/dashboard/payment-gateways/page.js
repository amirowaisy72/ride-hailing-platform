"use client";

import { useEffect, useState } from "react";
import AdminShell from "@/components/AdminShell";
import { authenticatedAdminRequest } from "@/lib/adminSession";

const PROVIDERS = ["JAZZCASH", "EASYPAISA", "UBL", "BANK_TRANSFER"];

export default function PaymentGatewaysPage() {
    const [provider, setProvider] = useState("JAZZCASH");
    const [environment, setEnvironment] = useState("TEST");
    const [credentials, setCredentials] = useState('{\n  "merchantId": "",\n  "password": "",\n  "integritySalt": "",\n  "paymentUrl": "",\n  "transactionType": "MWALLET"\n}');
    const [gateways, setGateways] = useState([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");
    const [message, setMessage] = useState("");

    async function loadGateways() {
        setLoading(true);
        setError("");
        try {
            const result = await authenticatedAdminRequest("/admin/payment-gateways");
            setGateways(result.gateways || []);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        loadGateways();
    }, []);

    async function saveGateway(event) {
        event.preventDefault();
        setSaving(true);
        setError("");
        setMessage("");

        try {
            const parsed = JSON.parse(credentials);
            if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
                throw new Error("Credentials valid JSON object honi chahiye.");
            }

            const result = await authenticatedAdminRequest(
                `/admin/payment-gateways/${provider}`,
                {
                    method: "PUT",
                    body: JSON.stringify({ environment, credentials: parsed }),
                }
            );

            setMessage(result.message || "Gateway credentials securely save ho gaye.");
            setCredentials("");
            await loadGateways();
        } catch (err) {
            setError(err instanceof SyntaxError ? "Credentials JSON format theek karein." : err.message);
        } finally {
            setSaving(false);
        }
    }

    return (
        <AdminShell title="Payment Gateways">
            <div className="mx-auto max-w-4xl space-y-6">
                <section className="rounded-2xl bg-white p-6 shadow-sm">
                    <h2 className="text-xl font-extrabold">Merchant Configuration</h2>
                    <p className="mt-2 text-sm text-slate-500">
                        Credentials encrypted save hongi. Save karne se gateway enable nahi hota.
                    </p>

                    <form onSubmit={saveGateway} className="mt-6 space-y-4">
                        <label className="block text-sm font-bold">
                            Payment Provider
                            <select
                                value={provider}
                                onChange={(e) => setProvider(e.target.value)}
                                className="mt-2 w-full rounded-xl border p-3"
                            >
                                {PROVIDERS.map((item) => (
                                    <option key={item} value={item}>
                                        {item.replaceAll("_", " ")}
                                    </option>
                                ))}
                            </select>
                        </label>

                        <label className="block text-sm font-bold">
                            Environment
                            <select
                                value={environment}
                                onChange={(e) => setEnvironment(e.target.value)}
                                className="mt-2 w-full rounded-xl border p-3"
                            >
                                <option value="TEST">Test / Sandbox</option>
                                <option value="LIVE">Live / Production</option>
                            </select>
                        </label>

                        <label className="block text-sm font-bold">
                            Merchant Credentials (JSON)
                            <textarea
                                value={credentials}
                                onChange={(e) => setCredentials(e.target.value)}
                                rows={7}
                                required
                                autoComplete="off"
                                spellCheck={false}
                                placeholder={'{"merchantId":"...","password":"...","integritySalt":"...","paymentUrl":"...","transactionType":"MWALLET"}'}
                                className="mt-2 w-full rounded-xl border p-3 font-mono text-sm"
                            />
                        </label>

                        <p className="text-xs text-amber-700">
                            Enter only real credentials issued by your payment provider.
                            Live activation requires successful provider verification.
                            Easypaisa and UBL checkout integration is not complete yet.
                        </p>

                        {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
                        {message && <p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">{message}</p>}

                        <button
                            type="submit"
                            disabled={saving || loading}
                            className="w-full rounded-xl bg-[#087F5B] px-5 py-3 font-bold text-white disabled:opacity-50"
                        >
                            {saving ? "Saving..." : "Save Credentials Securely"}
                        </button>
                    </form>
                </section>

                <section className="rounded-2xl bg-white p-6 shadow-sm">
                    <div className="flex items-center justify-between gap-3">
                        <h2 className="text-xl font-extrabold">Configured Gateways</h2>
                        <button onClick={loadGateways} disabled={loading} className="rounded-lg border px-3 py-2 text-sm font-semibold">
                            Refresh
                        </button>
                    </div>

                    {loading ? (
                        <p className="py-5 text-sm text-slate-500">Loading...</p>
                    ) : gateways.length === 0 ? (
                        <p className="py-5 text-sm text-slate-500">No gateways configured.</p>
                    ) : (
                        <div className="mt-4 divide-y">
                            {gateways.map((item) => (
                                <div key={item.provider} className="flex flex-wrap items-center justify-between gap-3 py-4">
                                    <div>
                                        <p className="font-bold">{item.provider.replaceAll("_", " ")}</p>
                                        <p className="text-xs text-slate-500">
                                            {item.environment} · {item.configured ? "Credentials saved" : "Not configured"}
                                        </p>
                                    </div>
                                    <span className={`rounded-lg px-3 py-1 text-xs font-bold ${item.verified ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
                                        {item.verified ? "Verified" : "Not verified"}
                                    </span>
                                </div>
                            ))}
                        </div>
                    )}
                </section>
            </div>
        </AdminShell>
    );
}