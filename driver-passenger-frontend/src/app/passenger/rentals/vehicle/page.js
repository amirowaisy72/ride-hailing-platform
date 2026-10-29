"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import {
    ArrowLeft,
    CalendarDays,
    CarFront,
    Check,
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
import { useAuth } from "@/context/AuthContext";
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
    const { token } = useAuth();
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

    useEffect(() => {
        if (!token || !vehicleId) return;
        let cancelled = false;
        getRentalVehicle(vehicleId, token)
            .then((data) => {
                if (cancelled) return;
                const v = data.vehicle || null;
                setVehicle(v);
                if (v) {
                    setMode((v.rentalModes || [])[0] || "WITH_DRIVER");
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

    async function submitBooking(event) {
        event.preventDefault();
        if (submitting || !vehicle) return;
        const start = new Date(startAt);
        const end = new Date(endAt);
        if (!mode) { setError("Choose self-drive or with-driver."); return; }
        if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) {
            setError("Return time must be after the pickup time.");
            return;
        }
        if (!billingUnit) { setError("Choose a billing period."); return; }
        if (mode === "SELF_DRIVE" && (!licenceNumber.trim() || !licenceExpiry)) {
            setError("Your driving licence number and expiry are required for self-drive.");
            return;
        }
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
            router.push(`/passenger/rentals/bookings/details?id=${data.booking._id}`);
        } catch (e) {
            setError(e.message);
            setSubmitting(false);
        }
    }

    const inputCls =
        "w-full rounded-2xl border border-slate-200 bg-[#F9FAFB] px-3.5 py-3 text-sm font-semibold text-[#111111] outline-none focus:border-[#087F5B] focus:ring-2 focus:ring-[#087F5B]/25";

    if (loading) {
        return (
            <main className="flex min-h-dvh items-center justify-center bg-[#F4F5F7] text-sm font-semibold text-slate-500">
                Loading vehicle…
            </main>
        );
    }

    if (!vehicle) {
        return (
            <main className="min-h-dvh bg-[#F4F5F7] pb-28 text-[#111111]">
                <div className="mx-auto max-w-xl px-4 pt-16 text-center">
                    <p className="font-extrabold">Vehicle not available</p>
                    {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
                    <Link href="/passenger/rentals" className="mt-4 inline-block rounded-2xl bg-[#087F5B] px-5 py-3 text-sm font-extrabold text-white">
                        Back to Rentals
                    </Link>
                </div>
                <MobileBottomNav role="PASSENGER" />
            </main>
        );
    }

    const conditionRows = [
        ["Mileage limit", vehicle.mileageLimitKmPerDay ? `${vehicle.mileageLimitKmPerDay} km / day` : "Unlimited"],
        ["Extra km fee", vehicle.extraKmFee ? `${formatPKR(vehicle.extraKmFee)} / km` : "—"],
        ["Fuel policy", vehicle.fuelPolicy || "—"],
        ["Tolls & taxes", vehicle.tollsNote || "—"],
        ["Overtime", vehicle.overtimeFeePerHour ? `${formatPKR(vehicle.overtimeFeePerHour)} / hour` : "—"],
        ["Security deposit (refundable)", formatPKR(vehicle.securityDeposit || 0)],
        ["Insurance", vehicle.insuranceNote || "—"],
        ["Cancellation policy", String(vehicle.cancellationPolicy || "MODERATE").toLowerCase()],
    ];

    return (
        <main className="min-h-dvh bg-[#F4F5F7] pb-28 text-[#111111]">
            <div className="sticky top-0 z-20 border-b border-slate-100 bg-white/95 backdrop-blur-xl">
                <div className="mx-auto flex max-w-xl items-center gap-2 px-3 pb-3 pt-[max(12px,env(safe-area-inset-top))]">
                    <Link href="/passenger/rentals" aria-label="Back to Rentals" className="grid h-11 w-11 place-items-center rounded-2xl hover:bg-[#F4F5F7]">
                        <ArrowLeft size={21} />
                    </Link>
                    <h1 className="min-w-0 flex-1 truncate text-lg font-extrabold tracking-tight">{vehicleTitle(vehicle)}</h1>
                    {vehicle.rating > 0 && (
                        <span className="flex shrink-0 items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-extrabold text-amber-600">
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
                    <div className="grid h-44 place-items-center rounded-[24px] bg-white text-slate-300 shadow-sm">
                        <CarFront size={44} />
                    </div>
                )}

                {/* Basics + pricing */}
                <section className="rounded-[24px] bg-white p-4 shadow-sm">
                    <div className="flex flex-wrap gap-2 text-xs font-bold text-slate-600">
                        <span className="flex items-center gap-1.5 rounded-full bg-[#F4F5F7] px-3 py-1.5"><Users size={13} /> {vehicle.seats} seats</span>
                        <span className="rounded-full bg-[#F4F5F7] px-3 py-1.5">{vehicle.transmission === "AUTOMATIC" ? "Automatic" : "Manual"}</span>
                        <span className="rounded-full bg-[#F4F5F7] px-3 py-1.5">{vehicle.hasAC ? "Air conditioning" : "Non-AC"}</span>
                        {(vehicle.rentalModes || []).map((m) => (
                            <span key={m} className="rounded-full bg-emerald-50 px-3 py-1.5 text-[#087F5B]">
                                {m === "SELF_DRIVE" ? "Self-drive" : "With driver"}
                            </span>
                        ))}
                    </div>
                    <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                        {Object.entries(PRICING_KEY).map(([unit, key]) => {
                            const price = vehicle.pricing?.[key];
                            if (!Number(price)) return null;
                            return (
                                <div key={unit} className="rounded-2xl bg-[#F9FAFB] px-3 py-2.5 text-center">
                                    <p className="text-[15px] font-extrabold text-[#087F5B]">{formatPKR(price)}</p>
                                    <p className="text-[11px] font-bold text-slate-400">{UNIT_LABELS[unit]}</p>
                                </div>
                            );
                        })}
                    </div>
                    <p className="mt-3 flex items-start gap-2 rounded-2xl bg-[#F9FAFB] px-3.5 py-3 text-sm font-medium text-slate-600">
                        <MapPin size={16} className="mt-0.5 shrink-0 text-[#087F5B]" />
                        <span>
                            Pickup area: {vehicle.pickupAreaLabel || "Shared after booking"}
                            <span className="mt-0.5 block text-xs text-slate-400">
                                Exact pickup address & owner contact are shared after your booking is confirmed — this keeps everyone safe from off-platform deals.
                            </span>
                        </span>
                    </p>
                </section>

                {/* Conditions */}
                <section className="rounded-[24px] bg-white p-4 shadow-sm">
                    <h2 className="mb-3 flex items-center gap-2 text-[15px] font-extrabold">
                        <ShieldCheck size={17} className="text-[#087F5B]" /> Rental terms
                    </h2>
                    <dl className="divide-y divide-slate-50">
                        {conditionRows.map(([label, value]) => (
                            <div key={label} className="flex items-start justify-between gap-4 py-2 text-sm">
                                <dt className="flex shrink-0 items-center gap-1.5 font-semibold text-slate-500">
                                    {label === "Mileage limit" && <Gauge size={14} />}
                                    {label === "Fuel policy" && <Fuel size={14} />}
                                    {label}
                                </dt>
                                <dd className="text-right font-semibold capitalize">{value}</dd>
                            </div>
                        ))}
                    </dl>
                </section>

                {/* Booking form */}
                <form onSubmit={submitBooking} className="space-y-3 rounded-[24px] bg-white p-4 shadow-sm" noValidate>
                    <h2 className="flex items-center gap-2 text-[15px] font-extrabold">
                        <CalendarDays size={17} className="text-[#087F5B]" /> Book this car
                    </h2>

                    <div>
                        <p className="mb-1.5 text-xs font-bold text-slate-600">How do you want it?</p>
                        <div className="grid grid-cols-2 gap-1 rounded-2xl bg-[#F4F5F7] p-1" role="radiogroup" aria-label="Rental mode">
                            {(vehicle.rentalModes || []).map((m) => (
                                <button
                                    key={m}
                                    type="button"
                                    role="radio"
                                    aria-checked={mode === m}
                                    onClick={() => setMode(m)}
                                    className={`min-h-11 rounded-xl text-sm font-bold ${mode === m ? "bg-white text-[#111111] shadow-sm" : "text-slate-500"}`}
                                >
                                    {m === "SELF_DRIVE" ? "Self-drive" : "With driver"}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label htmlFor="v-start" className="mb-1.5 block text-xs font-bold text-slate-600">Pickup</label>
                            <input id="v-start" type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} className={inputCls} />
                        </div>
                        <div>
                            <label htmlFor="v-end" className="mb-1.5 block text-xs font-bold text-slate-600">Return</label>
                            <input id="v-end" type="datetime-local" value={endAt} onChange={(e) => setEndAt(e.target.value)} className={inputCls} />
                        </div>
                    </div>

                    <div>
                        <label htmlFor="v-unit" className="mb-1.5 block text-xs font-bold text-slate-600">Billing period</label>
                        <select id="v-unit" value={billingUnit} onChange={(e) => setBillingUnit(e.target.value)} className={inputCls}>
                            {availableUnits.map((unit) => (
                                <option key={unit} value={unit}>
                                    {UNIT_LABELS[unit]} — {formatPKR(vehicle.pricing[PRICING_KEY[unit]])}
                                </option>
                            ))}
                        </select>
                    </div>

                    {mode === "SELF_DRIVE" && (
                        <div className="space-y-3 rounded-2xl bg-[#F9FAFB] p-3.5">
                            <p className="flex items-center gap-2 text-sm font-extrabold">
                                <KeyRound size={15} className="text-[#087F5B]" /> Your driving licence
                            </p>
                            <div>
                                <label htmlFor="v-licence" className="mb-1.5 block text-xs font-bold text-slate-600">Licence number</label>
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
                                <label htmlFor="v-licence-expiry" className="mb-1.5 block text-xs font-bold text-slate-600">Licence expiry date</label>
                                <input
                                    id="v-licence-expiry"
                                    type="date"
                                    value={licenceExpiry}
                                    onChange={(e) => setLicenceExpiry(e.target.value)}
                                    className={inputCls}
                                />
                            </div>
                            <p className="text-xs text-slate-400">Bring the original licence at pickup — the owner will verify it before handover.</p>
                        </div>
                    )}

                    {error && <p role="alert" className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-600">{error}</p>}

                    <button
                        type="submit"
                        disabled={submitting}
                        className="flex h-14 w-full items-center justify-center gap-2 rounded-[20px] bg-[#087F5B] text-[15px] font-extrabold text-white shadow-sm transition-transform active:scale-[0.99] disabled:opacity-60"
                    >
                        {submitting ? (
                            <><Loader2 size={19} className="animate-spin" /> Sending request…</>
                        ) : (
                            <><Check size={19} /> Request booking</>
                        )}
                    </button>
                    <p className="text-center text-xs leading-relaxed text-slate-400">
                        The owner reviews your request first. You only pay the small Safar
                        booking fee after they accept — the rental itself is settled with the
                        owner at pickup, and the security deposit is refundable.
                    </p>
                </form>
            </div>

            <MobileBottomNav role="PASSENGER" />
        </main>
    );
}
