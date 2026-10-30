"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
    ArrowLeft,
    BadgeCheck,
    Banknote,
    CarFront,
    CheckCircle2,
    ChevronRight,
    CircleAlert,
    ClipboardList,
    Hourglass,
    RefreshCw,
    ShieldCheck,
    Store,
} from "lucide-react";

import AuthGuard from "@/components/AuthGuard";
import MobileBottomNav from "@/components/MobileBottomNav";
import { useAuth } from "@/context/AuthContext";
import { money } from "@/components/driver/DriverRequestCard";
import {
    DOCUMENT_LABELS,
    SERVICE_META,
    SERVICE_ORDER,
    STATUS_META,
    TRANSPORT_MODES,
    humanizeReason,
} from "@/components/driver/ServiceMeta";
import {
    applyForService,
    getMyRentalPartner,
    getMyServices,
    updateServiceAvailability,
    updateServiceTransportMode,
} from "@/lib/driverServicesService";

export default function DriverServicesPage() {
    return (
        <AuthGuard role="DRIVER">
            <MyServicesScreen />
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

function RequirementRow({ done, label, actionHref, actionLabel }) {
    return (
        <li className="flex items-center gap-2.5 py-2">
            {done ? (
                <CheckCircle2 size={18} className="shrink-0 text-[#087F5B]" />
            ) : (
                <CircleAlert size={18} className="shrink-0 text-amber-500" />
            )}
            <span
                className={`min-w-0 flex-1 text-sm font-semibold ${
                    done ? "text-pd-text-2" : "text-pd-text"
                }`}
            >
                {label}
            </span>
            {!done && actionHref && (
                <Link
                    href={actionHref}
                    className="shrink-0 rounded-lg bg-pd-success-soft px-2.5 py-1.5 text-xs font-extrabold text-[#087F5B]"
                >
                    {actionLabel || "Fix"}
                </Link>
            )}
        </li>
    );
}

function ServiceCard({ state, token, onChanged, notify }) {
    const meta = SERVICE_META[state.service];
    const Icon = meta.Icon;
    const isBuyDeliver = state.service === "BUY_DELIVER";

    // The parent keys this card by service + transportMode +
    // applicationStatus, so a server-confirmed change remounts the
    // card and this local state re-initialises from the fresh state.
    const [selectedMode, setSelectedMode] = useState(state.transportMode || "");
    const [policyChecked, setPolicyChecked] = useState(false);
    const [busy, setBusy] = useState("");
    // Feedback is ALSO rendered inside this card, directly above the
    // action button: the page-level notice sits at the top of a long
    // page, so a driver tapping "Activate" at the bottom never saw why
    // nothing happened (e.g. the no-transport-mode guard) and the
    // button looked dead.
    const [cardNotice, setCardNotice] = useState(null);

    function showNotice(next) {
        setCardNotice(next);
        notify(next);
    }

    const status = state.status;
    const applied = state.applicationStatus !== "NOT_APPLIED";
    const vehicleBlocked = (state.blockedReasons || []).some((reason) =>
        reason.toLowerCase().includes("vehicle")
    );
    const extraReasons = (state.blockedReasons || [])
        .map(humanizeReason)
        .filter(
            (reason) =>
                reason &&
                reason !== "Select an approved vehicle" &&
                reason !== "Your vehicle registration has expired" &&
                reason !== "Choose how you will travel for deliveries" &&
                reason !==
                    "Accept the purchase-handling & reimbursement policy"
        );

    async function run(key, action, successText) {
        if (busy) return;
        setBusy(key);
        try {
            await action();
            if (successText) showNotice({ kind: "success", text: successText });
        } catch (error) {
            showNotice({ kind: "error", text: error.message });
        } finally {
            setBusy("");
        }
    }

    function apply() {
        if (isBuyDeliver && !selectedMode) {
            showNotice({
                kind: "error",
                text: "Choose how you will travel for Buy & Deliver deliveries first.",
            });
            return;
        }
        run(
            "apply",
            async () => {
                const data = await applyForService(
                    state.service,
                    isBuyDeliver
                        ? {
                              transportMode: selectedMode,
                              policyAcknowledged:
                                  policyChecked || state.policyAcknowledged,
                          }
                        : {},
                    token
                );
                onChanged(data.service);
            },
            null
        );
    }

    function chooseMode(mode) {
        setSelectedMode(mode);
        if (!applied) return;
        run("mode", async () => {
            const data = await updateServiceTransportMode(
                state.service,
                mode,
                token
            );
            onChanged(data.service);
        });
    }

    function toggleAvailability(enabled) {
        run("toggle", async () => {
            await updateServiceAvailability(state.service, enabled, token);
            onChanged(null, true);
        });
    }

    const applyLabel =
        status === "REJECTED"
            ? "Apply again"
            : status === "INCOMPLETE"
              ? "Submit for review"
              : `Activate ${meta.short}`;

    return (
        <section className="rounded-[24px] bg-pd-surface p-5 shadow-sm">
            <div className="flex items-start gap-3">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-pd-success-soft text-[#087F5B]">
                    <Icon size={24} />
                </span>
                <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-lg font-extrabold">{meta.label}</h2>
                        <StatusBadge status={status} />
                        {state.eligible && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-[#087F5B] px-2.5 py-1 text-[11px] font-extrabold text-white">
                                <BadgeCheck size={12} /> Ready
                            </span>
                        )}
                    </div>
                    <p className="mt-1 text-sm text-pd-muted">{meta.blurb}</p>
                </div>
            </div>

            {status === "REJECTED" && (
                <p className="mt-4 rounded-xl bg-pd-danger-soft p-3 text-sm font-semibold text-pd-danger">
                    Application rejected
                    {state.rejectionReason ? ` — ${state.rejectionReason}` : ""}.
                    Fix the requirements below and apply again.
                </p>
            )}
            {status === "SUSPENDED" && (
                <p className="mt-4 rounded-xl bg-pd-danger-soft p-3 text-sm font-semibold text-pd-danger">
                    This service is suspended
                    {state.suspensionReason
                        ? ` — ${state.suspensionReason}`
                        : ""}
                    . Contact Safar support if you think this is a mistake.
                </p>
            )}
            {(status === "PENDING" || status === "UNDER_REVIEW") && (
                <p className="mt-4 flex items-start gap-2 rounded-xl bg-pd-warning-soft p-3 text-sm font-semibold text-pd-warning">
                    <Hourglass size={16} className="mt-0.5 shrink-0" />
                    Safar is reviewing your documents. You will be notified
                    when this service is approved.
                </p>
            )}

            {/* Requirements — identical verification for every service:
                approved documents + an approved vehicle. */}
            <h3 className="mt-5 flex items-center gap-2 text-xs font-extrabold uppercase tracking-wider text-pd-muted">
                <ClipboardList size={14} /> Requirements
            </h3>
            <ul className="mt-1 divide-y divide-pd-line">
                {(state.requiredDocuments || []).map((doc) => {
                    const missing = (state.missingDocuments || []).includes(
                        doc
                    );
                    return (
                        <RequirementRow
                            key={doc}
                            done={!missing}
                            label={`${DOCUMENT_LABELS[doc] || doc.replaceAll("_", " ")}${missing ? " — not approved yet" : " — approved"}`}
                            actionHref="/driver/documents"
                            actionLabel="Upload"
                        />
                    );
                })}
                <RequirementRow
                    done={!vehicleBlocked}
                    label={
                        vehicleBlocked
                            ? "Approved vehicle — none selected or approved yet"
                            : "Approved vehicle selected"
                    }
                    actionHref="/driver/vehicles"
                    actionLabel="Vehicles"
                />
                {isBuyDeliver && state.policyAcknowledged && (
                    <RequirementRow
                        done
                        label="Purchase-handling policy — accepted"
                    />
                )}
            </ul>

            {isBuyDeliver && (
                <>
                    <h3 className="mt-5 text-xs font-extrabold uppercase tracking-wider text-pd-muted">
                        How will you travel for deliveries?
                    </h3>
                    <div className="mt-2 grid grid-cols-4 gap-2" role="radiogroup" aria-label="Buy & Deliver transport mode">
                        {TRANSPORT_MODES.map(({ value, label, Icon: ModeIcon }) => {
                            const activeMode = selectedMode === value;
                            return (
                                <button
                                    key={value}
                                    type="button"
                                    role="radio"
                                    aria-checked={activeMode}
                                    disabled={busy === "mode" || status === "SUSPENDED"}
                                    onClick={() => chooseMode(value)}
                                    className={`flex flex-col items-center gap-1.5 rounded-2xl border-2 px-2 py-3 text-[11px] font-extrabold transition-colors ${
                                        activeMode
                                            ? "border-[#087F5B] bg-pd-success-soft text-[#087F5B]"
                                            : "border-pd-line bg-pd-surface text-pd-text-2"
                                    }`}
                                >
                                    <ModeIcon size={20} />
                                    {label}
                                </button>
                            );
                        })}
                    </div>
                    <p className="mt-2 flex items-start gap-1.5 text-xs leading-5 text-pd-muted">
                        <CarFront size={14} className="mt-0.5 shrink-0" />
                        Your travel mode is only for planning. Buy &amp; Deliver
                        needs the same verification as Rides and Parcels — an
                        approved vehicle, driving licence and vehicle
                        registration.
                    </p>
                    {applied && status === "APPROVED" && (
                        <p className="mt-1 text-xs font-semibold text-pd-warning">
                            Changing your travel mode sends this service back
                            for a quick re-review.
                        </p>
                    )}

                    {typeof state.purchaseLimit === "number" && (
                        <p className="mt-4 flex items-center gap-2 rounded-xl bg-pd-success-soft p-3 text-sm font-bold text-[#087F5B]">
                            <Banknote size={17} />
                            Approved shopping limit: {money(state.purchaseLimit)}{" "}
                            per order
                        </p>
                    )}

                    {!state.policyAcknowledged && status !== "SUSPENDED" && (
                        <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl border border-pd-line p-3">
                            <input
                                type="checkbox"
                                checked={policyChecked}
                                onChange={(event) =>
                                    setPolicyChecked(event.target.checked)
                                }
                                className="mt-1 h-4 w-4 shrink-0 accent-[#087F5B]"
                            />
                            <span className="text-xs leading-5 text-pd-text-2">
                                I accept the purchase-handling &amp;
                                reimbursement policy: I will buy only the items
                                the customer approves, stay within the approved
                                amount, keep every receipt, and collect the
                                shopping money back on delivery. Shopping money
                                is a reimbursement — it is not my earnings.
                            </span>
                        </label>
                    )}
                </>
            )}

            {extraReasons.length > 0 && status === "APPROVED" && (
                <div className="mt-4 space-y-1">
                    {extraReasons.map((reason) => (
                        <p
                            key={reason}
                            className="flex items-start gap-1.5 text-xs font-semibold text-pd-warning"
                        >
                            <CircleAlert size={13} className="mt-0.5 shrink-0" />
                            {reason}
                        </p>
                    ))}
                </div>
            )}

            {cardNotice && (
                <p
                    role={cardNotice.kind === "error" ? "alert" : "status"}
                    className={`mt-4 rounded-xl p-3 text-sm font-semibold ${
                        cardNotice.kind === "error"
                            ? "bg-pd-danger-soft text-pd-danger"
                            : "bg-pd-success-soft text-[#087F5B]"
                    }`}
                >
                    {cardNotice.text}
                </p>
            )}

            {(status === "NOT_APPLIED" ||
                status === "INCOMPLETE" ||
                status === "REJECTED") && (
                <button
                    type="button"
                    onClick={apply}
                    disabled={Boolean(busy)}
                    className="mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#087F5B] font-bold text-white disabled:opacity-40"
                >
                    <ShieldCheck size={18} />
                    {busy === "apply" ? "Please wait…" : applyLabel}
                </button>
            )}

            {/* Availability — a preference only. The server still checks
                approval + documents + vehicle on every request. */}
            <div className="mt-5 flex items-center gap-3 border-t border-pd-line pt-4">
                <div className="min-w-0 flex-1">
                    <p className="text-sm font-extrabold">
                        Available for {meta.short}
                    </p>
                    <p className="mt-0.5 text-xs text-pd-muted">
                        {status !== "APPROVED"
                            ? "Turns on once this service is approved."
                            : state.eligible
                              ? state.enabled
                                  ? `You can receive ${meta.short} requests.`
                                  : `Turned off — you won't receive ${meta.short} requests.`
                              : "Approved, but a requirement above is still missing."}
                    </p>
                </div>
                <Toggle
                    checked={Boolean(state.enabled)}
                    disabled={status !== "APPROVED" || busy === "toggle"}
                    onChange={toggleAvailability}
                    label={`Available for ${meta.label}`}
                />
            </div>
        </section>
    );
}

function MyServicesScreen() {
    const { token } = useAuth();
    const [services, setServices] = useState(null);
    const [rentalPartner, setRentalPartner] = useState(undefined);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState(null);

    const notify = useCallback((next) => {
        setNotice(next);
    }, []);

    const load = useCallback(async () => {
        if (!token) return;
        try {
            const data = await getMyServices(token);
            setServices(data.services || []);
            setError("");
        } catch (err) {
            setError(err.message);
        }
        try {
            const data = await getMyRentalPartner(token);
            setRentalPartner(data.rentalPartner || null);
        } catch {
            setRentalPartner(null);
        }
    }, [token]);

    useEffect(() => {
        if (!token) return;
        let cancelled = false;
        (async () => {
            try {
                const data = await getMyServices(token);
                if (cancelled) return;
                setServices(data.services || []);
                setError("");
            } catch (err) {
                if (!cancelled) setError(err.message);
            }
            try {
                const data = await getMyRentalPartner(token);
                if (!cancelled) setRentalPartner(data.rentalPartner || null);
            } catch {
                if (!cancelled) setRentalPartner(null);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [token]);

    function onChanged(updated, refetch) {
        if (refetch || !updated) {
            void load();
            return;
        }
        setServices((previous) =>
            (previous || []).map((item) =>
                item.service === updated.service ? updated : item
            )
        );
    }

    const readyCount = (services || []).filter((s) => s.eligible).length;

    return (
        <main className="driver-subpage min-h-dvh bg-pd-bg pb-28 text-pd-text">
            <MobileBottomNav role="DRIVER" />

            <header className="bg-[#087F5B] px-5 pb-8 pt-[max(24px,env(safe-area-inset-top))] text-white">
                <div className="mx-auto max-w-xl">
                    <Link
                        href="/driver"
                        className="inline-flex items-center gap-2 text-sm font-semibold"
                    >
                        <ArrowLeft size={19} />
                        Back to Home
                    </Link>
                    <h1 className="mt-7 text-3xl font-extrabold">My Services</h1>
                    <p className="mt-2 text-sm text-white/75">
                        Each service is applied for, verified and switched on
                        separately. Approving one service never approves
                        another.
                    </p>
                    {services && (
                        <p className="mt-4 inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1.5 text-xs font-extrabold">
                            <BadgeCheck size={14} />
                            {readyCount} of {services.length} services ready to
                            earn
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
                {error && (
                    <div className="rounded-[24px] bg-pd-surface p-5 shadow-sm">
                        <p role="alert" className="text-sm font-semibold text-pd-danger">
                            {error}
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

                {!services && !error && (
                    <div className="space-y-5" aria-busy="true">
                        {[0, 1, 2].map((i) => (
                            <div
                                key={i}
                                className="h-56 animate-pulse rounded-[24px] bg-pd-surface shadow-sm"
                            />
                        ))}
                    </div>
                )}

                {(services || []).map((state) => (
                    <ServiceCard
                        key={`${state.service}:${state.transportMode || ""}:${state.applicationStatus}`}
                        state={state}
                        token={token}
                        onChanged={onChanged}
                        notify={notify}
                    />
                ))}

                {services && (
                    <Link
                        href="/driver/rentals"
                        className="flex items-center gap-3 rounded-[24px] bg-pd-surface p-5 shadow-sm"
                    >
                        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-pd-success-soft text-[#087F5B]">
                            <Store size={24} />
                        </span>
                        <span className="min-w-0 flex-1">
                            <span className="block font-extrabold">
                                My Rental Business
                            </span>
                            <span className="mt-0.5 block text-sm text-pd-muted">
                                {rentalPartner
                                    ? `Safar Rentals partner · ${(STATUS_META[rentalPartner.applicationStatus] || STATUS_META.NOT_APPLIED).label}`
                                    : "Rent out your car with Safar Rentals — separate partner approval."}
                            </span>
                        </span>
                        <ChevronRight size={18} className="shrink-0 text-pd-faint" />
                    </Link>
                )}
            </div>
        </main>
    );
}
