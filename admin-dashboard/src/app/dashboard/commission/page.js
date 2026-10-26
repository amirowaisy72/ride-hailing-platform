
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
    const [topUpRequired, setTopUpRequired] = useState(false);
    const [onlineTopUpEnabled, setOnlineTopUpEnabled] = useState(false);
    const [paymentGateway, setPaymentGateway] = useState("DISABLED");
    const [paymentEnvironment, setPaymentEnvironment] = useState("TEST");
    const [paymentReturnUrl, setPaymentReturnUrl] = useState("");
    const [paymentResultUrl, setPaymentResultUrl] = useState("");
    const [bankName, setBankName] = useState("");
    const [bankAccountTitle, setBankAccountTitle] = useState("");
    const [bankAccountNumber, setBankAccountNumber] = useState("");
    const [bankTransferNote, setBankTransferNote] = useState("");
    const [freeWaitingMinutes, setFreeWaitingMinutes] = useState("5");
    const [waitingChargePerMinute, setWaitingChargePerMinute] = useState("0");

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
                setTopUpRequired(settings.topUpRequired === true);
                setOnlineTopUpEnabled(settings.onlineTopUpEnabled === true);
                setPaymentGateway(settings.paymentGateway || "DISABLED");
                setPaymentEnvironment(settings.paymentEnvironment || "TEST");
                setPaymentReturnUrl(settings.paymentReturnUrl || "");
                setPaymentResultUrl(settings.paymentResultUrl || "");
                setBankName(settings.bankName || "");
                setBankAccountTitle(settings.bankAccountTitle || "");
                setBankAccountNumber(settings.bankAccountNumber || "");
                setBankTransferNote(settings.bankTransferNote || "");
                setFreeWaitingMinutes(String(settings.freeWaitingMinutes ?? 5));
                setWaitingChargePerMinute(String(settings.waitingChargePerMinute ?? 0));
                setConfigured(true);
            } else {
                setPercentage("");
                setMinimumWalletBalance("0");
                setIsActive(true);
                setTopUpRequired(false);
                setOnlineTopUpEnabled(false);
                setPaymentGateway("DISABLED");
                setPaymentEnvironment("TEST");
                setPaymentReturnUrl("");
                setPaymentResultUrl("");
                setBankName("");
                setBankAccountTitle("");
                setBankAccountNumber("");
                setBankTransferNote("");
                setFreeWaitingMinutes("5");
                setWaitingChargePerMinute("0");
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

        const freeMinutes = Number(freeWaitingMinutes);
        const chargePerMinute = Number(waitingChargePerMinute);

        if (
            freeWaitingMinutes.trim() === "" ||
            !Number.isInteger(freeMinutes) ||
            freeMinutes < 0 ||
            freeMinutes > 120 ||
            waitingChargePerMinute.trim() === "" ||
            !Number.isFinite(chargePerMinute) ||
            chargePerMinute < 0
        ) {
            setError("Enter valid waiting settings.");
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
                        freeWaitingMinutes: freeMinutes,
                        waitingChargePerMinute: chargePerMinute,
                        isActive,
                        topUpRequired,
                        onlineTopUpEnabled,
                        paymentGateway,
                        paymentEnvironment,
                        paymentReturnUrl,
                        paymentResultUrl,
                        bankName,
                        bankAccountTitle,
                        bankAccountNumber,
                        bankTransferNote,
                    }),
                }
            );

            setPercentage(String(data.settings.percentage));
            setMinimumWalletBalance(
                String(data.settings.minimumWalletBalance)
            );
            setIsActive(Boolean(data.settings.isActive));
            setTopUpRequired(data.settings.topUpRequired === true);
            setOnlineTopUpEnabled(data.settings.onlineTopUpEnabled === true);
            setPaymentGateway(data.settings.paymentGateway || "DISABLED");
            setPaymentEnvironment(data.settings.paymentEnvironment || "TEST");
            setPaymentReturnUrl(data.settings.paymentReturnUrl || "");
            setPaymentResultUrl(data.settings.paymentResultUrl || "");
            setBankName(data.settings.bankName || "");
            setBankAccountTitle(data.settings.bankAccountTitle || "");
            setBankAccountNumber(data.settings.bankAccountNumber || "");
            setBankTransferNote(data.settings.bankTransferNote || "");
            setFreeWaitingMinutes(String(data.settings.freeWaitingMinutes ?? 5));
            setWaitingChargePerMinute(String(data.settings.waitingChargePerMinute ?? 0));
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
            <section className="mx-auto mb-6 max-w-5xl rounded-2xl border border-slate-200 bg-white p-5">
                <div className="mb-5">
                    <label
                        htmlFor="paymentGateway"
                        className="mb-2 block text-sm font-bold text-slate-900"
                    >
                        Payment Gateway
                    </label>
                    <select
                        id="paymentGateway"
                        value={paymentGateway}
                        onChange={(e) => setPaymentGateway(e.target.value)}
                        disabled={loading || saving}
                        className="w-full rounded-xl border border-slate-300 bg-white p-3"
                    >
                        <option value="DISABLED">Disabled</option>
                        <option value="SANDBOX">Sandbox (Testing Only)</option>
                        <option value="JAZZCASH">JazzCash</option>
                        <option value="EASYPAISA">Easypaisa</option>
                        <option value="UBL">UBL Bank</option>
                        <option value="BANK_TRANSFER">Other Bank Transfer</option>
                    </select>
                    <p className="mt-2 text-xs text-slate-500">
                        Online top-up is disabled until secure payment verification is configured.
                    </p>
                </div>
                <div className="mb-5">
                    <label
                        htmlFor="paymentEnvironment"
                        className="mb-2 block text-sm font-bold text-slate-900"
                    >
                        Payment Environment
                    </label>
                    <select
                        id="paymentEnvironment"
                        value={paymentEnvironment}
                        onChange={(e) => setPaymentEnvironment(e.target.value)}
                        disabled={loading || saving}
                        className="w-full rounded-xl border border-slate-300 bg-white p-3"
                    >
                        <option value="TEST">Test / Sandbox</option>
                        <option value="LIVE">Live / Production</option>
                    </select>
                    <p className="mt-2 text-xs text-slate-500">
                        TEST sandbox credentials use hote hain. LIVE par switch
                        karne se pehle us environment ki credentials save aur
                        gateway enable karna zaroori hai — koi redeploy nahi chahiye.
                    </p>
                </div>
                <div className="mb-5">
                    <label
                        htmlFor="paymentReturnUrl"
                        className="mb-2 block text-sm font-bold text-slate-900"
                    >
                        Payment Return URL (Gateway Callback)
                    </label>
                    <input
                        id="paymentReturnUrl"
                        type="url"
                        value={paymentReturnUrl}
                        onChange={(e) => setPaymentReturnUrl(e.target.value)}
                        disabled={loading || saving}
                        placeholder="https://ride-hailing-api-tezd.onrender.com/api/v1/payments/jazzcash/callback"
                        className="w-full rounded-xl border border-slate-300 bg-white p-3"
                    />
                    <p className="mt-2 text-xs text-slate-500">
                        Khali chhorne par production callback URL default use
                        hota hai. EasyPaisa/UBL callbacks isi base se bante hain.
                    </p>
                </div>
                <div className="mb-5">
                    <label
                        htmlFor="paymentResultUrl"
                        className="mb-2 block text-sm font-bold text-slate-900"
                    >
                        Payment Result URL (Payment ke baad redirect)
                    </label>
                    <input
                        id="paymentResultUrl"
                        type="text"
                        value={paymentResultUrl}
                        onChange={(e) => setPaymentResultUrl(e.target.value)}
                        disabled={loading || saving}
                        placeholder="com.safar.ridehailing://driver/earnings"
                        className="w-full rounded-xl border border-slate-300 bg-white p-3"
                    />
                    <p className="mt-2 text-xs text-slate-500">
                        Driver app deep link ya HTTPS URL. Khali chhorne par
                        callback JSON response deta hai.
                    </p>
                </div>
                <div className="mb-5 rounded-xl border border-slate-200 p-4">
                    <h3 className="mb-1 text-sm font-extrabold text-slate-900">
                        Bank Transfer Receiving Account
                    </h3>
                    <p className="mb-4 text-xs text-slate-500">
                        Driver bank-transfer top-up isi account mein bheje ga.
                        Teeno fields (bank, title, number) bharne par hi bank
                        transfer method driver ko nazar aayega aur top-up
                        enforcement active count hoga.
                    </p>
                    <label
                        htmlFor="bankName"
                        className="mb-2 block text-sm font-bold text-slate-900"
                    >
                        Bank Name
                    </label>
                    <input
                        id="bankName"
                        type="text"
                        value={bankName}
                        onChange={(e) => setBankName(e.target.value)}
                        disabled={loading || saving}
                        placeholder="e.g. Meezan Bank"
                        className="mb-4 w-full rounded-xl border border-slate-300 bg-white p-3"
                    />
                    <label
                        htmlFor="bankAccountTitle"
                        className="mb-2 block text-sm font-bold text-slate-900"
                    >
                        Account Title
                    </label>
                    <input
                        id="bankAccountTitle"
                        type="text"
                        value={bankAccountTitle}
                        onChange={(e) => setBankAccountTitle(e.target.value)}
                        disabled={loading || saving}
                        className="mb-4 w-full rounded-xl border border-slate-300 bg-white p-3"
                    />
                    <label
                        htmlFor="bankAccountNumber"
                        className="mb-2 block text-sm font-bold text-slate-900"
                    >
                        Account Number / IBAN
                    </label>
                    <input
                        id="bankAccountNumber"
                        type="text"
                        value={bankAccountNumber}
                        onChange={(e) => setBankAccountNumber(e.target.value)}
                        disabled={loading || saving}
                        className="mb-4 w-full rounded-xl border border-slate-300 bg-white p-3"
                    />
                    <label
                        htmlFor="bankTransferNote"
                        className="mb-2 block text-sm font-bold text-slate-900"
                    >
                        Driver ke liye Note (optional)
                    </label>
                    <input
                        id="bankTransferNote"
                        type="text"
                        value={bankTransferNote}
                        onChange={(e) => setBankTransferNote(e.target.value)}
                        disabled={loading || saving}
                        placeholder="Transfer karte waqt reference lazmi likhein"
                        className="w-full rounded-xl border border-slate-300 bg-white p-3"
                    />
                </div>
                <label className="flex items-center justify-between gap-4">
                    <span>
                        <strong className="block text-slate-900">Top-up Required</strong>
                        <span className="text-sm text-slate-500">
                            OFF = Free Mode. ON = Driver wallet balance required.
                        </span>
                    </span>
                    <input
                        type="checkbox"
                        checked={topUpRequired}
                        onChange={(event) => setTopUpRequired(event.target.checked)}
                        disabled={saving || loading}
                        className="h-5 w-5 accent-emerald-600"
                    />
                </label>
                <label className="mt-5 flex items-center justify-between gap-4 border-t border-slate-100 pt-5">
                    <span>
                        <strong className="block text-slate-900">
                            Online Top-up Enabled
                        </strong>
                        <span className="text-sm text-slate-500">
                            Payment gateway checkout allow karein.
                        </span>
                    </span>
                    <input
                        type="checkbox"
                        checked={onlineTopUpEnabled}
                        onChange={(event) =>
                            setOnlineTopUpEnabled(event.target.checked)
                        }
                        disabled={saving || loading}
                        className="h-5 w-5 accent-emerald-600"
                    />
                </label>

                <p className="mt-2 text-xs text-slate-500">
                    Save Commission Settings to apply these changes. Live payments
                    ke liye verified merchant integration zaroori hai.
                </p>
            </section>
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

                            <div className="grid gap-4 sm:grid-cols-2">
                                <label className="block">
                                    <span className="mb-2 block text-sm font-bold">
                                        Free Waiting Minutes (Per Location)
                                    </span>
                                    <input
                                        type="number"
                                        min="0"
                                        max="120"
                                        step="1"
                                        required
                                        value={freeWaitingMinutes}
                                        onChange={(e) => setFreeWaitingMinutes(e.target.value)}
                                        className="h-12 w-full rounded-xl border px-4"
                                    />
                                </label>

                                <label className="block">
                                    <span className="mb-2 block text-sm font-bold">
                                        Waiting Charge (PKR / Minute)
                                    </span>
                                    <input
                                        type="number"
                                        min="0"
                                        step="0.01"
                                        required
                                        value={waitingChargePerMinute}
                                        onChange={(e) => setWaitingChargePerMinute(e.target.value)}
                                        className="h-12 w-full rounded-xl border px-4"
                                    />
                                </label>
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
