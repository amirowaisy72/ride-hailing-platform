"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Geolocation } from "@capacitor/geolocation";
import {
    ArrowLeft,
    CalendarDays,
    CarFront,
    ChevronDown,
    ChevronRight,
    MapPin,
    RefreshCw,
    Search,
    SlidersHorizontal,
    Star,
    Users,
} from "lucide-react";
import AuthGuard from "@/components/AuthGuard";
import MobileBottomNav from "@/components/MobileBottomNav";
import RentalWhenPicker, {
    cheapestUnit,
    defaultWindow,
    estimateTotal,
    formatDuration,
    tr,
    windowHours,
} from "@/components/rentals/RentalWhenPicker";
import { useAuth } from "@/context/AuthContext";
import { useLanguage, storedLanguage } from "@/components/i18n/LanguageProvider";
import { formatPKR } from "@/lib/rideDisplay";
import { getMyRentalBookings, searchRentalVehicles } from "@/lib/rentalService";
import { vehicleIdOf, vehiclePhoto, vehicleTitle } from "@/lib/rentalDisplay";
import {
    StatusPill,
    rentalStatusMeta,
} from "@/components/order/PurchaseTimeline";

const DRAFT_KEY = "rentals-search-draft";
const FINISHED = ["COMPLETED", "CANCELLED", "NO_SHOW"];

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

// What the renter should do next, in one short line. `urgent` ones are
// things the renter must act on; the rest are just status.
function nextAction(booking) {
    switch (booking.status) {
        case "REQUESTED":
            return { label: tr("Waiting for the owner to accept", "مالک کی منظوری کا انتظار"), urgent: false };
        case "PROVIDER_ACCEPTED":
            return { label: tr("Pay the booking fee", "بکنگ فیس ادا کریں"), urgent: true };
        case "PAYMENT_PENDING":
            return { label: tr("Safar is checking your payment", "سفر آپ کی ادائیگی چیک کر رہا ہے"), urgent: false };
        case "CONFIRMED":
            return { label: tr("Show your pickup code at handover", "حوالگی پر اپنا پک اپ کوڈ دکھائیں"), urgent: true };
        case "PICKUP_VERIFIED":
        case "RENTAL_ACTIVE":
            return {
                label: booking.endAt
                    ? tr(
                        `Return by ${new Date(booking.endAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`,
                        `واپسی: ${new Date(booking.endAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`
                    )
                    : tr("Rental in progress", "کرایہ جاری ہے"),
                urgent: false,
            };
        case "RETURN_PENDING":
            return { label: tr("Confirm the return", "واپسی کی تصدیق کریں"), urgent: true };
        case "COMPLETED":
            return booking.ratedAt ? null : { label: tr("Rate this rental", "اس کرائے کو ریٹ کریں"), urgent: true };
        case "DISPUTED":
            return { label: tr("Under review by our team", "ہماری ٹیم جائزہ لے رہی ہے"), urgent: false };
        default:
            return null;
    }
}

function BookingCard({ booking, t }) {
    const action = nextAction(booking);
    return (
        <Link
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
            {action && (
                <p
                    className={`mt-3 flex min-h-11 items-center justify-between gap-2 rounded-2xl px-3.5 text-[13px] font-extrabold ${
                        action.urgent ? "bg-[#087F5B] text-white" : "bg-pd-surface-2 text-pd-text-2"
                    }`}
                >
                    <span>{action.label}</span>
                    <ChevronRight size={16} aria-hidden="true" />
                </p>
            )}
        </Link>
    );
}

// Whatever the renter last typed in this tab, so coming back from a vehicle
// page does not wipe the search.
function readDraft() {
    if (typeof window === "undefined") return null;
    try {
        const draft = JSON.parse(window.sessionStorage.getItem(DRAFT_KEY) || "null");
        if (!draft) return null;
        const start = new Date(draft.startAt || "");
        const end = new Date(draft.endAt || "");
        const windowOk = Number.isFinite(start.getTime()) && Number.isFinite(end.getTime()) && end > start && start.getTime() > Date.now() - 60_000;
        return { ...draft, windowOk };
    } catch {
        return null;
    }
}

function RentalsDashboard() {
    const { token } = useAuth();
    const { t } = useLanguage();
    const [draft] = useState(readDraft);
    const [mode, setMode] = useState(draft?.mode || "");
    const [window_, setWindow] = useState(() => (draft?.windowOk ? { startAt: draft.startAt, endAt: draft.endAt } : defaultWindow()));
    const [minSeats, setMinSeats] = useState(draft?.minSeats || "");
    const [transmission, setTransmission] = useState(draft?.transmission || "");
    const [maxDailyPrice, setMaxDailyPrice] = useState(draft?.maxDailyPrice || "");
    const [nearMe, setNearMe] = useState(Boolean(draft?.nearMe));
    const [moreOpen, setMoreOpen] = useState(Boolean(draft?.minSeats || draft?.transmission || draft?.nearMe));

    const [vehicles, setVehicles] = useState([]);
    const [searching, setSearching] = useState(false);
    const [searched, setSearched] = useState(false);
    const [appliedWindow, setAppliedWindow] = useState(null);
    const [bookings, setBookings] = useState([]);
    const [error, setError] = useState("");
    const [applied, setApplied] = useState(Boolean(draft?.applied));

    const { startAt, endAt } = window_;

    useEffect(() => {
        try {
            window.sessionStorage.setItem(
                DRAFT_KEY,
                JSON.stringify({ mode, startAt, endAt, minSeats, transmission, maxDailyPrice, nearMe, applied })
            );
        } catch { /* Storage blocked — nothing to keep. */ }
    }, [mode, startAt, endAt, minSeats, transmission, maxDailyPrice, nearMe, applied]);

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

    async function runSearch({ restoring = false } = {}) {
        if (searching) return;
        // Never send an inverted or unparseable window.
        if (startAt && endAt) {
            const start = new Date(startAt);
            const end = new Date(endAt);
            if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) {
                setError(t("rentals.errReturnAfter"));
                return;
            }
        }
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
            setApplied(true);
            setAppliedWindow({ startAt, endAt });
        } catch (e) {
            setError(e.message);
            if (restoring) setApplied(false);
        } finally {
            setSearching(false);
        }
    }

    // First load: an unfiltered list, or the last search the renter ran.
    useEffect(() => {
        if (!token) return;
        if (applied) {
            const timer = setTimeout(() => void runSearch({ restoring: true }), 0);
            return () => clearTimeout(timer);
        }
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
        // Runs once per sign-in; later searches are user-triggered.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [token]);

    const { active, past } = useMemo(() => {
        const activeList = bookings.filter((b) => !FINISHED.includes(b.status) || (b.status === "COMPLETED" && !b.ratedAt));
        const pastList = bookings.filter((b) => !activeList.includes(b));
        const weight = (b) => (nextAction(b)?.urgent ? 0 : 1);
        activeList.sort((a, b) => weight(a) - weight(b));
        return { active: activeList, past: pastList };
    }, [bookings]);

    const resultHours = appliedWindow ? windowHours(appliedWindow.startAt, appliedWindow.endAt) : 0;

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
                {/* Bookings that need the renter's attention come first */}
                {active.length > 0 && (
                    <section aria-labelledby="my-bookings-title">
                        <h2 id="my-bookings-title" className="mb-3 px-1 text-xs font-bold uppercase tracking-wider text-pd-muted">
                            {t("rentals.myBookings")}
                        </h2>
                        <div className="space-y-3">
                            {active.map((booking) => <BookingCard key={booking._id} booking={booking} t={t} />)}
                        </div>
                    </section>
                )}

                {/* Search */}
                <section className="space-y-4 rounded-[24px] bg-pd-surface p-4 shadow-sm" aria-labelledby="rental-search-title">
                    <div>
                        <h2 id="rental-search-title" className="flex items-center gap-2 text-[17px] font-extrabold">
                            <CarFront size={19} className="text-[#087F5B]" /> {t("rentals.findVehicle")}
                        </h2>
                        <p className="mt-1 text-sm leading-relaxed text-pd-muted">{t("rentals.heroText")}</p>
                    </div>

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
                                className={`min-h-11 rounded-xl text-[13px] font-bold ${mode === value ? "bg-pd-surface text-pd-text shadow-sm" : "text-pd-muted"}`}
                            >
                                {label}
                            </button>
                        ))}
                    </div>

                    <RentalWhenPicker startAt={startAt} endAt={endAt} onChange={setWindow} idPrefix="r" />

                    <div>
                        <label htmlFor="r-max" className="mb-1.5 block text-xs font-bold text-pd-text-2">{t("rentals.maxDailyPrice")}</label>
                        <input
                            id="r-max"
                            type="text"
                            inputMode="numeric"
                            value={maxDailyPrice}
                            onChange={(e) => setMaxDailyPrice(e.target.value.replace(/[^\d]/g, ""))}
                            placeholder={tr("e.g. 8000 (optional)", "مثلاً 8000 (اختیاری)")}
                            className={inputCls}
                        />
                    </div>

                    <div>
                        <button
                            type="button"
                            onClick={() => setMoreOpen((open) => !open)}
                            aria-expanded={moreOpen}
                            aria-controls="r-more-filters"
                            className="flex min-h-11 w-full items-center justify-between gap-2 rounded-2xl bg-pd-surface-2 px-4 text-sm font-extrabold"
                        >
                            <span className="flex items-center gap-2"><SlidersHorizontal size={16} className="text-[#087F5B]" /> {tr("More filters", "مزید فلٹر")}</span>
                            <ChevronDown size={17} className={`transition-transform ${moreOpen ? "rotate-180" : ""}`} aria-hidden="true" />
                        </button>
                        {moreOpen && (
                            <div id="r-more-filters" className="mt-3 space-y-3">
                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label htmlFor="r-seats" className="mb-1.5 block text-xs font-bold text-pd-text-2">{t("rentals.minSeats")}</label>
                                        <select id="r-seats" value={minSeats} onChange={(e) => setMinSeats(e.target.value)} className={inputCls}>
                                            <option value="">{tr("Any", "کوئی بھی")}</option>
                                            {[2, 4, 5, 7, 12].map((n) => <option key={n} value={n}>{t("rentals.seatsPlus", { n })}</option>)}
                                        </select>
                                    </div>
                                    <div>
                                        <label htmlFor="r-trans" className="mb-1.5 block text-xs font-bold text-pd-text-2">{t("rentals.transmission")}</label>
                                        <select id="r-trans" value={transmission} onChange={(e) => setTransmission(e.target.value)} className={inputCls}>
                                            <option value="">{tr("Any", "کوئی بھی")}</option>
                                            <option value="AUTOMATIC">{t("rentals.automatic")}</option>
                                            <option value="MANUAL">{t("rentals.manual")}</option>
                                        </select>
                                    </div>
                                </div>
                                <div className="flex min-h-12 items-center justify-between gap-3 rounded-2xl bg-pd-surface-2 px-4 py-2">
                                    <span id="r-near-label" className="flex items-center gap-2 text-sm font-bold">
                                        <MapPin size={16} className="text-[#087F5B]" /> {tr("Near me (within 50 km)", "میرے قریب (50 کلومیٹر کے اندر)")}
                                    </span>
                                    <button
                                        type="button"
                                        role="switch"
                                        aria-checked={nearMe}
                                        aria-labelledby="r-near-label"
                                        onClick={() => setNearMe((v) => !v)}
                                        className={`relative h-8 w-14 shrink-0 rounded-full transition-colors ${nearMe ? "bg-[#087F5B]" : "bg-pd-surface-3"}`}
                                    >
                                        <span className={`absolute top-1 h-6 w-6 rounded-full bg-white shadow transition-all ${nearMe ? "left-[30px]" : "left-1"}`} />
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>

                    {error && <p role="alert" className="rounded-2xl bg-pd-danger-soft px-4 py-3 text-sm font-semibold text-pd-danger">{error}</p>}

                    <button
                        type="button"
                        onClick={() => void runSearch()}
                        disabled={searching}
                        className="flex h-14 w-full items-center justify-center gap-2 rounded-[20px] bg-[#087F5B] text-[15px] font-extrabold text-white shadow-sm disabled:opacity-60"
                    >
                        <Search size={18} /> {searching ? t("rentals.searching") : t("rentals.searchVehicles")}
                    </button>
                </section>

                {/* Results */}
                <section aria-labelledby="vehicles-title">
                    <h2 id="vehicles-title" className="mb-3 px-1 text-xs font-bold uppercase tracking-wider text-pd-muted">
                        {tr("Available vehicles", "دستیاب گاڑیاں")} {searched && <span className="ml-1 rounded-full bg-pd-surface px-2 py-0.5 text-[10px] text-pd-muted shadow-sm">{vehicles.length}</span>}
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
                        <div className={`space-y-3 transition-opacity ${searching ? "opacity-60" : ""}`}>
                            {vehicles.map((vehicle) => {
                                const photo = vehiclePhoto(vehicle);
                                const vid = vehicleIdOf(vehicle);
                                const bestUnit = resultHours ? cheapestUnit(vehicle.pricing, resultHours) : "";
                                const estimate = bestUnit ? estimateTotal(vehicle.pricing, bestUnit, resultHours) : null;
                                const query = appliedWindow
                                    ? `&startAt=${encodeURIComponent(appliedWindow.startAt)}&endAt=${encodeURIComponent(appliedWindow.endAt)}`
                                    : "";
                                return (
                                    <Link
                                        key={vid}
                                        href={`/passenger/rentals/vehicle?vehicleId=${vid}${query}`}
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
                                            {estimate && (
                                                <span className="block text-xs font-bold text-pd-text-2">
                                                    {tr(
                                                        `${formatPKR(estimate.total)} for ${formatDuration(resultHours)}`,
                                                        `${formatDuration(resultHours)} کے لیے ${formatPKR(estimate.total)}`
                                                    )}
                                                </span>
                                            )}
                                        </span>
                                        <ChevronRight size={18} className="self-center text-pd-faint" />
                                    </Link>
                                );
                            })}
                        </div>
                    )}
                </section>

                {past.length > 0 && (
                    <details className="group rounded-[24px] bg-pd-surface p-4 shadow-sm">
                        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 text-sm font-extrabold">
                            <span>{tr("Past bookings", "پچھلی بکنگز")} ({past.length})</span>
                            <ChevronDown size={17} className="transition-transform group-open:rotate-180" aria-hidden="true" />
                        </summary>
                        <div className="mt-3 space-y-3">
                            {past.map((booking) => <BookingCard key={booking._id} booking={booking} t={t} />)}
                        </div>
                    </details>
                )}
            </div>

            <MobileBottomNav role="PASSENGER" />
        </main>
    );
}
