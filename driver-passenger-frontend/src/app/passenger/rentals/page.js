"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Geolocation } from "@capacitor/geolocation";
import {
    ArrowLeft,
    CalendarDays,
    CarFront,
    ChevronRight,
    Fuel,
    MapPin,
    RefreshCw,
    Search,
    Star,
    Users,
} from "lucide-react";
import AuthGuard from "@/components/AuthGuard";
import MobileBottomNav from "@/components/MobileBottomNav";
import ServiceGuide from "@/components/guides/ServiceGuide";
import { useAuth } from "@/context/AuthContext";
import { useLanguage, storedLanguage } from "@/components/i18n/LanguageProvider";
import { formatPKR } from "@/lib/rideDisplay";
import { getMyRentalBookings, searchRentalVehicles } from "@/lib/rentalService";
import { vehicleIdOf, vehiclePhoto, vehicleTitle } from "@/lib/rentalDisplay";
import {
    StatusPill,
    rentalStatusMeta,
} from "@/components/order/PurchaseTimeline";

export default function RentalsPage() {
    return (
        <AuthGuard role="PASSENGER">
            <RentalsDashboard />
        </AuthGuard>
    );
}

function priceLine(vehicle) {
    const urdu = storedLanguage() === "ur";
    const pricing = vehicle?.pricing || {};
    if (pricing.daily) return urdu ? `${formatPKR(pricing.daily)} / دن` : `${formatPKR(pricing.daily)} / day`;
    if (pricing.hourly) return urdu ? `${formatPKR(pricing.hourly)} / گھنٹہ` : `${formatPKR(pricing.hourly)} / hour`;
    if (pricing.weekly) return urdu ? `${formatPKR(pricing.weekly)} / ہفتہ` : `${formatPKR(pricing.weekly)} / week`;
    if (pricing.monthly) return urdu ? `${formatPKR(pricing.monthly)} / مہینہ` : `${formatPKR(pricing.monthly)} / month`;
    return urdu ? "قیمت پوچھنے پر" : "Price on request";
}

function RentalsDashboard() {
    const { user, token } = useAuth();
    const { t } = useLanguage();
    const [mode, setMode] = useState("");
    const [startAt, setStartAt] = useState("");
    const [endAt, setEndAt] = useState("");
    const [minSeats, setMinSeats] = useState("");
    const [transmission, setTransmission] = useState("");
    const [maxDailyPrice, setMaxDailyPrice] = useState("");
    const [nearMe, setNearMe] = useState(false);

    const [vehicles, setVehicles] = useState([]);
    const [searching, setSearching] = useState(false);
    const [searched, setSearched] = useState(false);
    const [bookings, setBookings] = useState([]);
    const [error, setError] = useState("");

    const loadBookings = useCallback(async () => {
        if (!token) return;
        try {
            const data = await getMyRentalBookings(token);
            setBookings(data.bookings || []);
        } catch { /* Search stays usable if bookings fail. */ }
    }, [token]);

    useEffect(() => {
        let cancelled = false;
        (async () => { if (!cancelled) await loadBookings(); })();
        return () => { cancelled = true; };
    }, [loadBookings]);

    async function runSearch() {
        if (searching) return;
        setSearching(true);
        setError("");
        try {
            const params = {};
            if (mode) params.mode = mode;
            if (startAt) params.startAt = new Date(startAt).toISOString();
            if (endAt) params.endAt = new Date(endAt).toISOString();
            if (minSeats) params.minSeats = Number(minSeats);
            if (transmission) params.transmission = transmission;
            if (maxDailyPrice) params.maxDailyPrice = Number(maxDailyPrice);
            if (nearMe) {
                try {
                    const position = await Geolocation.getCurrentPosition({
                        enableHighAccuracy: true,
                        timeout: 12000,
                    });
                    params.latitude = position.coords.latitude;
                    params.longitude = position.coords.longitude;
                    params.radiusKm = 50;
                } catch {
                    setError(t("rentals.locationError"));
                }
            }
            const data = await searchRentalVehicles(params, token);
            setVehicles(data.vehicles || []);
            setSearched(true);
        } catch (e) {
            setError(e.message);
        } finally {
            setSearching(false);
        }
    }

    useEffect(() => {
        if (!token) return;
        let cancelled = false;
        (async () => {
            try {
                const data = await searchRentalVehicles({}, token);
                if (!cancelled) {
                    setVehicles(data.vehicles || []);
                    setSearched(true);
                }
            } catch (e) {
                if (!cancelled) setError(e.message);
            }
        })();
        return () => { cancelled = true; };
    }, [token]);

    const inputCls =
        "w-full rounded-2xl border border-pd-line bg-pd-surface-2 px-3.5 py-3 text-sm font-semibold text-pd-text outline-none focus:border-[#087F5B] focus:ring-2 focus:ring-[#087F5B]/25";

    return (
        <main className="min-h-dvh bg-pd-bg pb-28 text-pd-text">
            <div className="sticky top-0 z-20 border-b border-pd-line bg-pd-elevated backdrop-blur-xl">
                <div className="mx-auto flex max-w-xl items-center gap-2 px-3 pb-3 pt-[max(12px,env(safe-area-inset-top))]">
                    <Link href="/passenger" aria-label={t("parcels.backHome")} className="grid h-11 w-11 place-items-center rounded-2xl hover:bg-pd-bg">
                        <ArrowLeft size={21} />
                    </Link>
                    <h1 className="flex-1 text-lg font-extrabold tracking-tight">{t("rentals.title")}</h1>
                    <button type="button" aria-label={t("rentals.refreshBookings")} onClick={() => void loadBookings()} className="grid h-11 w-11 place-items-center rounded-2xl text-pd-muted hover:bg-pd-bg">
                        <RefreshCw size={18} />
                    </button>
                </div>
            </div>

            <div className="mx-auto max-w-xl space-y-5 px-4 pt-4">
                <section className="relative overflow-hidden rounded-[24px] bg-[#111111] p-5 text-white shadow-sm">
                    <div className="absolute -right-8 -top-10 h-40 w-40 rounded-full bg-[#087F5B]/30" aria-hidden="true" />
                    <div className="relative">
                        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/10">
                            <CarFront size={24} aria-hidden="true" />
                        </span>
                        <h2 className="mt-3 text-[22px] font-extrabold leading-tight">{t("rentals.heroTitle")}</h2>
                        <p className="mt-1 max-w-sm text-sm leading-relaxed text-pd-faint">
                            {t("rentals.heroText")}
                        </p>
                    </div>
                </section>

                {/* Search */}
                <section className="space-y-3 rounded-[24px] bg-pd-surface p-4 shadow-sm" aria-labelledby="rental-search-title">
                    <h2 id="rental-search-title" className="flex items-center gap-2 text-[15px] font-extrabold">
                        <Search size={17} className="text-[#087F5B]" /> {t("rentals.findVehicle")}
                    </h2>
                    <div className="grid grid-cols-3 gap-1 rounded-2xl bg-pd-bg p-1" role="radiogroup" aria-label={t("rentals.mode")}>
                        {[
                            ["", t("rentals.anyMode")],
                            ["SELF_DRIVE", t("rentals.selfDrive")],
                            ["WITH_DRIVER", t("rentals.withDriver")],
                        ].map(([value, label]) => (
                            <button
                                key={value || "any"}
                                type="button"
                                role="radio"
                                aria-checked={mode === value}
                                onClick={() => setMode(value)}
                                className={`min-h-10 rounded-xl text-[13px] font-bold ${mode === value ? "bg-pd-surface text-pd-text shadow-sm" : "text-pd-muted"}`}
                            >
                                {label}
                            </button>
                        ))}
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label htmlFor="r-start" className="mb-1.5 block text-xs font-bold text-pd-muted">{t("rentals.pickupFrom")}</label>
                            <input id="r-start" type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} className={inputCls} />
                        </div>
                        <div>
                            <label htmlFor="r-end" className="mb-1.5 block text-xs font-bold text-pd-muted">{t("rentals.returnBy")}</label>
                            <input id="r-end" type="datetime-local" value={endAt} onChange={(e) => setEndAt(e.target.value)} className={inputCls} />
                        </div>
                        <div>
                            <label htmlFor="r-seats" className="mb-1.5 block text-xs font-bold text-pd-muted">{t("rentals.minSeats")}</label>
                            <select id="r-seats" value={minSeats} onChange={(e) => setMinSeats(e.target.value)} className={inputCls}>
                                <option value="">Any</option>
                                {[2, 4, 5, 7, 12].map((n) => <option key={n} value={n}>{t("rentals.seatsPlus", { n })}</option>)}
                            </select>
                        </div>
                        <div>
                            <label htmlFor="r-trans" className="mb-1.5 block text-xs font-bold text-pd-muted">{t("rentals.transmission")}</label>
                            <select id="r-trans" value={transmission} onChange={(e) => setTransmission(e.target.value)} className={inputCls}>
                                <option value="">Any</option>
                                <option value="AUTOMATIC">{t("rentals.automatic")}</option>
                                <option value="MANUAL">{t("rentals.manual")}</option>
                            </select>
                        </div>
                    </div>
                    <div>
                        <label htmlFor="r-max" className="mb-1.5 block text-xs font-bold text-pd-muted">{t("rentals.maxDailyPrice")}</label>
                        <input
                            id="r-max"
                            type="number"
                            inputMode="numeric"
                            min="1"
                            value={maxDailyPrice}
                            onChange={(e) => setMaxDailyPrice(e.target.value.replace(/[^\d]/g, ""))}
                            placeholder="e.g. 8000"
                            className={inputCls}
                        />
                    </div>
                    <label className="flex items-center justify-between gap-3 rounded-2xl bg-pd-surface-2 px-4 py-3">
                        <span className="flex items-center gap-2 text-sm font-bold">
                            <MapPin size={16} className="text-[#087F5B]" /> Near me (within 50 km)
                        </span>
                        <button
                            type="button"
                            role="switch"
                            aria-checked={nearMe}
                            aria-label={t("rentals.nearMe")}
                            onClick={() => setNearMe((v) => !v)}
                            className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${nearMe ? "bg-[#087F5B]" : "bg-pd-surface-3"}`}
                        >
                            <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${nearMe ? "left-[22px]" : "left-0.5"}`} />
                        </button>
                    </label>
                    <button
                        type="button"
                        onClick={() => void runSearch()}
                        disabled={searching}
                        className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[#087F5B] text-sm font-extrabold text-white disabled:opacity-60"
                    >
                        <Search size={17} /> {searching ? t("rentals.searching") : t("rentals.searchVehicles")}
                    </button>
                </section>

                {error && <p role="alert" className="rounded-2xl bg-pd-danger-soft px-4 py-3 text-sm font-semibold text-pd-danger">{error}</p>}

                {/* Results */}
                <section aria-labelledby="vehicles-title">
                    <h2 id="vehicles-title" className="mb-3 px-1 text-xs font-bold uppercase tracking-wider text-pd-muted">
                        Available vehicles {searched && <span className="ml-1 rounded-full bg-pd-surface px-2 py-0.5 text-[10px] text-pd-muted shadow-sm">{vehicles.length}</span>}
                    </h2>
                    {searching && vehicles.length === 0 ? (
                        <div className="space-y-3" aria-busy="true">
                            {[0, 1].map((i) => <div key={i} className="h-28 animate-pulse rounded-[24px] bg-pd-surface shadow-sm" />)}
                        </div>
                    ) : vehicles.length === 0 ? (
                        <div className="rounded-[24px] border border-dashed border-pd-line-strong bg-pd-surface px-5 py-8 text-center shadow-sm">
                            <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-pd-success-soft text-[#087F5B]">
                                <CarFront size={22} />
                            </span>
                            <h3 className="mt-3 font-extrabold">{t("rentals.noMatch")}</h3>
                            <p className="mx-auto mt-1 max-w-xs text-sm text-pd-muted">
                                {t("rentals.noMatchHint")}
                            </p>
                        </div>
                    ) : (
                        <div data-guide="rental-vehicle" className="space-y-3">
                            {vehicles.map((vehicle) => {
                                const photo = vehiclePhoto(vehicle);
                                const vid = vehicleIdOf(vehicle);
                                return (
                                    <Link
                                        key={vid}
                                        href={`/passenger/rentals/vehicle?vehicleId=${vid}`}
                                        className="flex gap-3 rounded-[24px] bg-pd-surface p-3.5 shadow-sm transition-transform active:scale-[0.99]"
                                    >
                                        <span className="grid h-24 w-24 shrink-0 place-items-center overflow-hidden rounded-2xl bg-pd-surface-3 text-pd-faint">
                                            {photo ? (
                                                // eslint-disable-next-line @next/next/no-img-element
                                                <img src={photo} alt={vehicleTitle(vehicle)} className="h-full w-full object-cover" />
                                            ) : (
                                                <CarFront size={30} />
                                            )}
                                        </span>
                                        <span className="min-w-0 flex-1">
                                            <span className="flex items-start justify-between gap-2">
                                                <span className="truncate text-[15px] font-extrabold">{vehicleTitle(vehicle)}</span>
                                                {vehicle.rating > 0 && (
                                                    <span className="flex shrink-0 items-center gap-1 text-xs font-bold text-pd-warning">
                                                        <Star size={13} className="fill-amber-400 text-amber-400" />
                                                        {Number(vehicle.rating).toFixed(1)}
                                                    </span>
                                                )}
                                            </span>
                                            <span className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs font-semibold text-pd-muted">
                                                <span className="flex items-center gap-1"><Users size={12} /> {t("rentals.seats", { n: vehicle.seats })}</span>
                                                <span>{vehicle.transmission === "AUTOMATIC" ? t("rentals.automatic") : t("rentals.manual")}</span>
                                                <span>{vehicle.hasAC ? t("rentals.ac") : t("rentals.nonAc")}</span>
                                                <span>{(vehicle.rentalModes || []).includes("SELF_DRIVE") && (vehicle.rentalModes || []).includes("WITH_DRIVER") ? t("rentals.bothModes") : (vehicle.rentalModes || []).includes("SELF_DRIVE") ? t("rentals.selfDrive") : t("rentals.withDriver")}</span>
                                            </span>
                                            <span className="mt-1 flex items-center gap-1 truncate text-xs font-medium text-pd-faint">
                                                <MapPin size={12} className="shrink-0" /> {vehicle.pickupAreaLabel || t("rentals.pickupAreaAfter")}
                                            </span>
                                            <span className="mt-1.5 block text-[15px] font-extrabold text-[#087F5B]">{priceLine(vehicle)}</span>
                                        </span>
                                        <ChevronRight size={18} className="self-center text-pd-faint" />
                                    </Link>
                                );
                            })}
                        </div>
                    )}
                </section>

                {/* My bookings */}
                {bookings.length > 0 && (
                    <section aria-labelledby="my-bookings-title">
                        <h2 id="my-bookings-title" className="mb-3 px-1 text-xs font-bold uppercase tracking-wider text-pd-muted">
                            {t("rentals.myBookings")}
                        </h2>
                        <div className="space-y-3">
                            {bookings.map((booking) => (
                                <Link
                                    key={booking._id}
                                    href={`/passenger/rentals/bookings/details?id=${booking._id}`}
                                    className="block rounded-[24px] bg-pd-surface p-4 shadow-sm transition-transform active:scale-[0.99]"
                                >
                                    <div className="flex items-start justify-between gap-3">
                                        <p className="min-w-0 flex-1 truncate text-[15px] font-extrabold">
                                            {booking.vehicle ? vehicleTitle(booking.vehicle) : t("rentals.bookingFallback")}
                                        </p>
                                        <StatusPill meta={rentalStatusMeta(booking.status)} />
                                    </div>
                                    <p className="mt-1 flex items-center gap-1.5 text-xs font-semibold text-pd-muted">
                                        <CalendarDays size={13} />
                                        {booking.startAt ? new Date(booking.startAt).toLocaleDateString([], { month: "short", day: "numeric" }) : ""}
                                        {" → "}
                                        {booking.endAt ? new Date(booking.endAt).toLocaleDateString([], { month: "short", day: "numeric" }) : ""}
                                        <span className="text-pd-faint">·</span> Ref {booking.bookingRef}
                                    </p>
                                    <p className="mt-2 text-sm font-extrabold text-[#087F5B]">
                                        {formatPKR(booking.rentalCharges)}
                                        <span className="ml-2 text-xs font-semibold text-pd-faint">
                                            {booking.mode === "SELF_DRIVE" ? t("rentals.selfDrive") : t("rentals.withDriver")} · {String(booking.billingUnit || "").toLowerCase()}
                                        </span>
                                    </p>
                                </Link>
                            ))}
                        </div>
                    </section>
                )}

                <p className="flex items-start gap-2 px-1 text-xs leading-relaxed text-pd-faint">
                    <Fuel size={14} className="mt-0.5 shrink-0" />
                    Every listing shows its fuel policy, mileage limit and cancellation terms before you book — no surprises at pickup.
                </p>
            </div>

            <MobileBottomNav role="PASSENGER" />
            <ServiceGuide serviceId="rentalPassenger" userId={user?._id} />
        </main>
    );
}
