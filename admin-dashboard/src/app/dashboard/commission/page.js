
"use client";

import { useCallback, useEffect, useState } from "react";
import {
    BadgeCheck,
    CircleAlert,
    CircleDollarSign,
    LoaderCircle,
    Percent,
    RefreshCw,
    Save,
    ShieldCheck,
    Wallet,
} from "lucide-react";

import AdminShell from "@/components/AdminShell";
import { authenticatedAdminRequest } from "@/lib/adminSession";

export default function CommissionPage() {
    const [percentage, setPercentage] = useState("");
    const [minimumWalletBalance, setMinimumWalletBalance] =
        useState("0");
    const [isActive, setIsActive] = useState(true);

    const [configured, setConfigured] = useState(false);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");
    const [message, setMessage] = useState("");

    const loadSettings = useCallback(async () => {
        setLoading(true);
        setError("");

        try {
            const data = await authenticatedAdminRequest(
                "/admin/commission"
            );

            const settings = data.settings;

            if (settings) {
                setPercentage(String(settings.percentage));
                setMinimumWalletBalance(
                    String(settings.minimumWalletBalance ?? 0)
                );
                setIsActive(Boolean(settings.isActive));
                setConfigured(true);
            } else {
                setPercentage("");
                setMinimumWalletBalance("0");
                setIsActive(true);
                setConfigured(false);
            }
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadSettings();
    }, [loadSettings]);

    async function saveSettings(event) {
        event.preventDefault();

        if (saving) return;

        const rate = Number(percentage);
        const balance = Number(minimumWalletBalance);

        if (
            percentage.trim() === "" ||
            !Number.isFinite(rate) ||
            rate < 0 ||
            rate > 100 ||
            !Number.isInteger(rate * 100)
        ) {
            setError("Commission must be between 0 and 100 with at most two decimal places.");
            return;
        }

        if (
            minimumWalletBalance.trim() === "" ||
            !Number.isSafeInteger(balance) ||
            balance < 0
        ) {
            setError("Minimum wallet balance must be a valid non-negative integer.");
            return;
        }

        setSaving(true);
        setError("");
        setMessage("");

        try {
            const data = await authenticatedAdminRequest(
                "/admin/commission",
                {
                    method: "PUT",
                    body: JSON.stringify({
                        percentage: rate,
                        minimumWalletBalance: balance,
                        isActive,
                    }),
                }
            );

            setPercentage(String(data.settings.percentage));
            setMinimumWalletBalance(
                String(data.settings.minimumWalletBalance)
            );
            setIsActive(Boolean(data.settings.isActive));
            setConfigured(true);
            setMessage("Commission settings saved successfully.");
        } catch (err) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    }

    return (
        <AdminShell title="Commission Settings">
            <div className="mx-auto max-w-5xl space-y-6">
                <section className="rounded-[24px] border border-slate-100 bg-white p-6 shadow-sm">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                        <div>
                            <p className="text-xs font-bold uppercase tracking-widest text-[#087F5B]">
                                Financial Configuration
                            </p>
                            <h2 className="mt-2 text-2xl font-extrabold text-slate-900">
                                Platform Commission
                            </h2>
                            <p className="mt-2 max-w-xl text-sm leading-6 text-slate-500">
                                Configure the platform commission charged on completed
                                cash rides and the driver's minimum wallet balance.
                            </p>
                        </div>

                        <button
                            type="button"
                            onClick={loadSettings}
                            disabled={loading || saving}
                            className="flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700 disabled:opacity-50"
                        >
                            <RefreshCw
                                size={17}
                                className={loading ? "animate-spin" : ""}
                            />
                            Refresh
                        </button>
                    </div>
                </section>

                <div className="grid gap-5 md:grid-cols-3">
                    <div className="rounded-2xl bg-white p-5 shadow-sm">
                        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-50 text-[#087F5B]">
                            <Percent size={23} />
                        </div>
                        <p className="mt-4 text-sm text-slate-500">
                            Commission Rate
                        </p>
                        <p className="mt-1 text-2xl font-extrabold">
                            {configured ? `${percentage}%` : "Not Set"}
                        </p>
                    </div>

                    <div className="rounded-2xl bg-white p-5 shadow-sm">
                        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                            <Wallet size={23} />
                        </div>
                        <p className="mt-4 text-sm text-slate-500">
                            Minimum Wallet Balance
                        </p>
                        <p className="mt-1 text-2xl font-extrabold">
                            PKR {Number(minimumWalletBalance || 0).toLocaleString("en-PK")}
                        </p>
                    </div>

                    <div className="rounded-2xl bg-white p-5 shadow-sm">
                        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
                            <ShieldCheck size={23} />
                        </div>
                        <p className="mt-4 text-sm text-slate-500">
                            Commission Status
                        </p>
                        <p className="mt-1 text-xl font-extrabold">
                            {!configured
                                ? "Not Configured"
                                : isActive
                                    ? "Active"
                                    : "Inactive"}
                        </p>
                    </div>
                </div>

                <form
                    onSubmit={saveSettings}
                    className="rounded-[24px] border border-slate-100 bg-white p-6 shadow-sm lg:p-8"
                >
                    <h3 className="text-xl font-extrabold">
                        Edit Commission Settings
                    </h3>

                    <p className="mt-2 text-sm text-slate-500">
                        All changes are saved to the platform database.
                    </p>

                    {loading ? (
                        <div className="flex items-center gap-3 py-12 text-sm text-slate-500">
                            <LoaderCircle
                                size={20}
                                className="animate-spin text-[#087F5B]"
                            />
                            Loading settings...
                        </div>
                    ) : (
                        <div className="mt-7 space-y-6">
                            <div>
                                <label
                                    htmlFor="commissionPercentage"
                                    className="mb-2 block text-sm font-bold"
                                >
                                    Commission Percentage
                                </label>

                                <div className="relative">
                                    <input
                                        id="commissionPercentage"
                                        type="number"
                                        min="0"
                                        max="100"
                                        step="0.01"
                                        required
                                        value={percentage}
                                        onChange={(e) => setPercentage(e.target.value)}
                                        placeholder="Example: 10"
                                        className="h-14 w-full rounded-xl border border-slate-200 px-4 pr-12 text-lg font-semibold outline-none focus:border-[#087F5B]"
                                    />
                                    <Percent
                                        size={20}
                                        className="absolute right-4 top-4 text-slate-400"
                                    />
                                </div>
                                <p className="mt-2 text-xs text-slate-500">
                                    Example: 10% commission on a PKR 1,000 ride equals PKR 100.
                                </p>
                            </div>

                            <div>
                                <label
                                    htmlFor="minimumBalance"
                                    className="mb-2 block text-sm font-bold"
                                >
                                    Minimum Driver Wallet Balance (PKR)
                                </label>

                                <div className="relative">
                                    <input
                                        id="minimumBalance"
                                        type="number"
                                        min="0"
                                        step="1"
                                        required
                                        value={minimumWalletBalance}
                                        onChange={(e) =>
                                            setMinimumWalletBalance(e.target.value)
                                        }
                                        className="h-14 w-full rounded-xl border border-slate-200 px-4 pr-12 text-lg font-semibold outline-none focus:border-[#087F5B]"
                                    />
                                    <Wallet
                                        size={20}
                                        className="absolute right-4 top-4 text-slate-400"
                                    />
                                </div>
                                <p className="mt-2 text-xs text-slate-500">
                                    Zero disables the minimum-balance threshold. Enforcement
                                    during driver matching is not yet enabled.
                                </p>
                            </div>

                            <div className="flex items-center justify-between gap-4 rounded-2xl bg-slate-50 p-5">
                                <div>
                                    <p className="font-bold">
                                        Enable Platform Commission
                                    </p>
                                    <p className="mt-1 text-xs leading-5 text-slate-500">
                                        Active settings allow settlement processing.
                                        Automatic deductions are not enabled yet.
                                    </p>
                                </div>

                                <button
                                    type="button"
                                    role="switch"
                                    aria-checked={isActive}
                                    aria-label="Enable platform commission"
                                    onClick={() => setIsActive((value) => !value)}
                                    className={`relative h-8 w-14 shrink-0 rounded-full transition ${isActive ? "bg-[#087F5B]" : "bg-slate-300"
                                        }`}
                                >
                                    <span
                                        className={`absolute top-1 h-6 w-6 rounded-full bg-white shadow transition-transform ${isActive ? "left-7" : "left-1"
                                            }`}
                                    />
                                </button>
                            </div>

                            {error && (
                                <p
                                    role="alert"
                                    className="flex items-center gap-2 rounded-xl bg-red-50 p-4 text-sm text-red-600"
                                >
                                    <CircleAlert size={18} />
                                    {error}
                                </p>
                            )}

                            {message && (
                                <p
                                    role="status"
                                    className="flex items-center gap-2 rounded-xl bg-emerald-50 p-4 text-sm font-semibold text-[#087F5B]"
                                >
                                    <BadgeCheck size={19} />
                                    {message}
                                </p>
                            )}

                            <button
                                type="submit"
                                disabled={saving || loading}
                                className="flex h-14 w-full items-center justify-center gap-2 rounded-xl bg-[#087F5B] px-5 font-bold text-white disabled:opacity-50"
                            >
                                {saving
                                    ? <LoaderCircle size={19} className="animate-spin" />
                                    : <Save size={19} />}
                                {saving ? "Saving..." : "Save Commission Settings"}
                            </button>
                        </div>
                    )}
                </form>

                <p className="text-xs leading-5 text-slate-500">
                    Changes affect future settlement calculations currently; the
                    commission rate is not yet snapshotted at ride acceptance.
                    Existing unsettled rides can therefore be affected by rate changes.
                </p>
            </div>
        </AdminShell>
    );
}
