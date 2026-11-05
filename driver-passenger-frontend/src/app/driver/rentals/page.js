"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
    ArrowLeft,
    ArrowRight,
    CalendarDays,
    CarFront,
    CheckCircle2,
    ChevronDown,
    CircleAlert,
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
    updateMyChauffeurDetails,
} from "@/lib/driverServicesService";
import RentalFleetManager from "@/components/driver/RentalFleetManager";
import RentalPartnerBookings from "@/components/driver/RentalPartnerBookings";

const API_URL =
    process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000/api/v1";

// Earliest selectable licence expiry (tomorrow), computed once.
const MIN_EXPIRY_DATE = new Date(
    Date.now() + 86400000
).toLocaleDateString("en-CA");

// One status per document type: APPROVED beats PENDING beats ON_FILE
// beats REJECTED beats nothing. Only the last two ever ask for an upload.
const STATUS_RANK = {
    APPROVED: 5,
    PENDING: 4,
    ON_FILE: 3,
    REJECTED: 2,
};

function normaliseDocStatus(raw) {
    const value = String(raw || "").toUpperCase();
    if (value === "APPROVED" || value === "VERIFIED") return "APPROVED";
    if (["PENDING", "UNDER_REVIEW", "SUBMITTED"].includes(value)) {
        return "PENDING";
    }
    if (value === "REJECTED" || value === "EXPIRED") return "REJECTED";
    return null;
}

function resolveDocument(type, partner) {
    const candidates = [];
    const own = (partner.documents || []).find(
        (doc) => doc.documentType === type
    );
    if (own) {
        const status = normaliseDocStatus(own.verificationStatus);
        if (status) {
            candidates.push({
                status,
                source: "partner",
                expiry: own.expiryDate || null,
                reason: own.rejectionReason || "",
            });
        }
    }
    (partner.linkedDocuments || []).forEach((doc) => {
        if ((doc.documentType || doc.type) !== type) return;
        const status = normaliseDocStatus(doc.verificationStatus || doc.status);
        if (status) {
            candidates.push({
                status,
                source: "linked",
                expiry: doc.expiryDate || doc.expiresAt || null,
                reason: doc.rejectionReason || "",
            });
        }
    });
    // The backend's missingDocuments already counts approved driver
    // documents: a required type missing from it is already satisfied.
    if (
        candidates.length === 0 &&
        Array.isArray(partner.missingDocuments) &&
        !partner.missingDocuments.includes(type)
    ) {
        candidates.push({
            status: "ON_FILE",
            source: "linked",
            expiry: null,
            reason: "",
        });
    }
    const best = candidates.sort(
        (a, b) => (STATUS_RANK[b.status] || 0) - (STATUS_RANK[a.status] || 0)
    )[0];
    const status = best?.status || "MISSING";
    return {
        type,
        label: DOCUMENT_LABELS[type] || type.replaceAll("_", " "),
        status,
        fromDriverProfile:
            best?.source === "linked" &&
            !(partner.documents || []).some(
                (doc) => doc.documentType === type
            ),
        expiry: best?.expiry || null,
        reason: best?.reason || "",
        satisfied: (STATUS_RANK[status] || 0) >= STATUS_RANK.ON_FILE,
    };
}

const fmtDate = (value) =>
    value
        ? new Date(value).toLocaleDateString("en-PK", {
              day: "numeric",
              month: "short",
              year: "numeric",
          })
        : "";

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
            className={`relative h-8 w-14 shrink-0 rounded-full transition-colors ${
                checked ? "bg-[#087F5B]" : "bg-pd-surface-3"
            } ${disabled ? "cursor-not-allowed opacity-40" : ""}`}
        >
            <span
                className={`absolute top-1 h-6 w-6 rounded-full bg-white shadow transition-all ${
                    checked ? "left-[30px]" : "left-1"
                }`}
            />
        </button>
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

// Chauffeur declaration. Everything already on file is prefilled, so
// nothing is typed twice.
function ChauffeurDetailsFields({ partner, token, notify, reload }) {
    const [name, setName] = useState(partner.chauffeurName || "");
    const [licenceNumber, setLicenceNumber] = useState(
        partner.chauffeurLicenceNumber || ""
    );
    const [licenceExpiry, setLicenceExpiry] = useState(
        partner.chauffeurLicenceExpiry
            ? String(partner.chauffeurLicenceExpiry).slice(0, 10)
            : ""
    );
    const [busy, setBusy] = useState(false);
    const chauffeurStatus =
        partner.chauffeurVerificationStatus || "NOT_APPLIED";
    const meta = STATUS_META[chauffeurStatus] || STATUS_META.NOT_APPLIED;
    const onFile = Boolean(
        partner.chauffeurName ||
            partner.chauffeurLicenceNumber ||
            partner.chauffeurLicenceExpiry
    );

    const changed =
        name.trim() !== (partner.chauffeurName || "") ||
        licenceNumber.trim() !== (partner.chauffeurLicenceNumber || "") ||
        licenceExpiry !==
            (partner.chauffeurLicenceExpiry
                ? String(partner.chauffeurLicenceExpiry).slice(0, 10)
                : "");

    async function saveChauffeur() {
        if (busy) return;
        setBusy(true);
        notify(null);
        try {
            const data = await updateMyChauffeurDetails(
                {
                    chauffeurName: name.trim() || undefined,
                    chauffeurLicenceNumber:
                        licenceNumber.trim() || undefined,
                    chauffeurLicenceExpiry: licenceExpiry || undefined,
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

    return (
        <section
            id="chauffeur-details"
            className="scroll-mt-24 rounded-[24px] bg-pd-surface p-5 shadow-sm"
        >
            <div className="flex items-center justify-between gap-3">
                <h3 className="text-base font-extrabold">Chauffeur details</h3>
                <span
                    className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-extrabold ${meta.pill}`}
                >
                    <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
                    {meta.label}
                </span>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-pd-muted">
                With Driver bookings open only after Safar verifies your
                chauffeur. Enter the chauffeur&apos;s licence details
                exactly as printed on the licence. Changing them after
                approval sends the chauffeur back for review.
            </p>
            {onFile && (
                <p className="mt-2 flex items-start gap-2 rounded-xl bg-pd-success-soft p-2.5 text-xs font-semibold text-[#087F5B]">
                    <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
                    We already have details on file — they are filled in
                    below. Change them only if something is wrong.
                </p>
            )}
            {chauffeurStatus === "REJECTED" &&
                partner.chauffeurRejectionReason && (
                    <p className="mt-2 rounded-lg bg-pd-danger-soft p-2.5 text-xs font-semibold text-pd-danger">
                        Rejected: {partner.chauffeurRejectionReason}. Fix
                        the details and save to apply again.
                    </p>
                )}
            <label className="mt-3 block">
                <span className="text-sm font-semibold">
                    Chauffeur full name
                </span>
                <input
                    type="text"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="e.g. Muhammad Ali"
                    className="mt-2 h-12 w-full rounded-xl border px-4"
                />
            </label>
            <label className="mt-3 block">
                <span className="text-sm font-semibold">
                    Driving licence number
                </span>
                <input
                    type="text"
                    value={licenceNumber}
                    onChange={(event) => setLicenceNumber(event.target.value)}
                    placeholder="As printed on the licence"
                    className="mt-2 h-12 w-full rounded-xl border px-4"
                />
            </label>
            <label className="mt-3 block">
                <span className="text-sm font-semibold">Licence expiry</span>
                <input
                    type="date"
                    dir="ltr"
                    min={MIN_EXPIRY_DATE}
                    value={licenceExpiry}
                    onChange={(event) => setLicenceExpiry(event.target.value)}
                    className="mt-2 h-12 w-full rounded-xl border px-4"
                />
            </label>
            {changed && (
                <button
                    type="button"
                    onClick={saveChauffeur}
                    disabled={busy}
                    className="mt-4 flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-[#087F5B] text-base font-bold text-white disabled:opacity-40"
                >
                    <ShieldCheck size={18} />
                    {busy ? "Please wait…" : "Save chauffeur details"}
                </button>
            )}
        </section>
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
                rental price is yours.
            </p>

            <ol className="mt-4 space-y-2 rounded-2xl bg-pd-surface-2 p-3 text-xs font-semibold text-pd-text-2">
                <li className="flex items-center gap-2">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#087F5B] text-[10px] font-extrabold text-white">
                        1
                    </span>
                    Tell us about your business — this screen
                </li>
                <li className="flex items-center gap-2">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-pd-surface-3 text-[10px] font-extrabold text-pd-muted">
                        2
                    </span>
                    Add only the documents we do not already have
                </li>
                <li className="flex items-center gap-2">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-pd-surface-3 text-[10px] font-extrabold text-pd-muted">
                        3
                    </span>
                    Safar approves you, then you list your first car
                </li>
            </ol>

            <div className="mt-5">
                <BusinessFields
                    businessName={businessName}
                    setBusinessName={setBusinessName}
                    providesChauffeur={providesChauffeur}
                    setProvidesChauffeur={setProvidesChauffeur}
                    partner={null}
                />
            </div>

            <p className="mt-4 flex items-start gap-2 text-xs leading-5 text-pd-muted">
                <CheckCircle2
                    size={14}
                    className="mt-0.5 shrink-0 text-[#087F5B]"
                />
                Documents you already gave us for your driver account are
                reused — you will never upload the same one twice.
            </p>

            <button
                type="button"
                onClick={submit}
                disabled={busy}
                className="mt-4 flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-[#087F5B] text-base font-bold text-white disabled:opacity-40"
            >
                <ShieldCheck size={19} />
                {busy ? "Please wait…" : "Start application"}
            </button>
        </section>
    );
}

function scrollToId(id) {
    document
        .getElementById(id)
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
}

// The single most obvious thing to do next, in plain words.
function NextStepCard({ partner, documents, onNavigate, onSubmit }) {
    const status = partner.applicationStatus;
    const outstanding = documents.filter((doc) => !doc.satisfied);
    const chauffeurIncomplete =
        partner.providesChauffeur &&
        !(
            partner.chauffeurName &&
            partner.chauffeurLicenceNumber &&
            partner.chauffeurLicenceExpiry
        );

    let step;
    if (status === "SUSPENDED") {
        step = {
            tone: "danger",
            title: "Account suspended",
            text: "Bookings and listings are paused. Contact Safar support to resolve this.",
        };
    } else if (outstanding.length > 0) {
        step = {
            tone: "primary",
            title: `Add ${outstanding.length} document${outstanding.length === 1 ? "" : "s"}`,
            text: `Still needed: ${outstanding.map((doc) => doc.label).join(", ")}.`,
            action: "Upload documents",
            onClick: () => scrollToId("partner-documents"),
        };
    } else if (chauffeurIncomplete) {
        step = {
            tone: "primary",
            title: "Add your chauffeur details",
            text: "Name and licence details let Safar verify your chauffeur for With Driver bookings.",
            action: "Add chauffeur details",
            onClick: () => scrollToId("chauffeur-details"),
        };
    } else if (status === "APPROVED") {
        step = {
            tone: "primary",
            title: "You are approved — list your car",
            text: "Add a vehicle with its prices and photos. It goes live after a quick check.",
            action: "Go to My Fleet",
            onClick: () => onNavigate("fleet"),
        };
    } else if (
        status === "INCOMPLETE" ||
        status === "NOT_APPLIED" ||
        status === "REJECTED"
    ) {
        // Unsubmitted, not under review: the application never reached
        // Safar (documents can complete via the linked driver profile
        // without apply ever running again), so the next step is to
        // submit it — not to wait for a review that is not happening.
        step = {
            tone: "primary",
            title: "Submit your application",
            text:
                status === "REJECTED"
                    ? "Fixes are in — submit again and Safar will review your business."
                    : "Everything is ready — submit it and Safar will review your business.",
            action: "Submit application",
            onClick: onSubmit,
        };
    } else {
        step = {
            tone: "waiting",
            title: "Nothing to do — Safar is reviewing",
            text: "Everything is submitted. You will be notified when your business is approved.",
        };
    }

    const toneClass =
        step.tone === "danger"
            ? "bg-pd-danger-soft text-pd-danger"
            : step.tone === "waiting"
              ? "bg-pd-warning-soft text-pd-warning"
              : "bg-[#087F5B] text-white";

    return (
        <section className={`rounded-[24px] p-5 shadow-sm ${toneClass}`}>
            <p className="text-[11px] font-extrabold uppercase tracking-wider opacity-80">
                {step.tone === "primary" ? "Your next step" : "Status"}
            </p>
            <h2 className="mt-1 flex items-center gap-2 text-lg font-extrabold">
                {step.tone === "waiting" && <Hourglass size={18} />}
                {step.title}
            </h2>
            <p className="mt-1 text-sm leading-6 opacity-90">{step.text}</p>
            {step.action && (
                <button
                    type="button"
                    onClick={step.onClick}
                    className="mt-4 flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-white text-base font-extrabold text-[#087F5B]"
                >
                    {step.action}
                    <ArrowRight size={18} />
                </button>
            )}
        </section>
    );
}

// What is done, what is open, what is blocking going live.
function SetupChecklist({ partner, documents }) {
    const status = partner.applicationStatus;
    const doneDocs = documents.filter((doc) => doc.satisfied).length;
    const chauffeurDone =
        !partner.providesChauffeur ||
        Boolean(
            partner.chauffeurName &&
                partner.chauffeurLicenceNumber &&
                partner.chauffeurLicenceExpiry
        );
    const approved = status === "APPROVED";

    const steps = [
        {
            key: "business",
            label: "Business details",
            done: true,
            detail: partner.businessName || "Application started",
        },
        {
            key: "docs",
            label: "Documents",
            done: doneDocs === documents.length,
            detail:
                documents.length === 0
                    ? "Nothing to upload"
                    : doneDocs === documents.length
                      ? "All submitted"
                      : `${doneDocs} of ${documents.length} done`,
            target: "partner-documents",
        },
        ...(partner.providesChauffeur
            ? [
                  {
                      key: "chauffeur",
                      label: "Chauffeur details",
                      done: chauffeurDone,
                      detail: chauffeurDone
                          ? (
                                STATUS_META[
                                    partner.chauffeurVerificationStatus
                                ] || STATUS_META.NOT_APPLIED
                            ).label
                          : "Needed for With Driver",
                      target: "chauffeur-details",
                  },
              ]
            : []),
        {
            key: "approval",
            label: "Safar approval",
            done: approved,
            detail: approved
                ? "Approved"
                : status === "REJECTED"
                  ? "Rejected — fix and resubmit"
                  : "Waiting for Safar",
        },
    ];

    const doneCount = steps.filter((step) => step.done).length;

    return (
        <section className="rounded-[24px] bg-pd-surface p-5 shadow-sm">
            <div className="flex items-center justify-between">
                <h3 className="text-base font-extrabold">Setup progress</h3>
                <span className="text-xs font-extrabold text-[#087F5B]">
                    {doneCount} of {steps.length} done
                </span>
            </div>
            <div
                className="mt-3 h-2 overflow-hidden rounded-full bg-pd-surface-3"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={steps.length}
                aria-valuenow={doneCount}
                aria-label="Setup progress"
            >
                <div
                    className="h-full rounded-full bg-[#087F5B] transition-all"
                    style={{ width: `${(doneCount / steps.length) * 100}%` }}
                />
            </div>
            <ul className="mt-3 divide-y divide-pd-line">
                {steps.map((step) => {
                    const content = (
                        <>
                            {step.done ? (
                                <CheckCircle2
                                    size={20}
                                    className="shrink-0 text-[#087F5B]"
                                />
                            ) : (
                                <CircleAlert
                                    size={20}
                                    className="shrink-0 text-pd-warning"
                                />
                            )}
                            <span className="min-w-0 flex-1 text-left">
                                <span className="block text-sm font-bold">
                                    {step.label}
                                </span>
                                <span className="block truncate text-xs text-pd-muted">
                                    {step.detail}
                                </span>
                            </span>
                            {!step.done && step.target && (
                                <ArrowRight
                                    size={16}
                                    className="shrink-0 text-pd-faint"
                                />
                            )}
                        </>
                    );
                    return (
                        <li key={step.key}>
                            {!step.done && step.target ? (
                                <button
                                    type="button"
                                    onClick={() => scrollToId(step.target)}
                                    className="flex min-h-14 w-full items-center gap-3 py-2"
                                >
                                    {content}
                                </button>
                            ) : (
                                <div className="flex min-h-14 items-center gap-3 py-2">
                                    {content}
                                </div>
                            )}
                        </li>
                    );
                })}
            </ul>
        </section>
    );
}

function DocumentRow({
    doc,
    file,
    expiry,
    uploading,
    onSelect,
    onExpiry,
    onUpload,
}) {
    const { type, label, status, satisfied } = doc;
    const pill =
        status === "APPROVED"
            ? { text: "Approved", cls: "bg-pd-success-soft text-[#087F5B]" }
            : status === "PENDING"
              ? { text: "Under review", cls: "bg-pd-warning-soft text-pd-warning" }
              : status === "ON_FILE"
                ? { text: "Already on file", cls: "bg-pd-success-soft text-[#087F5B]" }
                : status === "REJECTED"
                  ? { text: "Rejected", cls: "bg-pd-danger-soft text-pd-danger" }
                  : { text: "Missing", cls: "bg-pd-surface-3 text-pd-muted" };

    return (
        <li className="py-3">
            <div className="flex items-center gap-2.5">
                {satisfied ? (
                    <CheckCircle2
                        size={20}
                        className="shrink-0 text-[#087F5B]"
                    />
                ) : (
                    <CircleAlert
                        size={20}
                        className="shrink-0 text-pd-warning"
                    />
                )}
                <span className="min-w-0 flex-1 text-sm font-semibold">
                    {label}
                </span>
                <span
                    className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-extrabold ${pill.cls}`}
                >
                    {pill.text}
                </span>
            </div>

            {satisfied && (
                <p className="mt-1 pl-[30px] text-xs text-pd-muted">
                    {doc.fromDriverProfile
                        ? "Already submitted on your driver profile — nothing to upload."
                        : "Submitted — nothing more to upload."}
                    {doc.expiry ? ` Expires ${fmtDate(doc.expiry)}.` : ""}
                </p>
            )}

            {status === "REJECTED" && doc.reason && (
                <p className="mt-1.5 pl-[30px] text-xs font-semibold text-pd-danger">
                    {doc.reason}
                </p>
            )}

            {!satisfied && (
                <div className="mt-2.5 pl-[30px]">
                    <label className="block cursor-pointer rounded-2xl border-2 border-dashed border-pd-line bg-pd-success-soft p-4 text-center">
                        <UploadCloud
                            size={22}
                            className="mx-auto text-[#087F5B]"
                        />
                        <span className="mt-1 block truncate text-sm font-semibold">
                            {file?.name || "Tap to choose a photo"}
                        </span>
                        <input
                            type="file"
                            accept="image/jpeg,image/png,image/webp"
                            className="hidden"
                            onChange={(event) =>
                                onSelect(type, event.target.files?.[0])
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
                                dir="ltr"
                                min={MIN_EXPIRY_DATE}
                                value={expiry || ""}
                                onChange={(event) =>
                                    onExpiry(type, event.target.value)
                                }
                                className="mt-1.5 h-12 w-full rounded-xl border px-3"
                            />
                        </label>
                    )}
                    <button
                        type="button"
                        disabled={!file || Boolean(uploading)}
                        onClick={() => onUpload(type)}
                        className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#087F5B] text-sm font-bold text-white disabled:opacity-40"
                    >
                        <FileCheck2 size={16} />
                        {uploading === type ? "Uploading…" : `Upload ${label}`}
                    </button>
                </div>
            )}
        </li>
    );
}

function PartnerPanel({ partner, token, notify, reload, onNavigate }) {
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
    const [detailsOpen, setDetailsOpen] = useState(status !== "APPROVED");

    const documents = (partner.requiredDocuments || []).map((type) =>
        resolveDocument(type, partner)
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
            <NextStepCard
                partner={partner}
                documents={documents}
                onNavigate={onNavigate}
                onSubmit={saveDetails}
            />

            {status === "REJECTED" && (
                <p className="rounded-xl bg-pd-danger-soft p-4 text-sm font-semibold text-pd-danger">
                    Application rejected
                    {partner.rejectionReason
                        ? ` — ${partner.rejectionReason}`
                        : ""}
                    . Fix the documents below and submit again.
                </p>
            )}
            {status === "SUSPENDED" && partner.suspensionReason && (
                <p className="rounded-xl bg-pd-danger-soft p-4 text-sm font-semibold text-pd-danger">
                    This partner account is suspended — {partner.suspensionReason}
                    .
                </p>
            )}

            <SetupChecklist partner={partner} documents={documents} />

            {documents.length > 0 && (
                <section
                    id="partner-documents"
                    className="scroll-mt-24 rounded-[24px] bg-pd-surface p-5 shadow-sm"
                >
                    <h3 className="text-base font-extrabold">
                        Partner verification (KYC)
                    </h3>
                    <p className="mt-1 text-xs leading-5 text-pd-muted">
                        Anything already approved or under review on your
                        driver profile is ticked here — you only upload what
                        is genuinely missing.
                    </p>
                    <ul className="mt-2 divide-y divide-pd-line">
                        {documents.map((doc) => (
                            <DocumentRow
                                key={doc.type}
                                doc={doc}
                                file={files[doc.type]}
                                expiry={expiryDates[doc.type]}
                                uploading={uploading}
                                onSelect={selectFile}
                                onExpiry={(type, value) =>
                                    setExpiryDates((previous) => ({
                                        ...previous,
                                        [type]: value,
                                    }))
                                }
                                onUpload={uploadDocument}
                            />
                        ))}
                    </ul>
                </section>
            )}

            {partner.providesChauffeur && (
                <ChauffeurDetailsFields
                    partner={partner}
                    token={token}
                    notify={notify}
                    reload={reload}
                />
            )}

            <section className="rounded-[24px] bg-pd-surface p-5 shadow-sm">
                <button
                    type="button"
                    onClick={() => setDetailsOpen((open) => !open)}
                    aria-expanded={detailsOpen}
                    className="flex min-h-12 w-full items-center gap-3 text-left"
                >
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-pd-success-soft text-[#087F5B]">
                        <Store size={22} />
                    </span>
                    <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                            <span className="text-base font-extrabold">
                                {partner.businessName || "Rental Partner"}
                            </span>
                            <StatusBadge status={status} />
                        </span>
                        <span className="block text-xs text-pd-muted">
                            Business details
                        </span>
                    </span>
                    <ChevronDown
                        size={18}
                        className={`shrink-0 text-pd-faint transition-transform ${detailsOpen ? "rotate-180" : ""}`}
                    />
                </button>

                {detailsOpen && (
                    <div className="mt-4">
                        <BusinessFields
                            businessName={businessName}
                            setBusinessName={setBusinessName}
                            providesChauffeur={providesChauffeur}
                            setProvidesChauffeur={setProvidesChauffeur}
                            partner={partner}
                        />
                        {detailsChanged && (
                            <button
                                type="button"
                                onClick={saveDetails}
                                disabled={busy}
                                className="mt-4 flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-[#087F5B] text-base font-bold text-white disabled:opacity-40"
                            >
                                <ShieldCheck size={18} />
                                {busy ? "Please wait…" : "Save & submit"}
                            </button>
                        )}
                    </div>
                )}
            </section>

            {status === "APPROVED" && (
                <section className="grid grid-cols-2 gap-3">
                    <button
                        type="button"
                        onClick={() => onNavigate("fleet")}
                        className="flex min-h-24 flex-col items-start justify-between rounded-[24px] bg-pd-surface p-4 text-left shadow-sm"
                    >
                        <CarFront size={24} className="text-[#087F5B]" />
                        <span>
                            <span className="block text-sm font-extrabold">
                                My Fleet
                            </span>
                            <span className="block text-xs text-pd-muted">
                                Cars, prices, dates
                            </span>
                        </span>
                    </button>
                    <button
                        type="button"
                        onClick={() => onNavigate("bookings")}
                        className="flex min-h-24 flex-col items-start justify-between rounded-[24px] bg-pd-surface p-4 text-left shadow-sm"
                    >
                        <CalendarDays size={24} className="text-[#087F5B]" />
                        <span>
                            <span className="block text-sm font-extrabold">
                                Bookings
                            </span>
                            <span className="block text-xs text-pd-muted">
                                Requests and handovers
                            </span>
                        </span>
                    </button>
                </section>
            )}
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
              (partner.linkedDocuments || [])
                  .map(
                      (doc) =>
                          `${doc.documentType || doc.type}:${doc.verificationStatus || doc.status}`
                  )
                  .join(","),
          ].join("|")
        : "none";

    function navigate(tab) {
        setActiveTab(tab);
        window.scrollTo({ top: 0, behavior: "smooth" });
    }

    return (
        <main className="driver-subpage min-h-dvh bg-pd-bg pb-28 text-pd-text">
            <MobileBottomNav role="DRIVER" />

            <header className="bg-[#087F5B] px-5 pb-8 pt-[max(24px,env(safe-area-inset-top))] text-white">
                <div className="mx-auto max-w-xl">
                    <Link
                        href="/driver/account"
                        className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold"
                    >
                        <ArrowLeft size={19} />
                        Back to Account
                    </Link>
                    <h1 className="mt-5 flex items-center gap-3 text-3xl font-extrabold">
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
                        className={`sticky top-2 z-30 rounded-xl p-4 text-sm font-semibold shadow-md ${
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
                            className="mt-3 inline-flex h-12 items-center gap-2 rounded-xl bg-[#087F5B] px-4 text-sm font-bold text-white"
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
                                className={`min-h-11 rounded-xl py-2.5 text-xs font-extrabold ${
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
                        onNavigate={navigate}
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
