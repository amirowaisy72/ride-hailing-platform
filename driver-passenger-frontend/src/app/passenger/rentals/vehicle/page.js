"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import {
    ArrowLeft,
    CarFront,
    Check,
    ChevronDown,
    Fuel,
    Gauge,
    KeyRound,
    Loader2,
    MapPin,
    ShieldCheck,
    Star,
    Users,
} from "lucide-react";
import AuthGuard from "@/components/AuthGuard";
import MobileBottomNav from "@/components/MobileBottomNav";
import RentalWhenPicker, {
    PRICING_KEY,
    availableUnitsOf,
    cheapestUnit,
    defaultWindow,
    estimateTotal,
    formatDuration,
    formatWhen,
    tr,
    usableWindow,
    windowHours,
} from "@/components/rentals/RentalWhenPicker";
import { useAuth } from "@/context/AuthContext";
import { useLanguage, storedLanguage } from "@/components/i18n/LanguageProvider";
import { formatPKR } from "@/lib/rideDisplay";
import { createRentalBooking, getRentalVehicle } from "@/lib/rentalService";
import { vehicleTitle } from "@/lib/rentalDisplay";

export default function RentalVehiclePage() {
    return (
        <AuthGuard role="PASSENGER">
            <VehicleDetail />
        </AuthGuard>
    );
}

const UNIT_LABELS = {
    HOURLY: "Hourly",
    DAILY: "Daily",
    WEEKLY: "Weekly",
    MONTHLY: "Monthly",
};

const UNIT_LABELS_UR = {
    HOURLY: "گھنٹہ وار",
    DAILY: "روزانہ",
    WEEKLY: "ہفتہ وار",
    MONTHLY: "ماہانہ",
};

const UNIT_NOUN = {
    HOURLY: ["hour", "hours", "گھنٹہ", "گھنٹے"],
    DAILY: ["day", "days", "دن", "دن"],
    WEEKLY: ["week", "weeks", "ہفتہ", "ہفتے"],
    MONTHLY: ["month", "months", "مہینہ", "مہینے"],
};

function unitLabel(unit) {
    if (storedLanguage() === "ur") return UNIT_LABELS_UR[unit] || UNIT_LABELS[unit] || unit;
    return UNIT_LABELS[unit] || unit;
}

function unitCount(unit, n) {
    const noun = UNIT_NOUN[unit];
    if (!noun) return String(n);
    return storedLanguage() === "ur" ? `${n} ${n === 1 ? noun[2] : noun[3]}` : `${n} ${n === 1 ? noun[0] : noun[1]}`;
}

function draftKey(vehicleId) {
    return `rental-booking-draft:${vehicleId}`;
}

function VehicleDetail() {
    const { token } = useAuth();
    const { t } = useLanguage();
    const router = useRouter();
    const searchParams = useSearchParams();
    const vehicleId = String(searchParams.get("vehicleId") || "");
    const fromStart = searchParams.get("startAt") || "";
    const fromEnd = searchParams.get("endAt") || "";
    const formRef = useRef(null);

    const [vehicle, setVehicle] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [errorField, setErrorField] = useState("");
    const [mode, setMode] = useState("");
    const [window_, setWindow] = useState(() => usableWindow(fromStart, fromEnd) || defaultWindow());
    const [billingUnit, setBillingUnit] = useState("");
    const [unitTouched, setUnitTouched] = useState(false);
    const [licenceNumber, setLicenceNumber] = useState("");
    const [licenceExpiry, setLicenceExpiry] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [step, setStep] = useState("when");
    const [draftReady, setDraftReady] = useState(false);

    const { startAt, endAt } = window_;

    useEffect(() => {
        if (!token || !vehicleId) return;
        let cancelled = false;
        getRentalVehicle(vehicleId, token)
            .then((data) => {
                if (cancelled) return;
                const v = data.vehicle || null;
                setVehicle(v);
                if (v) {
                    const modes = v.rentalModes || [];
                    const units = availableUnitsOf(v.pricing);
                    setMode(modes[0] || "WITH_DRIVER");
                    setBillingUnit(units[0] || "DAILY");

                    // Pick up where the renter left off, unless they came
                    // from a search with a different time window.
                    let draft = null;
                    try {
                        draft = JSON.parse(window.sessionStorage.getItem(draftKey(vehicleId)) || "null");
                    } catch { /* No saved draft. */ }
                    if (draft && draft.from === `${fromStart}|${fromEnd}`) {
                        const restored = usableWindow(draft.startAt, draft.endAt);
                        if (restored) setWindow(restored);
                        if (modes.includes(draft.mode)) setMode(draft.mode);
                        if (draft.unitTouched && units.includes(draft.billingUnit)) {
                            setBillingUnit(draft.billingUnit);
                            setUnitTouched(true);
                        }
                        setLicenceNumber(draft.licenceNumber || "");
                        setLicenceExpiry(draft.licenceExpiry || "");
                        if (["when", "details", "review"].includes(draft.step)) setStep(draft.step);
                    }
                }
                setDraftReady(true);
            })
            .catch((e) => { if (!cancelled) setError(e.message); })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [token, vehicleId, fromStart, fromEnd]);

    useEffect(() => {
        if (!draftReady || !vehicleId) return;
        try {
            window.sessionStorage.setItem(
                draftKey(vehicleId),
                JSON.stringify({
                    from: `${fromStart}|${fromEnd}`,
                    mode, startAt, endAt, billingUnit, unitTouched, licenceNumber, licenceExpiry, step,
                })
            );
        } catch { /* Storage blocked — nothing to keep. */ }
    }, [draftReady, vehicleId, fromStart, fromEnd, mode, startAt, endAt, billingUnit, unitTouched, licenceNumber, licenceExpiry, step]);

    const photos = useMemo(() => {
        const p = vehicle?.photos || {};
        return [...(p.exterior || []), ...(p.interior || []), ...(p.condition || [])];
    }, [vehicle]);

    const availableUnits = useMemo(() => availableUnitsOf(vehicle?.pricing), [vehicle]);
    const hours = windowHours(startAt, endAt);
    const suggestedUnit = useMemo(() => cheapestUnit(vehicle?.pricing, hours), [vehicle, hours]);
    // Until the renter picks a unit themselves, the cheapest one for their
    // duration is selected so the total is never higher than it needs to be.
    const activeUnit = unitTouched && billingUnit ? billingUnit : suggestedUnit || billingUnit;
    const estimate = useMemo(() => estimateTotal(vehicle?.pricing, activeUnit, hours), [vehicle, activeUnit, hours]);

    const stepKeys = mode === "SELF_DRIVE" ? ["when", "details", "review"] : ["when", "review"];
    const stepIndex = Math.max(0, stepKeys.indexOf(step));
    const currentStep = stepKeys[stepIndex];

    function fail(message, field = "") {
        setError(message);
        setErrorField(field);
        return false;
    }

    function validateWhenHow() {
        const start = new Date(startAt);
        const end = new Date(endAt);
        if (!mode) return fail(t("rentals.errChooseMode"), "mode");
        if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) {
            return fail(t("rentals.errReturnAfter"), "window");
        }
        if (!activeUnit) return fail(t("rentals.errChooseBilling"), "unit");
        return true;
    }

    function validateDetails() {
        if (mode === "SELF_DRIVE" && (!licenceNumber.trim() || !licenceExpiry)) {
            return fail(t("rentals.errLicence"), "licence");
        }
        return true;
    }

    function moveTo(key) {
        setError("");
        setErrorField("");
        setStep(key);
        formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    function goNext() {
        setError("");
        setErrorField("");
        if (currentStep === "when") {
            if (!validateWhenHow()) return;
        } else if (currentStep === "details") {
            if (!validateDetails()) return;
        }
        moveTo(stepKeys[stepIndex + 1]);
    }

    async function submitBooking(event) {
        event.preventDefault();
        if (submitting || !vehicle) return;
        if (currentStep !== "review") {
            goNext();
            return;
        }
        if (!validateWhenHow() || !validateDetails()) return;
        const start = new Date(startAt);
        const end = new Date(endAt);
        setSubmitting(true);
        setError("");
        try {
            const data = await createRentalBooking(
                {
                    vehicleId,
                    mode,
                    startAt: start.toISOString(),
                    endAt: end.toISOString(),
                    billingUnit: activeUnit,
                    ...(mode === "SELF_DRIVE"
                        ? { renterLicence: { number: licenceNumber.trim(), expiryDate: licenceExpiry } }
                        : {}),
                },
                token
            );
            try { window.sessionStorage.removeItem(draftKey(vehicleId)); } catch { /* ignore */ }
            router.push(`/passenger/rentals/bookings/details?id=${data.booking._id}`);
        } catch (e) {
            setError(e.message);
            setSubmitting(false);
        }
    }

    const inputCls =
        "w-full rounded-2xl border border-pd-line bg-pd-surface px-3.5 py-3 text-sm font-semibold text-pd-text outline-none focus:border-[#087F5B] focus:ring-2 focus:ring-[#087F5B]/25 aria-[invalid=true]:border-pd-danger";

    if (loading) {
        return (
            <main className="flex min-h-dvh items-center justify-center bg-pd-bg text-sm font-semibold text-pd-muted">
                Loading vehicle…
            </main>
        );
    }

    if (!vehicle) {
        return (
            <main className="min-h-dvh bg-pd-bg pb-28 text-pd-text">
                <div className="mx-auto max-w-xl px-4 pt-16 text-center">
                    <p className="font-extrabold">{t("rentals.vehicleUnavailable")}</p>
                    {error && <p className="mt-2 text-sm text-pd-danger">{error}</p>}
                    <Link href="/passenger/rentals" className="mt-4 inline-block rounded-2xl bg-[#087F5B] px-5 py-3 text-sm font-extrabold text-white">
                        {t("rentals.backToRentals")}
                    </Link>
                </div>
                <MobileBottomNav role="PASSENGER" />
            </main>
        );
    }

    const conditionRows = [
        [t("rentals.mileageLimit"), vehicle.mileageLimitKmPerDay ? t("rentals.kmPerDay", { n: vehicle.mileageLimitKmPerDay }) : t("rentals.unlimited")],
        [t("rentals.extraKmFee"), vehicle.extraKmFee ? t("rentals.perKm", { price: formatPKR(vehicle.extraKmFee) }) : "—"],
        [t("rentals.fuelPolicy"), vehicle.fuelPolicy || "—"],
        [t("rentals.tollsTaxes"), vehicle.tollsNote || "—"],
        [t("rentals.overtime"), vehicle.overtimeFeePerHour ? t("rentals.perHourFee", { price: formatPKR(vehicle.overtimeFeePerHour) }) : "—"],
        [t("rentals.securityDeposit"), formatPKR(vehicle.securityDeposit || 0)],
        [t("rentals.insurance"), vehicle.insuranceNote || "—"],
        [t("rentals.cancellationPolicy"), String(vehicle.cancellationPolicy || "MODERATE").toLowerCase()],
    ];

    const stepTitle = {
        when: t("rentals.stepWhenHow"),
        details: t("rentals.stepYourDetails"),
        review: t("rentals.stepReview"),
    };
    const primaryBtnCls =
        "flex h-14 w-full items-center justify-center gap-2 rounded-[20px] bg-[#087F5B] text-[15px] font-extrabold text-white shadow-sm transition-transform active:scale-[0.99] disabled:opacity-60";
    const backBtnCls =
        "flex h-14 items-center justify-center gap-1.5 rounded-[20px] bg-pd-surface-2 px-5 text-[15px] font-extrabold text-pd-text transition-transform active:scale-[0.99]";
    const modeLabel = (m) => (m === "SELF_DRIVE" ? t("rentals.selfDrive") : t("rentals.withDriver"));

    const totalCard = estimate && (
        <div className="rounded-2xl bg-pd-surface-2 px-4 py-3.5 text-pd-text" aria-live="polite">
            <div className="flex items-end justify-between gap-3">
                <div>
                    <p className="text-xs font-bold opacity-80">{tr("Rental total", "کرائے کی کل رقم")}</p>
                    <p className="text-[26px] font-extrabold leading-tight">{formatPKR(estimate.total)}</p>
                </div>
                <p className="text-right text-xs font-semibold opacity-80">
                    {unitCount(activeUnit, estimate.units)} × {formatPKR(estimate.rate)}
                    <span className="block">{formatDuration(hours)}</span>
                </p>
            </div>
            <p className="mt-2 border-t border-pd-line pt-2 text-xs font-medium opacity-80">
                {tr(
                    `Plus a refundable security deposit of ${formatPKR(vehicle.securityDeposit || 0)} at pickup. The booking fee is only due after the owner accepts.`,
                    `اس کے علاوہ پک اپ پر ${formatPKR(vehicle.securityDeposit || 0)} قابلِ واپسی سیکیورٹی ڈپازٹ۔ بکنگ فیس مالک کے قبول کرنے کے بعد ہی دینی ہوگی۔`
                )}
            </p>
        </div>
    );

    return (
        <main className="min-h-dvh bg-pd-bg pb-28 text-pd-text">
            <div className="sticky top-0 z-20 border-b border-pd-line bg-pd-elevated backdrop-blur-xl">
                <div className="mx-auto flex max-w-xl items-center gap-2 px-3 pb-3 pt-[max(12px,env(safe-area-inset-top))]">
                    <Link href="/passenger/rentals" aria-label={t("rentals.backRentals")} className="grid h-11 w-11 place-items-center rounded-2xl hover:bg-pd-surface-2">
                        <ArrowLeft size={21} />
                    </Link>
                    <h1 className="min-w-0 flex-1 truncate text-lg font-extrabold tracking-tight">{vehicleTitle(vehicle)}</h1>
                    {vehicle.rating > 0 && (
                        <span className="flex shrink-0 items-center gap-1 rounded-full bg-pd-warning-soft px-2.5 py-1 text-xs font-extrabold text-pd-warning">
                            <Star size={13} className="fill-amber-400 text-amber-400" />
                            {Number(vehicle.rating).toFixed(1)} ({vehicle.ratingCount || 0})
                        </span>
                    )}
                </div>
            </div>

            <div className="mx-auto max-w-xl space-y-4 px-4 pt-4">
                {/* Photos */}
                {photos.length > 0 ? (
                    <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-1" style={{ scrollbarWidth: "none" }}>
                        {photos.map((url, index) => (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                                key={`${url}-${index}`}
                                src={url}
                                alt={`${vehicleTitle(vehicle)} photo ${index + 1}`}
                                className="h-56 w-[85%] shrink-0 snap-center rounded-[24px] object-cover shadow-sm"
                            />
                        ))}
                    </div>
                ) : (
                    <div className="grid h-44 place-items-center rounded-[24px] bg-pd-surface text-pd-faint shadow-sm">
                        <CarFront size={44} />
                    </div>
                )}

                {/* Basics */}
                <section className="rounded-[24px] bg-pd-surface p-4 shadow-sm">
                    <div className="flex flex-wrap gap-2 text-xs font-bold text-pd-text-2">
                        <span className="flex items-center gap-1.5 rounded-full bg-pd-surface-2 px-3 py-1.5"><Users size={13} /> {vehicle.seats} seats</span>
                        <span className="rounded-full bg-pd-surface-2 px-3 py-1.5">{vehicle.transmission === "AUTOMATIC" ? t("rentals.automatic") : t("rentals.manual")}</span>
                        <span className="rounded-full bg-pd-surface-2 px-3 py-1.5">{vehicle.hasAC ? t("rentals.airCon") : t("rentals.nonAc")}</span>
                        {(vehicle.rentalModes || []).map((m) => (
                            <span key={m} className="rounded-full bg-pd-accent-soft px-3 py-1.5 text-pd-accent-text">
                                {modeLabel(m)}
                            </span>
                        ))}
                    </div>
                    <p className="mt-3 flex items-start gap-2 rounded-2xl bg-pd-surface-2 px-3.5 py-3 text-sm font-medium text-pd-text-2">
                        <MapPin size={16} className="mt-0.5 shrink-0 text-[#087F5B]" />
                        <span>
                            {t("rentals.pickupArea", { area: vehicle.pickupAreaLabel || t("rentals.sharedAfterBooking") })}
                            <span className="mt-0.5 block text-xs text-pd-faint">
                                Exact pickup address & owner contact are shared after your booking is confirmed — this keeps everyone safe from off-platform deals.
                            </span>
                        </span>
                    </p>
                </section>

                {/* Terms stay one tap away, out of the booking path */}
                <details className="group rounded-[24px] bg-pd-surface p-4 shadow-sm">
                    <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 text-[15px] font-extrabold">
                        <span className="flex items-center gap-2"><ShieldCheck size={17} className="text-[#087F5B]" /> {tr("Rental terms", "کرائے کی شرائط")}</span>
                        <ChevronDown size={17} className="transition-transform group-open:rotate-180" aria-hidden="true" />
                    </summary>
                    <dl className="mt-2 divide-y divide-pd-line">
                        {conditionRows.map(([label, value]) => (
                            <div key={label} className="flex items-start justify-between gap-4 py-2 text-sm">
                                <dt className="flex shrink-0 items-center gap-1.5 font-semibold text-pd-muted">
                                    {label === t("rentals.mileageLimit") && <Gauge size={14} />}
                                    {label === t("rentals.fuelPolicy") && <Fuel size={14} />}
                                    {label}
                                </dt>
                                <dd className="text-right font-semibold capitalize">{value}</dd>
                            </div>
                        ))}
                    </dl>
                </details>

                {/* Booking form */}
                <form ref={formRef} onSubmit={submitBooking} className="scroll-mt-24 space-y-4 rounded-[24px] bg-pd-surface p-4 shadow-sm" noValidate>
                    <div>
                        <p className="text-xs font-bold text-pd-muted" aria-live="polite">
                            {tr(`Step ${stepIndex + 1} of ${stepKeys.length}`, `مرحلہ ${stepIndex + 1} از ${stepKeys.length}`)}
                        </p>
                        <h2 className="text-[19px] font-extrabold leading-tight">{stepTitle[currentStep]}</h2>
                        <ol className="mt-3 flex gap-1.5" aria-label={t("rentals.bookingSteps")}>
                            {stepKeys.map((key, i) => (
                                <li
                                    key={key}
                                    aria-current={i === stepIndex ? "step" : undefined}
                                    className={`h-1.5 flex-1 rounded-full ${i <= stepIndex ? "bg-[#087F5B]" : "bg-pd-surface-3"}`}
                                >
                                    <span className="sr-only">{stepTitle[key]}</span>
                                </li>
                            ))}
                        </ol>
                    </div>

                    {currentStep === "when" && (
                        <>
                            {(vehicle.rentalModes || []).length > 1 && (
                                <div>
                                    <p className="mb-2 text-xs font-bold text-pd-text-2">{t("rentals.howWant")}</p>
                                    <div className="grid grid-cols-2 gap-1 rounded-2xl bg-pd-surface-2 p-1" role="radiogroup" aria-label={t("rentals.mode")}>
                                        {(vehicle.rentalModes || []).map((m) => (
                                            <button
                                                key={m}
                                                type="button"
                                                role="radio"
                                                aria-checked={mode === m}
                                                onClick={() => setMode(m)}
                                                className={`min-h-12 rounded-xl px-2 text-sm font-bold ${mode === m ? "bg-pd-surface text-pd-text shadow-sm" : "text-pd-muted"}`}
                                            >
                                                {modeLabel(m)}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}

                            <RentalWhenPicker startAt={startAt} endAt={endAt} onChange={setWindow} idPrefix="v" />

                            <div>
                                <p id="v-unit-label" className="mb-2 text-xs font-bold text-pd-text-2">{t("rentals.billingPeriod")}</p>
                                <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-labelledby="v-unit-label">
                                    {availableUnits.map((unit) => {
                                        const selected = activeUnit === unit;
                                        const unitEstimate = estimateTotal(vehicle.pricing, unit, hours);
                                        return (
                                            <button
                                                key={unit}
                                                type="button"
                                                role="radio"
                                                aria-checked={selected}
                                                onClick={() => { setBillingUnit(unit); setUnitTouched(true); }}
                                                className={`rounded-2xl border-2 px-3 py-2.5 text-left transition-colors ${
                                                    selected ? "border-[#087F5B] bg-pd-success-soft" : "border-transparent bg-pd-surface-2"
                                                }`}
                                            >
                                                <span className="flex items-center justify-between gap-1">
                                                    <span className="text-[13px] font-extrabold">{unitLabel(unit)}</span>
                                                    {availableUnits.length > 1 && unit === suggestedUnit && (
                                                        <span className="rounded-full bg-[#087F5B] px-2 py-0.5 text-[10px] font-extrabold text-white">{tr("Best price", "بہترین قیمت")}</span>
                                                    )}
                                                </span>
                                                <span className="block text-[15px] font-extrabold text-[#087F5B]">{formatPKR(vehicle.pricing[PRICING_KEY[unit]])}</span>
                                                {unitEstimate && (
                                                    <span className="block text-xs font-semibold text-pd-muted">
                                                        {tr("Total", "کل")} {formatPKR(unitEstimate.total)}
                                                    </span>
                                                )}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            {totalCard}

                            {error && <p role="alert" className="rounded-2xl bg-pd-danger-soft px-4 py-3 text-sm font-semibold text-pd-danger">{error}</p>}

                            <button type="button" onClick={goNext} className={primaryBtnCls}>
                                {t("rentals.next")}
                            </button>
                        </>
                    )}

                    {currentStep === "details" && (
                        <>
                            <div className="space-y-3 rounded-2xl bg-pd-surface-2 p-3.5">
                                <p className="flex items-center gap-2 text-sm font-extrabold">
                                    <KeyRound size={15} className="text-[#087F5B]" /> {t("rentals.yourLicence")}
                                </p>
                                <div>
                                    <label htmlFor="v-licence" className="mb-1.5 block text-xs font-bold text-pd-text-2">{t("rentals.licenceNumber")}</label>
                                    <input
                                        id="v-licence"
                                        value={licenceNumber}
                                        onChange={(e) => setLicenceNumber(e.target.value)}
                                        maxLength={40}
                                        placeholder="e.g. RYK-2024-123456"
                                        aria-invalid={errorField === "licence" && !licenceNumber.trim()}
                                        className={inputCls}
                                    />
                                </div>
                                <div>
                                    <label htmlFor="v-licence-expiry" className="mb-1.5 block text-xs font-bold text-pd-text-2">{t("rentals.licenceExpiry")}</label>
                                    <input
                                        id="v-licence-expiry"
                                        type="date"
                                        value={licenceExpiry}
                                        onChange={(e) => setLicenceExpiry(e.target.value)}
                                        aria-invalid={errorField === "licence" && !licenceExpiry}
                                        className={inputCls}
                                    />
                                </div>
                                <p className="text-xs text-pd-faint">{t("rentals.licenceHint")}</p>
                            </div>

                            {error && <p role="alert" className="rounded-2xl bg-pd-danger-soft px-4 py-3 text-sm font-semibold text-pd-danger">{error}</p>}

                            <div className="flex gap-3">
                                <button type="button" onClick={() => moveTo(stepKeys[stepIndex - 1])} className={backBtnCls}>
                                    <ArrowLeft size={17} /> {t("common.back")}
                                </button>
                                <button type="button" onClick={goNext} className={`${primaryBtnCls} flex-1`}>
                                    {t("rentals.next")}
                                </button>
                            </div>
                        </>
                    )}

                    {currentStep === "review" && (
                        <>
                            {mode !== "SELF_DRIVE" && (
                                <p className="rounded-2xl bg-pd-surface-2 px-4 py-3 text-sm leading-relaxed text-pd-text-2">
                                    {tr(
                                        "No licence details needed — a driver comes with the car and handles the driving. Just be at the pickup area on time with your ID.",
                                        "لائسنس کی تفصیل کی ضرورت نہیں — گاڑی کے ساتھ ڈرائیور آتا ہے۔ بس شناختی کارڈ کے ساتھ وقت پر پک اپ ایریا میں پہنچیں۔"
                                    )}
                                </p>
                            )}

                            <dl className="space-y-1.5 rounded-2xl bg-pd-surface-2 px-4 py-3 text-sm">
                                <div className="flex justify-between gap-3"><dt className="text-pd-muted">{t("rentals.reviewVehicle")}</dt><dd className="text-right font-bold">{vehicleTitle(vehicle)}</dd></div>
                                <div className="flex justify-between gap-3"><dt className="text-pd-muted">{t("rentals.reviewMode")}</dt><dd className="font-bold">{modeLabel(mode)}</dd></div>
                                <div className="flex justify-between gap-3"><dt className="text-pd-muted">{t("rentals.pickup")}</dt><dd className="text-right font-semibold">{formatWhen(startAt)}</dd></div>
                                <div className="flex justify-between gap-3"><dt className="text-pd-muted">{t("rentals.return")}</dt><dd className="text-right font-semibold">{formatWhen(endAt)}</dd></div>
                                <div className="flex justify-between gap-3"><dt className="text-pd-muted">{t("rentals.billingPeriod")}</dt><dd className="font-bold">{unitLabel(activeUnit)} — {activeUnit ? formatPKR(vehicle.pricing[PRICING_KEY[activeUnit]]) : "—"}</dd></div>
                                <div className="flex justify-between gap-3"><dt className="text-pd-muted">{t("rentals.securityDeposit")}</dt><dd className="font-semibold">{formatPKR(vehicle.securityDeposit || 0)}</dd></div>
                                {mode === "SELF_DRIVE" && (
                                    <div className="flex justify-between gap-3"><dt className="text-pd-muted">{t("rentals.reviewLicence")}</dt><dd className="font-semibold">{licenceNumber.trim()}</dd></div>
                                )}
                            </dl>

                            {totalCard}

                            {error && <p role="alert" className="rounded-2xl bg-pd-danger-soft px-4 py-3 text-sm font-semibold text-pd-danger">{error}</p>}

                            <div className="flex gap-3">
                                <button type="button" onClick={() => moveTo(stepKeys[stepIndex - 1])} className={backBtnCls}>
                                    <ArrowLeft size={17} /> {t("common.back")}
                                </button>
                                <button
                                    type="submit"
                                    disabled={submitting}
                                    className={`${primaryBtnCls} flex-1`}
                                >
                                    {submitting ? (
                                        <><Loader2 size={19} className="animate-spin" /> {tr("Sending request…", "درخواست بھیجی جا رہی ہے…")}</>
                                    ) : (
                                        <><Check size={19} /> {t("rentals.requestBooking")}</>
                                    )}
                                </button>
                            </div>
                            <p className="text-center text-xs leading-relaxed text-pd-faint">
                                {tr(
                                    "The owner reviews your request first. You only pay the small Safar booking fee after they accept — the rental itself is settled with the owner at pickup, and the security deposit is refundable.",
                                    "پہلے مالک آپ کی درخواست دیکھتا ہے۔ قبول کرنے کے بعد ہی آپ کو سفر کی معمولی بکنگ فیس دینی ہوگی — کرایہ پک اپ پر مالک کے ساتھ طے ہوگا اور سیکیورٹی ڈپازٹ قابلِ واپسی ہے۔"
                                )}
                            </p>
                        </>
                    )}
                </form>
            </div>

            <MobileBottomNav role="PASSENGER" />
        </main>
    );
}
