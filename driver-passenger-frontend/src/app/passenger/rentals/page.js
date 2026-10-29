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
import { useAuth } from "@/context/AuthContext";
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
    const pricing = vehicle?.pricing || {};
    if (pricing.daily) return `${formatPKR(pricing.daily)} / day`;
    if (pricing.hourly) return `${formatPKR(pricing.hourly)} / hour`;
    if (pricing.weekly) return `${formatPKR(pricing.weekly)} / week`;
    if (pricing.monthly) return `${formatPKR(pricing.monthly)} / month`;
    return "Price on request";
}

function RentalsDashboard() {
    const { token } = useAuth();
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
                    setError("Could not get your location — showing all vehicles instead.");
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
        "w-full rounded-2xl border border-slate-200 bg-[#F9FAFB] px-3.5 py-3 text-sm font-semibold text-[#111111] outline-none focus:border-[#087F5B] focus:ring-2 focus:ring-[#087F5B]/25";

    return (
        <main className="min-h-dvh bg-[#F4F5F7] pb-28 text-[#111111]">
            <div className="sticky top-0 z-20 border-b border-slate-100 bg-white/95 backdrop-blur-xl">
                <div className="mx-auto flex max-w-xl items-center gap-2 px-3 pb-3 pt-[max(12px,env(safe-area-inset-top))]">
                    <Link href="/passenger" aria-label="Back to home" className="grid h-11 w-11 place-items-center rounded-2xl hover:bg-[#F4F5F7]">
                        <ArrowLeft size={21} />
                    </Link>
                    <h1 className="flex-1 text-lg font-extrabold tracking-tight">Safar Rentals</h1>
                    <button type="button" aria-label="Refresh bookings" onClick={() => void loadBookings()} className="grid h-11 w-11 place-items-center rounded-2xl text-slate-500 hover:bg-[#F4F5F7]">
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
                        <h2 className="mt-3 text-[22px] font-extrabold leading-tight">Rent a car, your way</h2>
                        <p className="mt-1 max-w-sm text-sm leading-relaxed text-slate-300">
                            Self-drive or with a driver, from verified local owners. Prices,
                            deposit and policies are shown upfront — exact pickup details are
                            shared only after your booking is confirmed.
                        </p>
                    </div>
                </section>

                {/* Search */}
                <section className="space-y-3 rounded-[24px] bg-white p-4 shadow-sm" aria-labelledby="rental-search-title">
                    <h2 id="rental-search-title" className="flex items-center gap-2 text-[15px] font-extrabold">
                        <Search size={17} className="text-[#087F5B]" /> Find a vehicle
                    </h2>
                    <div className="grid grid-cols-3 gap-1 rounded-2xl bg-[#F4F5F7] p-1" role="radiogroup" aria-label="Rental mode">
                        {[
                            ["", "Any"],
                            ["SELF_DRIVE", "Self-drive"],
                            ["WITH_DRIVER", "With driver"],
                        ].map(([value, label]) => (
                            <button
                                key={value || "any"}
                                type="button"
                                role="radio"
                                aria-checked={mode === value}
                                onClick={() => setMode(value)}
                                className={`min-h-10 rounded-xl text-[13px] font-bold ${mode === value ? "bg-white text-[#111111] shadow-sm" : "text-slate-500"}`}
                            >
                                {label}
                            </button>
                        ))}
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label htmlFor="r-start" className="mb-1.5 block text-xs font-bold text-slate-600">Pickup from</label>
                            <input id="r-start" type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} className={inputCls} />
                        </div>
                        <div>
                            <label htmlFor="r-end" className="mb-1.5 block text-xs font-bold text-slate-600">Return by</label>
                            <input id="r-end" type="datetime-local" value={endAt} onChange={(e) => setEndAt(e.target.value)} className={inputCls} />
                        </div>
                        <div>
                            <label htmlFor="r-seats" className="mb-1.5 block text-xs font-bold text-slate-600">Min seats</label>
                            <select id="r-seats" value={minSeats} onChange={(e) => setMinSeats(e.target.value)} className={inputCls}>
                                <option value="">Any</option>
                                {[2, 4, 5, 7, 12].map((n) => <option key={n} value={n}>{n}+ seats</option>)}
                            </select>
                        </div>
                        <div>
                            <label htmlFor="r-trans" className="mb-1.5 block text-xs font-bold text-slate-600">Transmission</label>
                            <select id="r-trans" value={transmission} onChange={(e) => setTransmission(e.target.value)} className={inputCls}>
                                <option value="">Any</option>
                                <option value="AUTOMATIC">Automatic</option>
                                <option value="MANUAL">Manual</option>
                            </select>
                        </div>
                    </div>
                    <div>
                        <label htmlFor="r-max" className="mb-1.5 block text-xs font-bold text-slate-600">Max daily price (PKR)</label>
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
                    <label className="flex items-center justify-between gap-3 rounded-2xl bg-[#F9FAFB] px-4 py-3">
                        <span className="flex items-center gap-2 text-sm font-bold">
                            <MapPin size={16} className="text-[#087F5B]" /> Near me (within 50 km)
                        </span>
                        <button
                            type="button"
                            role="switch"
                            aria-checked={nearMe}
                            aria-label="Near me"
                            onClick={() => setNearMe((v) => !v)}
                            className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${nearMe ? "bg-[#087F5B]" : "bg-slate-300"}`}
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
                        <Search size={17} /> {searching ? "Searching…" : "Search vehicles"}
                    </button>
                </section>

                {error && <p role="alert" className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-600">{error}</p>}

                {/* Results */}
                <section aria-labelledby="vehicles-title">
                    <h2 id="vehicles-title" className="mb-3 px-1 text-xs font-bold uppercase tracking-wider text-slate-500">
                        Available vehicles {searched && <span className="ml-1 rounded-full bg-white px-2 py-0.5 text-[10px] text-slate-600 shadow-sm">{vehicles.length}</span>}
                    </h2>
                    {searching && vehicles.length === 0 ? (
                        <div className="space-y-3" aria-busy="true">
                            {[0, 1].map((i) => <div key={i} className="h-28 animate-pulse rounded-[24px] bg-white shadow-sm" />)}
                        </div>
                    ) : vehicles.length === 0 ? (
                        <div className="rounded-[24px] border border-dashed border-slate-300 bg-white px-5 py-8 text-center shadow-sm">
                            <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-emerald-50 text-[#087F5B]">
                                <CarFront size={22} />
                            </span>
                            <h3 className="mt-3 font-extrabold">No vehicles match</h3>
                            <p className="mx-auto mt-1 max-w-xs text-sm text-slate-500">
                                Try widening your dates, seats or price — new cars are added by local owners regularly.
                            </p>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {vehicles.map((vehicle) => {
                                const photo = vehiclePhoto(vehicle);
                                const vid = vehicleIdOf(vehicle);
                                return (
                                    <Link
                                        key={vid}
                                        href={`/passenger/rentals/vehicle?vehicleId=${vid}`}
                                        className="flex gap-3 rounded-[24px] bg-white p-3.5 shadow-sm transition-transform active:scale-[0.99]"
                                    >
                                        <span className="grid h-24 w-24 shrink-0 place-items-center overflow-hidden rounded-2xl bg-slate-100 text-slate-300">
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
                                                    <span className="flex shrink-0 items-center gap-1 text-xs font-bold text-amber-500">
                                                        <Star size={13} className="fill-amber-400 text-amber-400" />
                                                        {Number(vehicle.rating).toFixed(1)}
                                                    </span>
                                                )}
                                            </span>
                                            <span className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs font-semibold text-slate-500">
                                                <span className="flex items-center gap-1"><Users size={12} /> {vehicle.seats} seats</span>
                                                <span>{vehicle.transmission === "AUTOMATIC" ? "Automatic" : "Manual"}</span>
                                                <span>{vehicle.hasAC ? "AC" : "Non-AC"}</span>
                                                <span>{(vehicle.rentalModes || []).includes("SELF_DRIVE") && (vehicle.rentalModes || []).includes("WITH_DRIVER") ? "Self-drive · With driver" : (vehicle.rentalModes || []).includes("SELF_DRIVE") ? "Self-drive" : "With driver"}</span>
                                            </span>
                                            <span className="mt-1 flex items-center gap-1 truncate text-xs font-medium text-slate-400">
                                                <MapPin size={12} className="shrink-0" /> {vehicle.pickupAreaLabel || "Pickup area shared after booking"}
                                            </span>
                                            <span className="mt-1.5 block text-[15px] font-extrabold text-[#087F5B]">{priceLine(vehicle)}</span>
                                        </span>
                                        <ChevronRight size={18} className="self-center text-slate-300" />
                                    </Link>
                                );
                            })}
                        </div>
                    )}
                </section>

                {/* My bookings */}
                {bookings.length > 0 && (
                    <section aria-labelledby="my-bookings-title">
                        <h2 id="my-bookings-title" className="mb-3 px-1 text-xs font-bold uppercase tracking-wider text-slate-500">
                            My bookings
                        </h2>
                        <div className="space-y-3">
                            {bookings.map((booking) => (
                                <Link
                                    key={booking._id}
                                    href={`/passenger/rentals/bookings/details?id=${booking._id}`}
                                    className="block rounded-[24px] bg-white p-4 shadow-sm transition-transform active:scale-[0.99]"
                                >
                                    <div className="flex items-start justify-between gap-3">
                                        <p className="min-w-0 flex-1 truncate text-[15px] font-extrabold">
                                            {booking.vehicle ? vehicleTitle(booking.vehicle) : "Rental booking"}
                                        </p>
                                        <StatusPill meta={rentalStatusMeta(booking.status)} />
                                    </div>
                                    <p className="mt-1 flex items-center gap-1.5 text-xs font-semibold text-slate-500">
                                        <CalendarDays size={13} />
                                        {booking.startAt ? new Date(booking.startAt).toLocaleDateString([], { month: "short", day: "numeric" }) : ""}
                                        {" → "}
                                        {booking.endAt ? new Date(booking.endAt).toLocaleDateString([], { month: "short", day: "numeric" }) : ""}
                                        <span className="text-slate-300">·</span> Ref {booking.bookingRef}
                                    </p>
                                    <p className="mt-2 text-sm font-extrabold text-[#087F5B]">
                                        {formatPKR(booking.rentalCharges)}
                                        <span className="ml-2 text-xs font-semibold text-slate-400">
                                            {booking.mode === "SELF_DRIVE" ? "Self-drive" : "With driver"} · {String(booking.billingUnit || "").toLowerCase()}
                                        </span>
                                    </p>
                                </Link>
                            ))}
                        </div>
                    </section>
                )}

                <p className="flex items-start gap-2 px-1 text-xs leading-relaxed text-slate-400">
                    <Fuel size={14} className="mt-0.5 shrink-0" />
                    Every listing shows its fuel policy, mileage limit and cancellation terms before you book — no surprises at pickup.
                </p>
            </div>

            <MobileBottomNav role="PASSENGER" />
        </main>
    );
}
