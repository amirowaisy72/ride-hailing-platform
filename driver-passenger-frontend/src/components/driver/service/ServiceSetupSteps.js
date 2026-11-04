"use client";

import { useState } from "react";
import Link from "next/link";
import {
    ArrowLeft, Banknote, CarFront, CheckCircle2, FileText, Hourglass, Power, ShieldAlert,
    ShieldCheck, ShoppingBag,
} from "lucide-react";
import { DOCUMENT_LABELS, TRANSPORT_MODES } from "@/components/driver/ServiceMeta";
import { JOURNEYS } from "@/components/driver/service/serviceJourneys";
import HowItWorks from "@/components/driver/service/HowItWorks";

const PRIMARY = "flex h-16 w-full items-center justify-center gap-2 rounded-2xl bg-pd-accent text-xl font-extrabold text-pd-accent-ink disabled:opacity-50";
const QUIET = "mx-auto flex min-h-11 items-center px-3 text-base font-bold text-pd-text-2 underline underline-offset-4";

function Screen({ step, total, Icon, title, hint, children, tone = "accent" }) {
    return (
        <section className="flex flex-col gap-5 rounded-[28px] bg-pd-surface p-5 text-pd-text shadow-sm ring-1 ring-pd-line">
            {total > 1 && (
                <div className="flex items-center gap-3">
                    <div className="flex flex-1 gap-1.5" aria-hidden>
                        {Array.from({ length: total }, (_, i) => (
                            <span key={i} className="h-2 flex-1 rounded-full" style={{ background: i < step ? "var(--pd-accent)" : "var(--pd-surface-3)" }} />
                        ))}
                    </div>
                    <p className="shrink-0 text-sm font-extrabold text-pd-text-2">Step {step} of {total}</p>
                </div>
            )}
            <div className="flex items-start gap-3">
                <span
                    className="flex size-14 shrink-0 items-center justify-center rounded-2xl"
                    style={{
                        background: tone === "bad" ? "var(--pd-danger-soft)" : "var(--pd-accent-soft)",
                        color: tone === "bad" ? "var(--pd-danger)" : "var(--pd-accent-text)",
                    }}
                    aria-hidden
                >
                    <Icon size={28} />
                </span>
                <div className="min-w-0">
                    <h2 className="text-2xl font-black leading-tight text-balance">{title}</h2>
                    <p className="mt-1 text-base leading-snug text-pd-text-2">{hint}</p>
                </div>
            </div>
            {children}
        </section>
    );
}

/** Which setup screens are still needed, from the existing service state. */
export function buildFlow(service, state, { selectedMode, policyChecked }) {
    const missingDocs = state.missingDocuments || [];
    const vehicleBlocked = (state.blockedReasons || []).some((r) => r.toLowerCase().includes("vehicle"));
    const flow = [
        { key: "docs", done: missingDocs.length === 0 },
        { key: "vehicle", done: !vehicleBlocked },
    ];
    if (service === "BUY_DELIVER") {
        flow.push({ key: "mode", done: Boolean(selectedMode) });
        flow.push({ key: "policy", done: Boolean(state.policyAcknowledged || policyChecked) });
    }
    flow.push({ key: "submit", done: false });
    return flow;
}

/**
 * One screen at a time to turn a service on: papers, vehicle, (travel mode and
 * policy for Buy & Deliver), send for review, wait, then the ON switch.
 * All saving is done by the page through the existing service APIs.
 */
export default function ServiceSetupSteps({
    service, state, busy, notice, selectedMode, onModeChange, policyChecked, onPolicyChange,
    onApply, onToggle, onBack,
}) {
    const journey = JOURNEYS[service];
    const [skipped, setSkipped] = useState([]);
    const status = state.status;
    const needsSetup = ["NOT_APPLIED", "INCOMPLETE", "REJECTED"].includes(status);
    const flow = buildFlow(service, state, { selectedMode, policyChecked });
    const current = flow.find((s) => !s.done && !skipped.includes(s.key)) || flow[flow.length - 1];
    const index = flow.indexOf(current);
    const total = flow.length;
    const skip = () => setSkipped((list) => [...list, current.key]);

    let body;
    if (status === "SUSPENDED") {
        body = (
            <Screen Icon={ShieldAlert} tone="bad" title={`${journey.label} is stopped`} total={1}
                hint={`${state.suspensionReason ? `Reason: ${state.suspensionReason}. ` : ""}Please contact Safar support. You do not need to do anything else.`}>
                <button type="button" onClick={onBack} className={PRIMARY}>Back to My Services</button>
            </Screen>
        );
    } else if (status === "PENDING" || status === "UNDER_REVIEW") {
        body = (
            <Screen Icon={Hourglass} total={1} title="Please wait"
                hint="Safar is checking your papers. We will tell you when it is approved. You do not need to do anything.">
                <button type="button" onClick={onBack} className={PRIMARY}>OK, back to My Services</button>
            </Screen>
        );
    } else if (status === "APPROVED" && state.eligible) {
        body = (
            <Screen Icon={Power} total={1}
                title={state.enabled ? `${journey.label} is ON` : `Turn ${journey.label} on`}
                hint={state.enabled ? "You can get jobs now. Turn it off any time you want a break." : "Press the button to start getting jobs."}>
                <button type="button" onClick={() => onToggle(!state.enabled)} disabled={Boolean(busy)}
                    className={state.enabled
                        ? "flex h-16 w-full items-center justify-center gap-2 rounded-2xl border-2 border-pd-line-strong bg-pd-surface-2 text-xl font-extrabold disabled:opacity-50"
                        : PRIMARY}>
                    <Power size={24} aria-hidden /> {busy ? "Please wait…" : state.enabled ? `Turn ${journey.label} off` : `Turn ${journey.label} on`}
                </button>
            </Screen>
        );
    } else if (status === "APPROVED") {
        const missingDocs = (state.missingDocuments || []).length > 0;
        body = (
            <Screen Icon={missingDocs ? FileText : CarFront} tone="bad" total={1} title="One thing is missing"
                hint={missingDocs ? "A paper is not approved yet. Upload it, then come back." : "Choose an approved vehicle, then come back."}>
                <Link href={missingDocs ? "/driver/documents" : "/driver/vehicles"} className={PRIMARY}>
                    {missingDocs ? "Open my papers" : "Open my vehicles"}
                </Link>
            </Screen>
        );
    } else if (needsSetup && current.key === "docs") {
        const names = (state.missingDocuments || []).map((d) => DOCUMENT_LABELS[d] || d.replaceAll("_", " "));
        body = (
            <Screen step={index + 1} total={total} Icon={FileText} title="Your papers"
                hint={`Safar needs to approve: ${names.join(", ")}. Upload them, then come back here.`}>
                <Link href="/driver/documents" className={PRIMARY}><FileText size={24} aria-hidden /> Upload my papers</Link>
                <button type="button" onClick={skip} className={QUIET}>I already did this. Next step</button>
            </Screen>
        );
    } else if (needsSetup && current.key === "vehicle") {
        body = (
            <Screen step={index + 1} total={total} Icon={CarFront} title="Your vehicle"
                hint="Choose the vehicle you will use. It must be approved and its registration must not be expired.">
                <Link href="/driver/vehicles" className={PRIMARY}><CarFront size={24} aria-hidden /> Choose my vehicle</Link>
                <button type="button" onClick={skip} className={QUIET}>I already did this. Next step</button>
            </Screen>
        );
    } else if (needsSetup && current.key === "mode") {
        body = (
            <Screen step={index + 1} total={total} Icon={ShoppingBag} title="How will you travel?"
                hint="Tap how you usually go for deliveries. It only helps us plan.">
                <div className="grid grid-cols-2 gap-3" role="radiogroup" aria-label="How you travel">
                    {TRANSPORT_MODES.map(({ value, label, Icon }) => {
                        const on = selectedMode === value;
                        return (
                            <button key={value} type="button" role="radio" aria-checked={on} onClick={() => onModeChange(value)}
                                className={`flex h-24 flex-col items-center justify-center gap-1.5 rounded-2xl border-2 text-lg font-extrabold ${on ? "border-pd-accent bg-pd-accent-soft text-pd-accent-text" : "border-pd-line-strong bg-pd-surface-2"}`}>
                                <Icon size={28} aria-hidden /> {label}
                            </button>
                        );
                    })}
                </div>
            </Screen>
        );
    } else if (needsSetup && current.key === "policy") {
        body = (
            <Screen step={index + 1} total={total} Icon={Banknote} title="Shopping rules"
                hint="Please read this once. It protects you and the customer.">
                <ul className="flex flex-col gap-2 text-base font-semibold leading-snug">
                    {["Buy only what the customer approves.", "Stay inside the approved amount.", "Keep every receipt.", "Collect the shopping money back when you deliver. It is not your earnings."].map((line) => (
                        <li key={line} className="flex items-start gap-2"><CheckCircle2 size={20} className="mt-0.5 shrink-0 text-pd-accent-text" aria-hidden /> {line}</li>
                    ))}
                </ul>
                <button type="button" onClick={() => onPolicyChange(true)} className={PRIMARY}>
                    <CheckCircle2 size={24} aria-hidden /> I agree
                </button>
            </Screen>
        );
    } else {
        body = (
            <Screen step={total} total={total} Icon={ShieldCheck}
                title={status === "REJECTED" ? "Try again" : "Send for checking"}
                hint={status === "REJECTED"
                    ? `${state.rejectionReason ? `Last time: ${state.rejectionReason}. ` : ""}Fix it, then press the button.`
                    : "Press the button. Safar will check your papers and tell you when you can start."}>
                <button type="button" onClick={onApply} disabled={Boolean(busy)} className={PRIMARY}>
                    <ShieldCheck size={24} aria-hidden /> {busy ? "Please wait…" : status === "REJECTED" ? "Apply again" : "Send for checking"}
                </button>
            </Screen>
        );
    }

    return (
        <div className="flex flex-col gap-5">
            <button type="button" onClick={onBack} className="flex min-h-11 items-center gap-2 self-start text-base font-extrabold text-pd-text-2">
                <ArrowLeft size={20} aria-hidden /> My Services
            </button>
            <h1 className="text-3xl font-black">{journey.full}</h1>
            {notice && (
                <p role={notice.kind === "error" ? "alert" : "status"}
                    className="rounded-2xl p-4 text-base font-bold"
                    style={{
                        background: notice.kind === "error" ? "var(--pd-danger-soft)" : "var(--pd-accent-soft)",
                        color: notice.kind === "error" ? "var(--pd-danger)" : "var(--pd-accent-text)",
                    }}>
                    {notice.text}
                </p>
            )}
            {body}
            <HowItWorks service={service} />
        </div>
    );
}
