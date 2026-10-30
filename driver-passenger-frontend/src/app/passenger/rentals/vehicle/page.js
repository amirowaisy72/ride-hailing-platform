"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import {
    ArrowLeft,
    CalendarDays,
    CarFront,
    Check,
    Clock,
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
import ServiceGuide from "@/components/guides/ServiceGuide";
import { recordFlowCompletion } from "@/lib/guides/guideStore";
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

const UNIT_LABELS_UR = {
    HOURLY: "گھنٹہ وار",
    DAILY: "روزانہ",
    WEEKLY: "ہفتہ وار",
    MONTHLY: "ماہانہ",
};

function unitLabel(unit) {
    if (storedLanguage() === "ur") return UNIT_LABELS_UR[unit] || UNIT_LABELS[unit] || unit;
    return UNIT_LABELS[unit] || unit;
}

const UNIT_LABELS = {
    HOURLY: "Hourly",
    DAILY: "Daily",
    WEEKLY: "Weekly",
    MONTHLY: "Monthly",
};

const PRICING_KEY = {
    HOURLY: "hourly",
    DAILY: "daily",
    WEEKLY: "weekly",
    MONTHLY: "monthly",
};

function toLocalInput(date) {
    const pad = (n) => String(n).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function VehicleDetail() {
    const { user, token } = useAuth();
    const { t } = useLanguage();
    const router = useRouter();
    const searchParams = useSearchParams();
    const vehicleId = String(searchParams.get("vehicleId") || "");

    const [vehicle, setVehicle] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [mode, setMode] = useState("");
    const [startAt, setStartAt] = useState(() => toLocalInput(new Date(Date.now() + 2 * 60 * 60 * 1000)));
    const [endAt, setEndAt] = useState(() => toLocalInput(new Date(Date.now() + 26 * 60 * 60 * 1000)));
    const [billingUnit, setBillingUnit] = useState("");
    const [licenceNumber, setLicenceNumber] = useState("");
    const [licenceExpiry, setLicenceExpiry] = useState("");
    const [submitting, setSubmitting] = useState(false);
    // A18: booking form steps — 1 When & how, 2 Your details, 3 Review.
    const [step, setStep] = useState(1);

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
                    setMode(modes[0] || "WITH_DRIVER");
                    const available = Object.keys(PRICING_KEY).find(
                        (unit) => Number(v.pricing?.[PRICING_KEY[unit]]) >= 1
                    );
                    setBillingUnit(available || "DAILY");
                }
            })
            .catch((e) => { if (!cancelled) setError(e.message); })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [token, vehicleId]);

    const photos = useMemo(() => {
        const p = vehicle?.photos || {};
        return [...(p.exterior || []), ...(p.interior || []), ...(p.condition || [])];
    }, [vehicle]);

    const availableUnits = useMemo(
        () => Object.keys(PRICING_KEY).filter((unit) => Number(vehicle?.pricing?.[PRICING_KEY[unit]]) >= 1),
        [vehicle]
    );

    function validateWhenHow() {
        const start = new Date(startAt);
        const end = new Date(endAt);
        if (!mode) { setError(t("rentals.errChooseMode")); return false; }
        if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) {
            setError(t("rentals.errReturnAfter"));
            return false;
        }
        if (!billingUnit) { setError(t("rentals.errChooseBilling")); return false; }
        return true;
    }

    function validateDetails() {
        if (mode === "SELF_DRIVE" && (!licenceNumber.trim() || !licenceExpiry)) {
            setError(t("rentals.errLicence"));
            return false;
        }
        return true;
    }

    function goNext() {
        setError("");
        if (step === 1) {
            if (!validateWhenHow()) return;
            setStep(2);
        } else if (step === 2) {
            if (!validateDetails()) return;
            setStep(3);
        }
    }

    async function submitBooking(event) {
        event.preventDefault();
        if (submitting || !vehicle) return;
        // Steps 1–2 advance instead of submitting; only the Review
        // step's primary button places the request.
        if (step < 3) {
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
                    billingUnit,
                    ...(mode === "SELF_DRIVE"
                        ? { renterLicence: { number: licenceNumber.trim(), expiryDate: licenceExpiry } }
                        : {}),
                },
                token
            );
            recordFlowCompletion(user?._id, "rentalPassenger");
            router.push(`/passenger/rentals/bookings/details?id=${data.booking._id}`);
        } catch (e) {
            setError(e.message);
            setSubmitting(false);
        }
    }

    const inputCls =
        "w-full rounded-2xl border border-pd-line bg-pd-surface-2 px-3.5 py-3 text-sm font-semibold text-pd-text outline-none focus:border-[#087F5B] focus:ring-2 focus:ring-[#087F5B]/25";

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
                <ServiceGuide serviceId="rentalPassenger" userId={user?._id} />
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

    const stepTitles = [t("rentals.stepWhenHow"), t("rentals.stepYourDetails"), t("rentals.stepReview")];
    const primaryBtnCls =
        "flex h-14 w-full items-center justify-center gap-2 rounded-[20px] bg-[#087F5B] text-[15px] font-extrabold text-white shadow-sm transition-transform active:scale-[0.99] disabled:opacity-60";
    const backBtnCls =
        "flex h-14 items-center justify-center gap-1.5 rounded-[20px] bg-pd-surface-2 px-5 text-[15px] font-extrabold text-pd-text transition-transform active:scale-[0.99]";

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

                {/* Basics + pricing */}
                <section className="rounded-[24px] bg-pd-surface p-4 shadow-sm">
                    <div className="flex flex-wrap gap-2 text-xs font-bold text-pd-text-2">
                        <span className="flex items-center gap-1.5 rounded-full bg-pd-surface-2 px-3 py-1.5"><Users size={13} /> {vehicle.seats} seats</span>
                        <span className="rounded-full bg-pd-surface-2 px-3 py-1.5">{vehicle.transmission === "AUTOMATIC" ? t("rentals.automatic") : t("rentals.manual")}</span>
                        <span className="rounded-full bg-pd-surface-2 px-3 py-1.5">{vehicle.hasAC ? t("rentals.airCon") : t("rentals.nonAc")}</span>
                        {(vehicle.rentalModes || []).map((m) => (
                            <span key={m} className="rounded-full bg-pd-accent-soft px-3 py-1.5 text-pd-accent-text">
                                {m === "SELF_DRIVE" ? t("rentals.selfDrive") : t("rentals.withDriver")}
                            </span>
                        ))}
                    </div>
                    <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                        {Object.entries(PRICING_KEY).map(([unit, key]) => {
                            const price = vehicle.pricing?.[key];
                            if (!Number(price)) return null;
                            return (
                                <div key={unit} className="rounded-2xl bg-pd-surface-2 px-3 py-2.5 text-center">
                                    <p className="text-[15px] font-extrabold text-[#087F5B]">{formatPKR(price)}</p>
                                    <p className="text-[11px] font-bold text-pd-faint">{unitLabel(unit)}</p>
                                </div>
                            );
                        })}
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

                {/* Conditions */}
                <section className="rounded-[24px] bg-pd-surface p-4 shadow-sm">
                    <h2 className="mb-3 flex items-center gap-2 text-[15px] font-extrabold">
                        <ShieldCheck size={17} className="text-[#087F5B]" /> Rental terms
                    </h2>
                    <dl className="divide-y divide-pd-line">
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
                </section>

                {/* Booking form — 3 short steps (A18) */}
                <form onSubmit={submitBooking} className="space-y-3 rounded-[24px] bg-pd-surface p-4 shadow-sm" noValidate>
                    <h2 className="flex items-center gap-2 text-[15px] font-extrabold">
                        <CalendarDays size={17} className="text-[#087F5B]" /> Book this car
                    </h2>

                    <ol className="flex items-center gap-2" aria-label={t("rentals.bookingSteps")}>
                        {stepTitles.map((title, i) => {
                            const n = i + 1;
                            const active = step === n;
                            const done = step > n;
                            return (
                                <li key={title} className="flex min-w-0 flex-1 items-center gap-2">
                                    <span
                                        className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-extrabold ${
                                            active || done ? "bg-[#087F5B] text-white" : "bg-pd-surface-3 text-pd-muted"
                                        }`}
                                        aria-current={active ? "step" : undefined}
                                    >
                                        {done ? <Check size={14} /> : n}
                                    </span>
                                    <span className={`truncate text-xs font-bold ${active ? "text-pd-text" : "text-pd-muted"}`}>{title}</span>
                                </li>
                            );
                        })}
                    </ol>

                    {step === 1 && (
                        <>
                            <div>
                                <p className="mb-1.5 text-xs font-bold text-pd-text-2">{t("rentals.howWant")}</p>
                                <div data-guide="rental-mode" className="grid grid-cols-2 gap-1 rounded-2xl bg-pd-surface-2 p-1" role="radiogroup" aria-label={t("rentals.mode")}>
                                    {(vehicle.rentalModes || []).map((m) => (
                                        <button
                                            key={m}
                                            type="button"
                                            role="radio"
                                            aria-checked={mode === m}
                                            onClick={() => setMode(m)}
                                            className={`min-h-11 rounded-xl px-2 text-sm font-bold ${mode === m ? "bg-pd-surface text-pd-text shadow-sm" : "text-pd-muted"}`}
                                        >
                                            {m === "SELF_DRIVE" ? t("rentals.selfDrive") : t("rentals.withDriver")}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label htmlFor="v-start" className="mb-1.5 block text-xs font-bold text-pd-text-2">{t("rentals.pickup")}</label>
                                    <input id="v-start" type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} className={inputCls} />
                                </div>
                                <div>
                                    <label htmlFor="v-end" className="mb-1.5 block text-xs font-bold text-pd-text-2">{t("rentals.return")}</label>
                                    <input id="v-end" type="datetime-local" value={endAt} onChange={(e) => setEndAt(e.target.value)} className={inputCls} />
                                </div>
                            </div>

                            <div>
                                <label htmlFor="v-unit" className="mb-1.5 block text-xs font-bold text-pd-text-2">{t("rentals.billingPeriod")}</label>
                                <select id="v-unit" value={billingUnit} onChange={(e) => setBillingUnit(e.target.value)} className={inputCls}>
                                    {availableUnits.map((unit) => (
                                        <option key={unit} value={unit}>
                                            {unitLabel(unit)} — {formatPKR(vehicle.pricing[PRICING_KEY[unit]])}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            {error && <p role="alert" className="rounded-2xl bg-pd-danger-soft px-4 py-3 text-sm font-semibold text-pd-danger">{error}</p>}

                            <button type="button" onClick={goNext} className={primaryBtnCls}>
                                {t("rentals.next")}
                            </button>
                        </>
                    )}

                    {step === 2 && (
                        <>
                            {mode === "SELF_DRIVE" ? (
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
                                            className={inputCls}
                                        />
                                    </div>
                                    <p className="text-xs text-pd-faint">{t("rentals.licenceHint")}</p>
                                </div>
                            ) : (
                                <p className="rounded-2xl bg-pd-surface-2 px-4 py-3 text-sm leading-relaxed text-pd-text-2">
                                    No licence details needed — a driver comes with the car and
                                    handles the driving. Just be at the pickup area on time with
                                    your ID.
                                </p>
                            )}

                            {error && <p role="alert" className="rounded-2xl bg-pd-danger-soft px-4 py-3 text-sm font-semibold text-pd-danger">{error}</p>}

                            <div className="flex gap-3">
                                <button type="button" onClick={() => { setError(""); setStep(1); }} className={backBtnCls}>
                                    <ArrowLeft size={17} /> {t("common.back")}
                                </button>
                                <button type="button" onClick={goNext} className={`${primaryBtnCls} flex-1`}>
                                    Next
                                </button>
                            </div>
                        </>
                    )}

                    {step === 3 && (
                        <>
                            <dl className="space-y-1.5 rounded-2xl bg-pd-surface-2 px-4 py-3 text-sm">
                                <div className="flex justify-between gap-3"><dt className="text-pd-muted">{t("rentals.reviewVehicle")}</dt><dd className="font-bold">{vehicleTitle(vehicle)}</dd></div>
                                <div className="flex justify-between gap-3"><dt className="text-pd-muted">{t("rentals.reviewMode")}</dt><dd className="font-bold">{mode === "SELF_DRIVE" ? t("rentals.selfDrive") : t("rentals.withDriver")}</dd></div>
                                <div className="flex justify-between gap-3"><dt className="text-pd-muted">{t("rentals.pickup")}</dt><dd className="font-semibold">{new Date(startAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</dd></div>
                                <div className="flex justify-between gap-3"><dt className="text-pd-muted">{t("rentals.return")}</dt><dd className="font-semibold">{new Date(endAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</dd></div>
                                <div className="flex justify-between gap-3"><dt className="text-pd-muted">{t("rentals.billingPeriod")}</dt><dd className="font-bold">{unitLabel(billingUnit)} — {billingUnit ? formatPKR(vehicle.pricing[PRICING_KEY[billingUnit]]) : "—"}</dd></div>
                                <div className="flex justify-between gap-3"><dt className="text-pd-muted">{t("rentals.securityDeposit")}</dt><dd className="font-semibold">{formatPKR(vehicle.securityDeposit || 0)}</dd></div>
                                {mode === "SELF_DRIVE" && (
                                    <div className="flex justify-between gap-3"><dt className="text-pd-muted">{t("rentals.reviewLicence")}</dt><dd className="font-semibold">{licenceNumber.trim()}</dd></div>
                                )}
                            </dl>

                            {error && <p role="alert" className="rounded-2xl bg-pd-danger-soft px-4 py-3 text-sm font-semibold text-pd-danger">{error}</p>}

                            <div className="flex gap-3">
                                <button type="button" onClick={() => { setError(""); setStep(2); }} className={backBtnCls}>
                                    <ArrowLeft size={17} /> Back
                                </button>
                                <button data-guide="rental-book"
                                    type="submit"
                                    disabled={submitting}
                                    className={`${primaryBtnCls} flex-1`}
                                >
                                    {submitting ? (
                                        <><Loader2 size={19} className="animate-spin" /> Sending request…</>
                                    ) : (
                                        <><Check size={19} /> {t("rentals.requestBooking")}</>
                                    )}
                                </button>
                            </div>
                            <p className="text-center text-xs leading-relaxed text-pd-faint">
                                The owner reviews your request first. You only pay the small Safar
                                booking fee after they accept — the rental itself is settled with the
                                owner at pickup, and the security deposit is refundable.
                            </p>
                        </>
                    )}
                </form>
            </div>

            <MobileBottomNav role="PASSENGER" />
        </main>
    );
}
