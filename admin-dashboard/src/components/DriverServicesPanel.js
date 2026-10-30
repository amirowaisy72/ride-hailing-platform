"use client";

import { useCallback, useEffect, useState } from "react";
import {
    CheckCircle2, XCircle, RefreshCw, X,
    AlertTriangle, ShieldCheck, CirclePause,
} from "lucide-react";
import { authenticatedAdminRequest } from "@/lib/adminSession";
import { useAdminDialog } from "@/components/AdminDialog";

// Phase 7 — Driver Management per-service panel.
//
// Shows, for ONE driver, the Phase 2 service records exactly as the
// backend evaluates them (GET /admin/drivers/:id/services): effective
// status, eligibility + blocked reasons, required/missing documents,
// transport mode and purchase limit, plus the recorded approval state
// (statusUpdatedAt, rejection/suspension reasons). Actions go through
// the existing per-service endpoint — approving, rejecting or
// suspending one service never touches the driver's other services or
// the global verification status.

const SERVICE_LABELS = {
    RIDE: "Ride",
    PARCEL: "Parcel",
    BUY_DELIVER: "Buy & Deliver",
};

const STATUS_CLASSES = {
    APPROVED: "bg-emerald-50 text-emerald-700",
    PENDING: "bg-amber-50 text-amber-700",
    UNDER_REVIEW: "bg-amber-50 text-amber-700",
    INCOMPLETE: "bg-amber-50 text-amber-700",
    NOT_APPLIED: "bg-slate-100 text-slate-500",
    REJECTED: "bg-red-50 text-red-600",
    SUSPENDED: "bg-red-50 text-red-600",
};

const pretty = (value) => String(value || "").replaceAll("_", " ");

const when = (value) =>
    value ? new Date(value).toLocaleString("en-PK") : "—";

export default function DriverServicesPanel({
    driverId,
    driverName,
    onClose,
    onUpdated,
}) {
    const { confirmDialog, promptDialog } = useAdminDialog();
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [busyKey, setBusyKey] = useState("");
    const [error, setError] = useState("");
    const [message, setMessage] = useState("");
    const [limits, setLimits] = useState({});

    const load = useCallback(async () => {
        if (!driverId) return;

        setLoading(true);
        setError("");

        try {
            const result = await authenticatedAdminRequest(
                `/admin/drivers/${encodeURIComponent(driverId)}/services`
            );
            setData(result);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, [driverId]);

    useEffect(() => {
        void (async () => {
            await Promise.resolve();
            await load();
        })();
    }, [load]);

    async function setServiceStatus(service, nextStatus) {
        const key = `${service}:${nextStatus}`;
        let body = { status: nextStatus };

        if (nextStatus === "REJECTED") {
            const reason = await promptDialog(`Rejection reason for ${SERVICE_LABELS[service]}:`);
            if (!reason?.trim()) return;
            body.rejectionReason = reason.trim();
        } else if (nextStatus === "SUSPENDED") {
            const reason = await promptDialog(`Suspension reason for ${SERVICE_LABELS[service]} (optional):`, { defaultValue: "" });
            if (reason === null) return;
            if (reason.trim()) body.suspensionReason = reason.trim();
        } else if (
            !(await confirmDialog(
                `Set ${SERVICE_LABELS[service]} to ${nextStatus} for this driver? Other services are not affected.`
            ))
        ) {
            return;
        }

        if (service === "BUY_DELIVER" && limits[service] !== undefined && limits[service] !== "") {
            body.purchaseLimit = Number(limits[service]);
        }

        setBusyKey(key);
        setError("");
        setMessage("");

        try {
            await authenticatedAdminRequest(
                `/admin/drivers/${encodeURIComponent(driverId)}/services/${service}/status`,
                { method: "PATCH", body: JSON.stringify(body) }
            );

            setMessage(`${SERVICE_LABELS[service]} set to ${pretty(nextStatus)}.`);
            await load();
            onUpdated?.();
        } catch (err) {
            setError(err.message);
        } finally {
            setBusyKey("");
        }
    }

    return (
        <div
            className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-6"
            role="dialog"
            aria-modal="true"
            aria-label="Driver services"
            onClick={onClose}
        >
            <div
                className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-t-3xl bg-white p-6 shadow-xl sm:rounded-3xl"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-start justify-between gap-3">
                    <div>
                        <h3 className="flex items-center gap-2 text-xl font-extrabold">
                            <ShieldCheck size={21} className="text-[#087F5B]" />
                            Services — {driverName}
                        </h3>
                        <p className="mt-1 text-sm text-slate-500">
                            Per-service verification. Each service is approved, rejected or
                            suspended on its own record — the global status is shown for
                            context and is not changed here.
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label="Close"
                        className="rounded-xl border p-2"
                    >
                        <X size={18} />
                    </button>
                </div>

                {error && (
                    <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-600">
                        <AlertTriangle size={15} className="mr-1.5 inline" />
                        {error}
                    </p>
                )}
                {message && (
                    <p role="status" className="mt-4 rounded-xl bg-emerald-50 p-3 text-sm font-semibold text-[#087F5B]">
                        {message}
                    </p>
                )}

                {loading || !data ? (
                    <p className="py-10 text-center text-sm text-slate-500">
                        {loading ? "Loading services…" : "Services unavailable."}
                    </p>
                ) : (
                    <>
                        <p className="mt-4 text-sm text-slate-600">
                            Global verification:{" "}
                            <span className="font-bold">{pretty(data.driver?.globalVerificationStatus)}</span>
                            {" · "}
                            {data.driver?.isOnline ? "online now" : "offline"}
                            {data.activeVehicle
                                ? ` · vehicle ${data.activeVehicle.vehicleType || ""} ${data.activeVehicle.make || ""} ${data.activeVehicle.model || ""}`
                                : " · no approved active vehicle"}
                        </p>

                        <div className="mt-4 space-y-4">
                            {data.services.map((service) => (
                                <section key={service.service} className="rounded-2xl border p-4">
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                        <h4 className="font-extrabold">
                                            {SERVICE_LABELS[service.service] || service.service}
                                        </h4>
                                        <div className="flex items-center gap-2">
                                            <span className={`rounded-lg px-2.5 py-1 text-[11px] font-bold ${STATUS_CLASSES[service.status] || "bg-slate-100 text-slate-600"}`}>
                                                {pretty(service.status)}
                                            </span>
                                            <span className={`rounded-lg px-2.5 py-1 text-[11px] font-bold ${service.eligible ? "bg-emerald-50 text-[#087F5B]" : "bg-slate-100 text-slate-500"}`}>
                                                {service.eligible ? "ELIGIBLE" : "NOT ELIGIBLE"}
                                            </span>
                                        </div>
                                    </div>

                                    <dl className="mt-3 grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
                                        {service.service === "BUY_DELIVER" && (
                                            <>
                                                <div className="flex justify-between gap-3">
                                                    <dt className="text-slate-500">Transport mode</dt>
                                                    <dd className="font-bold">{pretty(service.transportMode || "—")}</dd>
                                                </div>
                                                <div className="flex justify-between gap-3">
                                                    <dt className="text-slate-500">Policy acknowledged</dt>
                                                    <dd className="font-bold">{service.record?.policyAcknowledgedAt ? when(service.record.policyAcknowledgedAt) : "No"}</dd>
                                                </div>
                                            </>
                                        )}
                                        <div className="flex justify-between gap-3">
                                            <dt className="text-slate-500">Availability toggle</dt>
                                            <dd className="font-bold">{service.enabled ? "On" : "Off (by driver)"}</dd>
                                        </div>
                                        <div className="flex justify-between gap-3">
                                            <dt className="text-slate-500">Last decision</dt>
                                            <dd className="font-bold">{when(service.record?.statusUpdatedAt)}</dd>
                                        </div>
                                        {service.record?.rejectionReason && (
                                            <div className="flex justify-between gap-3">
                                                <dt className="text-slate-500">Rejection reason</dt>
                                                <dd className="font-bold">{service.record.rejectionReason}</dd>
                                            </div>
                                        )}
                                        {service.record?.suspensionReason && (
                                            <div className="flex justify-between gap-3">
                                                <dt className="text-slate-500">Suspension reason</dt>
                                                <dd className="font-bold">{service.record.suspensionReason}</dd>
                                            </div>
                                        )}
                                    </dl>

                                    {service.reasons?.length > 0 && (
                                        <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
                                            Blocked: {service.reasons.join(" · ")}
                                        </p>
                                    )}

                                    <p className="mt-2 text-xs text-slate-500">
                                        Documents required: {(service.requiredDocuments || []).map(pretty).join(", ") || "—"}
                                        {service.missingDocuments?.length
                                            ? ` · missing: ${service.missingDocuments.map(pretty).join(", ")}`
                                            : " · all present"}
                                    </p>

                                    <div className="mt-3 flex flex-wrap items-center gap-2">
                                        {service.service === "BUY_DELIVER" && (
                                            <input
                                                type="number"
                                                min="0"
                                                step="1"
                                                value={limits[service.service] ?? service.purchaseLimit ?? ""}
                                                onChange={(e) =>
                                                    setLimits((prev) => ({
                                                        ...prev,
                                                        [service.service]: e.target.value,
                                                    }))
                                                }
                                                placeholder="Purchase limit PKR"
                                                className="w-44 rounded-xl border p-2.5 text-sm"
                                            />
                                        )}
                                        {service.status !== "APPROVED" && (
                                            <button
                                                type="button"
                                                disabled={Boolean(busyKey)}
                                                onClick={() => setServiceStatus(service.service, "APPROVED")}
                                                className="flex items-center gap-1.5 rounded-lg bg-[#087F5B] px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
                                            >
                                                <CheckCircle2 size={14} />
                                                Approve
                                            </button>
                                        )}
                                        {service.status !== "REJECTED" && (
                                            <button
                                                type="button"
                                                disabled={Boolean(busyKey)}
                                                onClick={() => setServiceStatus(service.service, "REJECTED")}
                                                className="flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-2 text-xs font-bold text-red-600 disabled:opacity-50"
                                            >
                                                <XCircle size={14} />
                                                Reject
                                            </button>
                                        )}
                                        {service.status !== "SUSPENDED" && (
                                            <button
                                                type="button"
                                                disabled={Boolean(busyKey)}
                                                onClick={() => setServiceStatus(service.service, "SUSPENDED")}
                                                className="flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-2 text-xs font-bold text-red-600 disabled:opacity-50"
                                            >
                                                <CirclePause size={14} />
                                                Suspend
                                            </button>
                                        )}
                                        <button
                                            type="button"
                                            disabled={Boolean(busyKey)}
                                            onClick={load}
                                            className="flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-bold disabled:opacity-50"
                                        >
                                            <RefreshCw size={14} />
                                            Reload
                                        </button>
                                    </div>
                                </section>
                            ))}
                        </div>

                        <h4 className="mt-5 text-sm font-extrabold uppercase tracking-wide text-slate-400">
                            Documents on file
                        </h4>
                        {data.documents?.length ? (
                            <ul className="mt-2 divide-y rounded-xl border text-sm">
                                {data.documents.map((doc) => (
                                    <li key={doc._id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                                        <span className="font-bold">{pretty(doc.documentType)}</span>
                                        <span className="text-slate-500">
                                            {pretty(doc.verificationStatus)}
                                            {doc.expiryDate ? ` · expires ${new Date(doc.expiryDate).toLocaleDateString("en-PK")}` : ""}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        ) : (
                            <p className="mt-2 text-sm text-slate-500">No documents uploaded.</p>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}
