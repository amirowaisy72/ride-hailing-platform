"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
    ArrowLeft,
    BadgeCheck,
    CalendarDays,
    CarFront,
    CheckCircle2,
    CircleAlert,
    CircleDollarSign,
    ClipboardList,
    FileCheck2,
    Hourglass,
    KeyRound,
    RefreshCw,
    ShieldCheck,
    Store,
    UploadCloud,
} from "lucide-react";

import AuthGuard from "@/components/AuthGuard";
import MobileBottomNav from "@/components/MobileBottomNav";
import { useAuth } from "@/context/AuthContext";
import {
    DOCUMENT_LABELS,
    STATUS_META,
} from "@/components/driver/ServiceMeta";
import {
    applyForRentalPartner,
    getMyRentalPartner,
} from "@/lib/driverServicesService";
import RentalFleetManager from "@/components/driver/RentalFleetManager";
import RentalPartnerBookings from "@/components/driver/RentalPartnerBookings";

const API_URL =
    process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000/api/v1";

// Earliest selectable licence expiry (tomorrow), computed once.
const MIN_EXPIRY_DATE = new Date(
    Date.now() + 86400000
).toLocaleDateString("en-CA");

export default function DriverRentalsPage() {
    return (
        <AuthGuard role="DRIVER">
            <RentalBusinessScreen />
        </AuthGuard>
    );
}

function StatusBadge({ status }) {
    const meta = STATUS_META[status] || STATUS_META.NOT_APPLIED;
    return (
        <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-extrabold ${meta.pill}`}
        >
            <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
            {meta.label}
        </span>
    );
}

function Toggle({ checked, disabled, onChange, label }) {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={checked}
            aria-label={label}
            disabled={disabled}
            onClick={() => onChange(!checked)}
            className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${
                checked ? "bg-[#087F5B]" : "bg-pd-surface-3"
            } ${disabled ? "cursor-not-allowed opacity-40" : ""}`}
        >
            <span
                className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${
                    checked ? "left-[22px]" : "left-0.5"
                }`}
            />
        </button>
    );
}

function StatPlaceholder({ Icon, label, caption }) {
    return (
        <div className="rounded-2xl bg-pd-surface p-4 shadow-sm">
            <Icon size={22} className="text-[#087F5B]" />
            <p className="mt-2 text-xl font-extrabold text-pd-faint">—</p>
            <p className="text-xs font-bold text-pd-text-2">{label}</p>
            <p className="mt-0.5 text-[11px] leading-4 text-pd-faint">
                {caption}
            </p>
        </div>
    );
}

function BusinessFields({
    businessName,
    setBusinessName,
    providesChauffeur,
    setProvidesChauffeur,
    partner,
}) {
    return (
        <>
            <label className="block">
                <span className="text-sm font-semibold">
                    Business name (optional)
                </span>
                <input
                    type="text"
                    value={businessName}
                    onChange={(event) => setBusinessName(event.target.value)}
                    placeholder="e.g. Khan Rent A Car"
                    className="mt-2 h-12 w-full rounded-xl border px-4"
                />
            </label>

            <div className="mt-4 flex items-center gap-3 rounded-xl border border-pd-line p-3">
                <div className="min-w-0 flex-1">
                    <p className="text-sm font-extrabold">
                        I can also provide a driver
                    </p>
                    <p className="mt-0.5 text-xs text-pd-muted">
                        {partner?.providesChauffeur
                            ? `Chauffeur verification: ${(STATUS_META[partner.chauffeurVerificationStatus] || STATUS_META.NOT_APPLIED).label}`
                            : "For With Driver bookings. Your chauffeur licence is verified separately."}
                    </p>
                </div>
                <Toggle
                    checked={providesChauffeur}
                    onChange={setProvidesChauffeur}
                    label="I can also provide a driver"
                />
            </div>
        </>
    );
}

function ApplyForm({ token, notify, onApplied }) {
    const [businessName, setBusinessName] = useState("");
    const [providesChauffeur, setProvidesChauffeur] = useState(false);
    const [busy, setBusy] = useState(false);

    async function submit() {
        if (busy) return;
        setBusy(true);
        notify(null);
        try {
            const data = await applyForRentalPartner(
                {
                    businessName: businessName.trim() || undefined,
                    providesChauffeur,
                },
                token
            );
            notify({ kind: "success", text: data.message });
            onApplied(data.rentalPartner);
        } catch (error) {
            notify({ kind: "error", text: error.message });
        } finally {
            setBusy(false);
        }
    }

    return (
        <section className="rounded-[24px] bg-pd-surface p-5 shadow-sm">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-pd-success-soft text-[#087F5B]">
                <KeyRound size={24} />
            </span>
            <h2 className="mt-3 text-lg font-extrabold">
                Become a Rental Partner
            </h2>
            <p className="mt-1 text-sm leading-6 text-pd-muted">
                List your car on Safar Rentals and earn from bookings. Safar
                collects its booking fee when a booking is confirmed, so your
                rental price is yours. Vehicle listings open in the next
                update — complete your partner verification now so you can go
                live on day one.
            </p>

            <div className="mt-5">
                <BusinessFields
                    businessName={businessName}
                    setBusinessName={setBusinessName}
                    providesChauffeur={providesChauffeur}
                    setProvidesChauffeur={setProvidesChauffeur}
                    partner={null}
                />
            </div>

            <button
                type="button"
                onClick={submit}
                disabled={busy}
                className="mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#087F5B] font-bold text-white disabled:opacity-40"
            >
                <ShieldCheck size={18} />
                {busy ? "Please wait…" : "Start application"}
            </button>
        </section>
    );
}

function PartnerPanel({ partner, token, notify, reload }) {
    const status = partner.applicationStatus;
    // Keyed remounts (see parent) re-initialise these from fresh
    // server state after every save or document review change.
    const [businessName, setBusinessName] = useState(
        partner.businessName || ""
    );
    const [providesChauffeur, setProvidesChauffeur] = useState(
        Boolean(partner.providesChauffeur)
    );
    const [busy, setBusy] = useState(false);
    const [files, setFiles] = useState({});
    const [expiryDates, setExpiryDates] = useState({});
    const [uploading, setUploading] = useState("");

    const documentsByType = new Map(
        (partner.documents || []).map((doc) => [doc.documentType, doc])
    );
    const detailsChanged =
        businessName.trim() !== (partner.businessName || "") ||
        providesChauffeur !== Boolean(partner.providesChauffeur);

    async function saveDetails() {
        if (busy) return;
        setBusy(true);
        notify(null);
        try {
            const data = await applyForRentalPartner(
                {
                    businessName: businessName.trim() || undefined,
                    providesChauffeur,
                },
                token
            );
            notify({ kind: "success", text: data.message });
            reload();
        } catch (error) {
            notify({ kind: "error", text: error.message });
        } finally {
            setBusy(false);
        }
    }

    function selectFile(type, file) {
        if (!file) return;
        if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
            notify({
                kind: "error",
                text: "Only JPG, PNG and WebP images are supported.",
            });
            return;
        }
        if (file.size > 5 * 1024 * 1024) {
            notify({ kind: "error", text: "Maximum file size is 5 MB." });
            return;
        }
        setFiles((previous) => ({ ...previous, [type]: file }));
        notify(null);
    }

    async function uploadDocument(type) {
        const file = files[type];
        if (!file || !token || uploading) return;
        setUploading(type);
        notify(null);
        try {
            const formData = new FormData();
            formData.append("documentType", type);
            if (type === "DRIVING_LICENSE") {
                const expiryDate = expiryDates[type];
                if (!expiryDate) {
                    throw new Error(
                        "Please select the driving licence expiry date"
                    );
                }
                formData.append("expiryDate", expiryDate);
            }
            formData.append("document", file);
            const response = await fetch(
                `${API_URL}/rental-partners/me/documents`,
                {
                    method: "POST",
                    headers: { Authorization: `Bearer ${token}` },
                    body: formData,
                }
            );
            const result = await response.json();
            if (!response.ok || !result.success) {
                throw new Error(result.message || "Document upload failed");
            }
            setFiles((previous) => ({ ...previous, [type]: null }));
            notify({
                kind: "success",
                text: `${DOCUMENT_LABELS[type] || type} uploaded — submitted for verification.`,
            });
            reload();
        } catch (error) {
            notify({ kind: "error", text: error.message });
        } finally {
            setUploading("");
        }
    }

    return (
        <>
            <section className="rounded-[24px] bg-pd-surface p-5 shadow-sm">
                <div className="flex items-start gap-3">
                    <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-pd-success-soft text-[#087F5B]">
                        <Store size={24} />
                    </span>
                    <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                            <h2 className="text-lg font-extrabold">
                                {partner.businessName || "Rental Partner"}
                            </h2>
                            <StatusBadge status={status} />
                        </div>
                        <p className="mt-1 text-sm text-pd-muted">
                            {status === "APPROVED"
                                ? "Your rental business is verified. Listings open in the next update."
                                : "Complete the verification below — Safar reviews every Rental Partner before listings go live."}
                        </p>
                    </div>
                </div>

                {status === "REJECTED" && (
                    <p className="mt-4 rounded-xl bg-pd-danger-soft p-3 text-sm font-semibold text-pd-danger">
                        Application rejected
                        {partner.rejectionReason
                            ? ` — ${partner.rejectionReason}`
                            : ""}
                        . Fix the documents below and submit again.
                    </p>
                )}
                {status === "SUSPENDED" && (
                    <p className="mt-4 rounded-xl bg-pd-danger-soft p-3 text-sm font-semibold text-pd-danger">
                        This partner account is suspended
                        {partner.suspensionReason
                            ? ` — ${partner.suspensionReason}`
                            : ""}
                        .
                    </p>
                )}
                {(status === "PENDING" || status === "UNDER_REVIEW") && (
                    <p className="mt-4 flex items-start gap-2 rounded-xl bg-pd-warning-soft p-3 text-sm font-semibold text-pd-warning">
                        <Hourglass size={16} className="mt-0.5 shrink-0" />
                        Safar is reviewing your KYC documents. You will be
                        notified when your business is approved.
                    </p>
                )}

                <div className="mt-5">
                    <BusinessFields
                        businessName={businessName}
                        setBusinessName={setBusinessName}
                        providesChauffeur={providesChauffeur}
                        setProvidesChauffeur={setProvidesChauffeur}
                        partner={partner}
                    />
                </div>

                {detailsChanged && (
                    <button
                        type="button"
                        onClick={saveDetails}
                        disabled={busy}
                        className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#087F5B] font-bold text-white disabled:opacity-40"
                    >
                        <ShieldCheck size={18} />
                        {busy ? "Please wait…" : "Save & submit"}
                    </button>
                )}
            </section>

            <section className="rounded-[24px] bg-pd-surface p-5 shadow-sm">
                <h3 className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-wider text-pd-muted">
                    <ClipboardList size={14} /> Partner verification (KYC)
                </h3>
                <ul className="mt-1 divide-y divide-pd-line">
                    {(partner.requiredDocuments || []).map((type) => {
                        const doc = documentsByType.get(type);
                        const docStatus = doc?.verificationStatus;
                        const label =
                            DOCUMENT_LABELS[type] || type.replaceAll("_", " ");
                        return (
                            <li key={type} className="py-3">
                                <div className="flex items-center gap-2.5">
                                    {docStatus === "APPROVED" ? (
                                        <CheckCircle2
                                            size={18}
                                            className="shrink-0 text-[#087F5B]"
                                        />
                                    ) : (
                                        <CircleAlert
                                            size={18}
                                            className="shrink-0 text-pd-warning"
                                        />
                                    )}
                                    <span className="min-w-0 flex-1 text-sm font-semibold">
                                        {label}
                                    </span>
                                    <span
                                        className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-extrabold ${
                                            docStatus === "APPROVED"
                                                ? "bg-pd-success-soft text-[#087F5B]"
                                                : docStatus === "REJECTED"
                                                  ? "bg-pd-danger-soft text-pd-danger"
                                                  : docStatus === "PENDING"
                                                    ? "bg-pd-warning-soft text-pd-warning"
                                                    : "bg-pd-surface-3 text-pd-muted"
                                        }`}
                                    >
                                        {docStatus === "APPROVED"
                                            ? "Approved"
                                            : docStatus === "REJECTED"
                                              ? "Rejected"
                                              : docStatus === "PENDING"
                                                ? "Under review"
                                                : "Missing"}
                                    </span>
                                </div>
                                {docStatus === "REJECTED" &&
                                    doc?.rejectionReason && (
                                        <p className="mt-1.5 pl-7 text-xs font-semibold text-pd-danger">
                                            {doc.rejectionReason}
                                        </p>
                                    )}
                                {docStatus !== "APPROVED" && (
                                    <div className="mt-2.5 pl-7">
                                        <label className="block cursor-pointer rounded-xl border-2 border-dashed border-pd-line bg-pd-success-soft p-3 text-center">
                                            <UploadCloud
                                                size={20}
                                                className="mx-auto text-[#087F5B]"
                                            />
                                            <span className="mt-1 block truncate text-xs font-semibold">
                                                {files[type]?.name ||
                                                    "Choose document image"}
                                            </span>
                                            <input
                                                type="file"
                                                accept="image/jpeg,image/png,image/webp"
                                                className="hidden"
                                                onChange={(event) =>
                                                    selectFile(
                                                        type,
                                                        event.target.files?.[0]
                                                    )
                                                }
                                            />
                                        </label>
                                        {type === "DRIVING_LICENSE" && (
                                            <label className="mt-3 block">
                                                <span className="text-xs font-semibold">
                                                    Licence expiry date
                                                </span>
                                                <input
                                                    type="date"
                                                    min={MIN_EXPIRY_DATE}
                                                    value={
                                                        expiryDates[type] || ""
                                                    }
                                                    onChange={(event) =>
                                                        setExpiryDates(
                                                            (previous) => ({
                                                                ...previous,
                                                                [type]: event
                                                                    .target
                                                                    .value,
                                                            })
                                                        )
                                                    }
                                                    className="mt-1.5 h-11 w-full rounded-xl border px-3"
                                                />
                                            </label>
                                        )}
                                        <button
                                            type="button"
                                            disabled={
                                                !files[type] || Boolean(uploading)
                                            }
                                            onClick={() =>
                                                uploadDocument(type)
                                            }
                                            className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#087F5B] text-sm font-bold text-white disabled:opacity-40"
                                        >
                                            <FileCheck2 size={16} />
                                            {uploading === type
                                                ? "Uploading…"
                                                : `Upload ${label}`}
                                        </button>
                                    </div>
                                )}
                            </li>
                        );
                    })}
                </ul>
            </section>

            <section>
                <h3 className="px-1 text-xs font-extrabold uppercase tracking-wider text-pd-muted">
                    Business overview
                </h3>
                <div className="mt-2 grid grid-cols-2 gap-3">
                    <StatPlaceholder
                        Icon={CarFront}
                        label="Listed vehicles"
                        caption="Vehicle listings open in the next update."
                    />
                    <StatPlaceholder
                        Icon={CalendarDays}
                        label="Upcoming bookings"
                        caption="Bookings appear here once listings go live."
                    />
                    <StatPlaceholder
                        Icon={KeyRound}
                        label="Active rentals"
                        caption="No rentals yet — finish verification to be ready."
                    />
                    <StatPlaceholder
                        Icon={CircleDollarSign}
                        label="Monthly revenue"
                        caption="Rental earnings will be tracked here."
                    />
                </div>
                <p className="mt-3 flex items-start gap-2 rounded-xl bg-pd-success-soft p-3 text-xs leading-5 text-[#087F5B]">
                    <BadgeCheck size={15} className="mt-0.5 shrink-0" />
                    Safar Rentals launches With Driver bookings first. Partners
                    with approved KYC will be able to list vehicles as soon as
                    listings open.
                </p>
            </section>
        </>
    );
}

function RentalBusinessScreen() {
    const { token } = useAuth();
    const [partner, setPartner] = useState(undefined);
    const [loadError, setLoadError] = useState("");
    const [notice, setNotice] = useState(null);
    const [activeTab, setActiveTab] = useState("overview");

    const notify = useCallback((next) => {
        setNotice(next);
    }, []);

    const load = useCallback(async () => {
        if (!token) return;
        try {
            const data = await getMyRentalPartner(token);
            setPartner(data.rentalPartner || null);
            setLoadError("");
        } catch (error) {
            if (error.message === "Rental partner profile not found") {
                setPartner(null);
                setLoadError("");
            } else {
                setLoadError(error.message);
            }
        }
    }, [token]);

    useEffect(() => {
        if (!token) return;
        let cancelled = false;
        (async () => {
            try {
                const data = await getMyRentalPartner(token);
                if (cancelled) return;
                setPartner(data.rentalPartner || null);
                setLoadError("");
            } catch (error) {
                if (cancelled) return;
                if (error.message === "Rental partner profile not found") {
                    setPartner(null);
                    setLoadError("");
                } else {
                    setLoadError(error.message);
                }
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [token]);

    const status = partner?.applicationStatus;
    const panelKey = partner
        ? [
              partner.id,
              partner.applicationStatus,
              partner.businessName || "",
              String(Boolean(partner.providesChauffeur)),
              (partner.documents || [])
                  .map((doc) => `${doc.documentType}:${doc.verificationStatus}`)
                  .join(","),
          ].join("|")
        : "none";

    return (
        <main className="driver-subpage min-h-dvh bg-pd-bg pb-28 text-pd-text">
            <MobileBottomNav role="DRIVER" />

            <header className="bg-[#087F5B] px-5 pb-8 pt-[max(24px,env(safe-area-inset-top))] text-white">
                <div className="mx-auto max-w-xl">
                    <Link
                        href="/driver/account"
                        className="inline-flex items-center gap-2 text-sm font-semibold"
                    >
                        <ArrowLeft size={19} />
                        Back to Account
                    </Link>
                    <h1 className="mt-7 flex items-center gap-3 text-3xl font-extrabold">
                        <Store size={30} />
                        My Rental Business
                    </h1>
                    <p className="mt-2 text-sm text-white/75">
                        Safar Rentals — rent out your car for Self-Drive or
                        With Driver bookings. Rental Partner approval is
                        separate from driver approval.
                    </p>
                    {partner && (
                        <p className="mt-4">
                            <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-[11px] font-extrabold text-slate-700">
                                <span
                                    className={`h-1.5 w-1.5 rounded-full ${(STATUS_META[status] || STATUS_META.NOT_APPLIED).dot}`}
                                />
                                Partner{" "}
                                {(STATUS_META[status] || STATUS_META.NOT_APPLIED).label}
                            </span>
                        </p>
                    )}
                </div>
            </header>

            <div className="relative z-10 mx-auto mt-4 max-w-xl space-y-5 px-4 pb-6">
                {notice && (
                    <p
                        role={notice.kind === "error" ? "alert" : "status"}
                        className={`rounded-xl p-4 text-sm font-semibold ${
                            notice.kind === "error"
                                ? "bg-pd-danger-soft text-pd-danger"
                                : "bg-pd-success-soft text-[#087F5B]"
                        }`}
                    >
                        {notice.text}
                    </p>
                )}

                {loadError && (
                    <div className="rounded-[24px] bg-pd-surface p-5 shadow-sm">
                        <p role="alert" className="text-sm font-semibold text-pd-danger">
                            {loadError}
                        </p>
                        <button
                            type="button"
                            onClick={() => void load()}
                            className="mt-3 inline-flex items-center gap-2 rounded-xl bg-[#087F5B] px-4 py-2.5 text-sm font-bold text-white"
                        >
                            <RefreshCw size={15} /> Try again
                        </button>
                    </div>
                )}

                {partner === undefined && !loadError && (
                    <div
                        className="h-64 animate-pulse rounded-[24px] bg-pd-surface shadow-sm"
                        aria-busy="true"
                    />
                )}

                {partner === null && !loadError && (
                    <ApplyForm
                        token={token}
                        notify={notify}
                        onApplied={setPartner}
                    />
                )}

                {partner && status === "APPROVED" && (
                    <div
                        className="grid grid-cols-3 gap-2 rounded-2xl bg-pd-surface p-1.5 shadow-sm"
                        role="tablist"
                        aria-label="Rental business sections"
                    >
                        {[
                            { key: "overview", label: "Overview" },
                            { key: "fleet", label: "My Fleet" },
                            { key: "bookings", label: "Bookings" },
                        ].map((tab) => (
                            <button
                                key={tab.key}
                                type="button"
                                role="tab"
                                aria-selected={activeTab === tab.key}
                                onClick={() => setActiveTab(tab.key)}
                                className={`rounded-xl py-2.5 text-xs font-extrabold ${
                                    activeTab === tab.key
                                        ? "bg-[#087F5B] text-white shadow-sm"
                                        : "text-pd-muted"
                                }`}
                            >
                                {tab.label}
                            </button>
                        ))}
                    </div>
                )}

                {partner && activeTab === "overview" && (
                    <PartnerPanel
                        key={panelKey}
                        partner={partner}
                        token={token}
                        notify={notify}
                        reload={load}
                    />
                )}

                {partner && status === "APPROVED" && activeTab === "fleet" && (
                    <RentalFleetManager token={token} notify={notify} />
                )}

                {partner && status === "APPROVED" && activeTab === "bookings" && (
                    <RentalPartnerBookings token={token} />
                )}
            </div>
        </main>
    );
}
