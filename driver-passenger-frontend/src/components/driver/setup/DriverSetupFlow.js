"use client";

import { useRef, useState } from "react";
import {
    ArrowLeft, BadgeCheck, Camera, Car, Check, FileText, Hourglass, IdCard,
    Loader2, RefreshCw, TriangleAlert, Upload,
} from "lucide-react";
import { BRAND } from "@/config/brand";
import DriverHelp from "@/components/driver/DriverHelp";
import {
    COLOR_CHOICES, DOC_STATUS_TEXT, EMPTY_VEHICLE_FORM, SETUP_DOCS, SETUP_STEPS,
    VEHICLE_CHOICES, validateVehicleForm,
} from "@/components/driver/setup/setupConfig";

const DOC_ICONS = { IdCard, Car, FileText };
const ready = (status) => status === "UPLOADED" || status === "APPROVED";

const primaryButton =
    "flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-pd-accent px-6 text-lg font-extrabold text-pd-accent-ink shadow-pd outline-none transition-transform active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-pd-accent focus-visible:ring-offset-2 focus-visible:ring-offset-pd-bg disabled:cursor-not-allowed disabled:opacity-50";
const inputClass =
    "min-h-14 w-full rounded-2xl border border-pd-line-strong bg-pd-surface px-4 text-lg text-pd-text outline-none transition-colors placeholder:text-pd-faint focus:border-pd-accent focus:ring-2 focus:ring-pd-accent/30";

// Guided, one-thing-at-a-time setup for a new driver: documents,
// vehicle, review, then waiting for approval. Fully presentational —
// the container supplies data and the existing API actions.
export default function DriverSetupFlow({
    docs = {},
    vehicle = null,
    status = "PENDING",
    rejectionReason = "",
    submitted = false,
    uploadingDoc = "",
    savingVehicle = false,
    submitting = false,
    refreshing = false,
    error = "",
    onUploadDoc,
    onSaveVehicle,
    onSubmit,
    onRefresh,
    onBack,
}) {
    const docsDone = SETUP_DOCS.every((doc) => ready(docs[doc.type]));
    const waiting = submitted || status === "UNDER_REVIEW";
    const autoStep = waiting ? 3 : !docsDone ? 0 : !vehicle ? 1 : 2;

    const [picked, setPicked] = useState(null);
    const step = picked !== null && picked < autoStep ? picked : autoStep;
    const doneCount = SETUP_DOCS.filter((doc) => ready(docs[doc.type])).length;
    const nothingYet = doneCount === 0 && !vehicle;

    return (
        <main className="flex min-h-dvh flex-col bg-pd-bg text-pd-text">
            <header className="flex items-center justify-between gap-3 px-5 pt-[max(16px,env(safe-area-inset-top))]">
                <div className="flex items-center gap-2">
                    {onBack ? (
                        <button
                            type="button"
                            onClick={onBack}
                            aria-label="Go back"
                            className="flex h-11 w-11 items-center justify-center rounded-full border border-pd-line bg-pd-surface"
                        >
                            <ArrowLeft className="h-5 w-5" aria-hidden="true" />
                        </button>
                    ) : null}
                    <img src="/safar-icon.png" alt="" className="h-8 w-8 rounded-lg object-cover shadow-pd" />
                    <span className="text-base font-bold tracking-tight">{BRAND.name}</span>
                </div>
                <DriverHelp />
            </header>

            <Stepper step={step} autoStep={autoStep} onPick={setPicked} />

            <div key={step} className="sf-rise mx-auto flex w-full max-w-md flex-1 flex-col px-5 pb-[max(28px,env(safe-area-inset-bottom))]">
                {step === 0 && (
                    <DocumentsStep
                        docs={docs}
                        doneCount={doneCount}
                        welcome={nothingYet}
                        uploadingDoc={uploadingDoc}
                        error={error}
                        onUploadDoc={onUploadDoc}
                        onContinue={() => setPicked(null)}
                        canContinue={docsDone}
                    />
                )}
                {step === 1 && (
                    <VehicleStep
                        vehicle={vehicle}
                        saving={savingVehicle}
                        error={error}
                        onSave={onSaveVehicle}
                    />
                )}
                {step === 2 && (
                    <ReviewStep
                        docs={docs}
                        vehicle={vehicle}
                        submitting={submitting}
                        error={error}
                        onEditDocs={() => setPicked(0)}
                        onEditVehicle={() => setPicked(1)}
                        onSubmit={onSubmit}
                    />
                )}
                {step === 3 && (
                    <ApprovalStep
                        status={status}
                        rejectionReason={rejectionReason}
                        refreshing={refreshing}
                        onRefresh={onRefresh}
                        onFix={() => setPicked(0)}
                    />
                )}
            </div>
        </main>
    );
}

function Stepper({ step, autoStep, onPick }) {
    return (
        <nav aria-label="Setup progress" className="mx-auto w-full max-w-md px-5 pb-2 pt-6">
            <p className="mb-3 text-sm font-bold uppercase tracking-wider text-pd-accent-text">
                Step {step + 1} of {SETUP_STEPS.length}
            </p>
            <ol className="flex items-start">
                {SETUP_STEPS.map((item, index) => {
                    const done = index < autoStep;
                    const current = index === step;
                    const clickable = done && index !== step;

                    return (
                        <li key={item.id} className="flex flex-1 flex-col items-start last:flex-none">
                            <div className="flex w-full items-center">
                                <button
                                    type="button"
                                    disabled={!clickable}
                                    onClick={() => onPick(index)}
                                    aria-current={current ? "step" : undefined}
                                    aria-label={`${item.label}${done ? ", done" : current ? ", current step" : ""}`}
                                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 text-sm font-extrabold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-pd-accent ${
                                        done
                                            ? "border-pd-accent bg-pd-accent text-pd-accent-ink"
                                            : current
                                                ? "border-pd-accent bg-pd-accent-soft text-pd-accent-text"
                                                : "border-pd-line-strong bg-pd-surface text-pd-faint"
                                    }`}
                                >
                                    {done ? <Check className="h-5 w-5" aria-hidden="true" /> : index + 1}
                                </button>
                                {index < SETUP_STEPS.length - 1 && (
                                    <span
                                        aria-hidden="true"
                                        className={`mx-1.5 h-1 flex-1 rounded-full transition-colors ${done ? "bg-pd-accent" : "bg-pd-line"}`}
                                    />
                                )}
                            </div>
                            <span className={`mt-1.5 text-xs font-bold ${current ? "text-pd-text" : "text-pd-muted"}`}>
                                {item.label}
                            </span>
                        </li>
                    );
                })}
            </ol>
        </nav>
    );
}

function StepHeading({ title, text }) {
    return (
        <div className="pb-5 pt-5">
            <h1 className="text-balance text-3xl font-extrabold leading-tight tracking-tight">{title}</h1>
            {text && <p className="mt-2 text-pretty text-lg leading-relaxed text-pd-muted">{text}</p>}
        </div>
    );
}

function ErrorNote({ message }) {
    if (!message) return null;
    return (
        <p role="alert" className="mb-4 flex items-start gap-2 rounded-2xl border border-pd-danger bg-pd-danger-soft px-4 py-3 text-base font-semibold text-pd-danger">
            <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
            {message}
        </p>
    );
}

function DocumentsStep({ docs, doneCount, welcome, uploadingDoc, error, onUploadDoc, onContinue, canContinue }) {
    return (
        <>
            <StepHeading
                title={welcome ? "Welcome to Safar" : "Upload your documents"}
                text={
                    welcome
                        ? "Your account is ready. Let us set it up in a few easy steps. First, upload 4 documents."
                        : `${doneCount} of ${SETUP_DOCS.length} uploaded. Take a clear photo of each one.`
                }
            />
            <ErrorNote message={error} />
            <ul className="flex flex-col gap-3">
                {SETUP_DOCS.map((doc) => (
                    <DocRow
                        key={doc.type}
                        doc={doc}
                        status={docs[doc.type] || "NONE"}
                        busy={uploadingDoc === doc.type}
                        locked={Boolean(uploadingDoc) && uploadingDoc !== doc.type}
                        onUpload={onUploadDoc}
                    />
                ))}
            </ul>
            <div className="mt-auto pt-6">
                <button type="button" className={primaryButton} disabled={!canContinue} onClick={onContinue}>
                    Continue
                </button>
                {!canContinue && (
                    <p className="mt-3 text-center text-base text-pd-muted">Upload all 4 documents to continue.</p>
                )}
            </div>
        </>
    );
}

function DocRow({ doc, status, busy, locked, onUpload }) {
    const inputRef = useRef(null);
    const [expiry, setExpiry] = useState("");
    const Icon = DOC_ICONS[doc.icon] || FileText;
    const isReady = ready(status);
    const needsDate = doc.needsExpiry && !isReady;
    const rejected = status === "REJECTED";

    const tone = status === "APPROVED"
        ? "text-pd-success"
        : status === "UPLOADED"
            ? "text-pd-accent-text"
            : rejected
                ? "text-pd-danger"
                : "text-pd-muted";

    function handleFile(event) {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (file) onUpload?.(doc.type, file, doc.needsExpiry ? expiry : "");
    }

    return (
        <li className={`rounded-3xl border bg-pd-surface p-4 shadow-pd ${isReady ? "border-pd-accent/50" : rejected ? "border-pd-danger" : "border-pd-line"}`}>
            <div className="flex items-center gap-3">
                <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${isReady ? "bg-pd-accent text-pd-accent-ink" : "bg-pd-accent-soft text-pd-accent-text"}`}>
                    {isReady ? <Check className="h-6 w-6" aria-hidden="true" /> : <Icon className="h-6 w-6" aria-hidden="true" />}
                </span>
                <div className="min-w-0 flex-1">
                    <p className="text-lg font-extrabold leading-tight">{doc.title}</p>
                    <p className={`text-sm font-semibold ${tone}`}>{DOC_STATUS_TEXT[status] || DOC_STATUS_TEXT.NONE}</p>
                </div>
            </div>

            {needsDate && (
                <div className="mt-3">
                    <label htmlFor={`expiry-${doc.type}`} className="mb-1.5 block text-sm font-bold text-pd-muted">
                        Expiry date on the document
                    </label>
                    <input
                        id={`expiry-${doc.type}`}
                        type="date"
                        value={expiry}
                        min={new Date().toISOString().slice(0, 10)}
                        onChange={(event) => setExpiry(event.target.value)}
                        className={inputClass}
                    />
                </div>
            )}

            {(!isReady || rejected) && (
                <>
                    <input ref={inputRef} type="file" accept="image/*,.pdf" capture={undefined} hidden onChange={handleFile} />
                    <button
                        type="button"
                        disabled={busy || locked || (needsDate && !expiry)}
                        onClick={() => inputRef.current?.click()}
                        className="mt-3 flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-pd-accent px-5 text-base font-extrabold text-pd-accent-ink outline-none transition-transform active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-pd-accent focus-visible:ring-offset-2 focus-visible:ring-offset-pd-surface disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        {busy ? (
                            <><Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> Uploading…</>
                        ) : (
                            <><Camera className="h-5 w-5" aria-hidden="true" /> {needsDate && !expiry ? "Pick the expiry date first" : `Upload ${doc.title}`}</>
                        )}
                    </button>
                </>
            )}
        </li>
    );
}

function VehicleStep({ vehicle, saving, error, onSave }) {
    const [form, setForm] = useState({ ...EMPTY_VEHICLE_FORM });
    const [part, setPart] = useState(0);
    const [formError, setFormError] = useState("");
    const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));

    function next() {
        if (!form.vehicleType) {
            setFormError("Choose what you drive.");
            return;
        }
        setFormError("");
        setPart(1);
    }

    function save(event) {
        event.preventDefault();
        const message = validateVehicleForm(form);
        if (message) {
            setFormError(message);
            return;
        }
        setFormError("");
        onSave?.({
            ...form,
            registrationNumber: form.registrationNumber.trim().toUpperCase(),
        });
    }

    if (vehicle) {
        return (
            <>
                <StepHeading title="Your vehicle is added" text="You can change it later from My Vehicles." />
                <VehicleSummary vehicle={vehicle} />
            </>
        );
    }

    if (part === 0) {
        return (
            <>
                <StepHeading title="What do you drive?" text="Tap your vehicle." />
                <ErrorNote message={formError || error} />
                <div role="radiogroup" aria-label="Vehicle type" className="grid grid-cols-2 gap-3">
                    {VEHICLE_CHOICES.map((choice) => {
                        const selected = form.vehicleType === choice.id;
                        return (
                            <button
                                key={choice.id}
                                type="button"
                                role="radio"
                                aria-checked={selected}
                                onClick={() => set("vehicleType", choice.id)}
                                className={`flex min-h-[10.5rem] flex-col items-center justify-between rounded-3xl border-2 p-4 text-center outline-none transition-all focus-visible:ring-2 focus-visible:ring-pd-accent ${
                                    selected ? "border-pd-accent bg-pd-accent-soft shadow-pd" : "border-pd-line bg-pd-surface"
                                }`}
                            >
                                <img src={choice.sprite} alt="" className="h-20 w-auto object-contain" />
                                <span>
                                    <span className="block text-lg font-extrabold leading-tight">{choice.label}</span>
                                    <span className="block text-sm text-pd-muted">{choice.sub}</span>
                                </span>
                            </button>
                        );
                    })}
                </div>
                <div className="mt-auto pt-6">
                    <button type="button" className={primaryButton} onClick={next}>Continue</button>
                </div>
            </>
        );
    }

    return (
        <form onSubmit={save} className="flex flex-1 flex-col">
            <StepHeading title="Tell us about your vehicle" text="Only the number plate is a must." />
            <ErrorNote message={formError || error} />
            <div className="flex flex-col gap-4">
                <Field id="veh-plate" label="Number plate" value={form.registrationNumber} onChange={(v) => set("registrationNumber", v.toUpperCase())} placeholder="e.g. LEA-1234" autoCapitalize="characters" />
                <div className="grid grid-cols-2 gap-3">
                    <Field id="veh-make" label="Make" value={form.make} onChange={(v) => set("make", v)} placeholder="Honda" />
                    <Field id="veh-model" label="Model" value={form.model} onChange={(v) => set("model", v)} placeholder="City" />
                </div>
                <Field id="veh-year" label="Model year" value={form.modelYear} onChange={(v) => set("modelYear", v.replace(/\D/g, "").slice(0, 4))} placeholder="2020" inputMode="numeric" />
                <fieldset>
                    <legend className="mb-2 text-sm font-bold text-pd-muted">Colour</legend>
                    <div className="flex flex-wrap gap-2.5">
                        {COLOR_CHOICES.map((color) => {
                            const selected = form.color === color.name;
                            return (
                                <button
                                    key={color.name}
                                    type="button"
                                    aria-pressed={selected}
                                    aria-label={color.name}
                                    onClick={() => set("color", selected ? "" : color.name)}
                                    className={`flex h-12 w-12 items-center justify-center rounded-full border-2 outline-none focus-visible:ring-2 focus-visible:ring-pd-accent ${selected ? "border-pd-accent" : "border-pd-line-strong"}`}
                                >
                                    <span className="flex h-8 w-8 items-center justify-center rounded-full border border-pd-line" style={{ backgroundColor: color.hex }}>
                                        {selected && <Check className="h-4 w-4 text-pd-text mix-blend-difference" aria-hidden="true" />}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                </fieldset>
            </div>
            <div className="mt-auto flex flex-col gap-3 pt-6">
                <button type="submit" disabled={saving} className={primaryButton}>
                    {saving ? <><Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> Saving…</> : "Save vehicle"}
                </button>
                <button type="button" onClick={() => setPart(0)} className="min-h-12 text-base font-bold text-pd-muted">
                    Change vehicle type
                </button>
            </div>
        </form>
    );
}

function Field({ id, label, value, onChange, ...rest }) {
    return (
        <div>
            <label htmlFor={id} className="mb-1.5 block text-sm font-bold text-pd-muted">{label}</label>
            <input id={id} value={value} onChange={(event) => onChange(event.target.value)} className={inputClass} {...rest} />
        </div>
    );
}

function VehicleSummary({ vehicle }) {
    const choice = VEHICLE_CHOICES.find((item) => item.id === vehicle.vehicleType) || VEHICLE_CHOICES[2];
    const detail = [vehicle.make, vehicle.model, vehicle.color].filter(Boolean).join(" · ");

    return (
        <div className="flex items-center gap-4 rounded-3xl border border-pd-line bg-pd-surface p-4 shadow-pd">
            <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-pd-accent-soft">
                <img src={choice.sprite} alt="" className="h-12 w-auto object-contain" />
            </span>
            <div className="min-w-0">
                <p className="text-lg font-extrabold leading-tight">{choice.label}</p>
                <p className="truncate text-base font-bold tracking-wider text-pd-accent-text">{vehicle.registrationNumber}</p>
                {detail && <p className="truncate text-sm text-pd-muted">{detail}</p>}
            </div>
        </div>
    );
}

function ReviewStep({ docs, vehicle, submitting, error, onEditDocs, onEditVehicle, onSubmit }) {
    return (
        <>
            <StepHeading title="Everything look right?" text="Check once, then send it to us." />
            <ErrorNote message={error} />
            <section aria-label="Documents" className="rounded-3xl border border-pd-line bg-pd-surface p-4 shadow-pd">
                <div className="mb-2 flex items-center justify-between">
                    <h2 className="text-base font-extrabold">Documents</h2>
                    <button type="button" onClick={onEditDocs} className="min-h-11 px-2 text-sm font-bold text-pd-accent-text">Change</button>
                </div>
                <ul className="flex flex-col gap-2">
                    {SETUP_DOCS.map((doc) => (
                        <li key={doc.type} className="flex items-center justify-between gap-3 text-base">
                            <span>{doc.title}</span>
                            <span className="flex items-center gap-1.5 font-bold text-pd-success">
                                <Check className="h-4 w-4" aria-hidden="true" /> Uploaded
                            </span>
                        </li>
                    ))}
                </ul>
            </section>
            <section aria-label="Vehicle" className="mt-3">
                <div className="mb-2 flex items-center justify-between">
                    <h2 className="text-base font-extrabold">Vehicle</h2>
                    <button type="button" onClick={onEditVehicle} className="min-h-11 px-2 text-sm font-bold text-pd-accent-text">Change</button>
                </div>
                {vehicle && <VehicleSummary vehicle={vehicle} />}
            </section>
            <div className="mt-auto pt-6">
                <button type="button" onClick={onSubmit} disabled={submitting} className={primaryButton}>
                    {submitting ? <><Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> Sending…</> : <><Upload className="h-5 w-5" aria-hidden="true" /> Submit for checking</>}
                </button>
            </div>
        </>
    );
}

function ApprovalStep({ status, rejectionReason, refreshing, onRefresh, onFix }) {
    const rejected = status === "REJECTED";

    if (rejected) {
        return (
            <>
                <StepHeading title="We need a small fix" text="Some details were not accepted. Please check and send again." />
                {rejectionReason && (
                    <p className="mb-4 rounded-2xl border border-pd-danger bg-pd-danger-soft px-4 py-3 text-base font-semibold text-pd-danger">
                        {rejectionReason}
                    </p>
                )}
                <div className="mt-auto flex flex-col gap-3 pt-6">
                    <button type="button" onClick={onFix} className={primaryButton}>Fix my documents</button>
                    <RefreshButton refreshing={refreshing} onRefresh={onRefresh} />
                </div>
            </>
        );
    }

    return (
        <>
            <div className="flex flex-col items-center pb-2 pt-8 text-center">
                <span className="sf-pulse flex h-24 w-24 items-center justify-center rounded-full bg-pd-accent-soft text-pd-accent-text">
                    <Hourglass className="h-11 w-11" aria-hidden="true" />
                </span>
                <h1 className="mt-6 text-balance text-3xl font-extrabold leading-tight tracking-tight">We are checking your details</h1>
                <p className="mt-2 max-w-sm text-pretty text-lg leading-relaxed text-pd-muted">
                    This usually does not take long. You will be able to go online as soon as you are approved.
                </p>
            </div>
            <ul className="mt-4 flex flex-col gap-2 rounded-3xl border border-pd-line bg-pd-surface p-4 shadow-pd">
                {["Documents sent", "Vehicle added", "Safar team is checking"].map((line, index) => (
                    <li key={line} className="flex items-center gap-3 text-base font-semibold">
                        <span className={`flex h-7 w-7 items-center justify-center rounded-full ${index < 2 ? "bg-pd-accent text-pd-accent-ink" : "bg-pd-accent-soft text-pd-accent-text"}`}>
                            {index < 2 ? <Check className="h-4 w-4" aria-hidden="true" /> : <BadgeCheck className="h-4 w-4" aria-hidden="true" />}
                        </span>
                        {line}
                    </li>
                ))}
            </ul>
            <div className="mt-auto pt-6">
                <RefreshButton refreshing={refreshing} onRefresh={onRefresh} />
            </div>
        </>
    );
}

function RefreshButton({ refreshing, onRefresh }) {
    return (
        <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            className="flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl border border-pd-line-strong bg-pd-surface text-base font-extrabold outline-none focus-visible:ring-2 focus-visible:ring-pd-accent disabled:opacity-60"
        >
            <RefreshCw className={`h-5 w-5 ${refreshing ? "animate-spin" : ""}`} aria-hidden="true" />
            Check my status
        </button>
    );
}
