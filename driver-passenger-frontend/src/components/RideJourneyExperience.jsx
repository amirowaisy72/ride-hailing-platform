"use client";

import { useEffect, useState } from "react";
import {
    Banknote, Car, Check, ChevronDown, Clock3, Flag, Map as MapIcon, MapPin, Navigation, Phone, Star, X,
} from "lucide-react";
import DriverProfileCard from "@/components/DriverProfileCard";
import { apiRequest } from "@/lib/api";
import {
    describeDriver, formatArrival, formatPKR, getInitials, getVehicle, placeLabel,
} from "@/lib/rideDisplay";

const SEARCHING = ["REQUESTED", "SEARCHING", "BIDDING"];
const STEPS = [
    { status: "DRIVER_SELECTED", label: "Confirmed" },
    { status: "DRIVER_EN_ROUTE", label: "On the way" },
    { status: "DRIVER_ARRIVED", label: "Arrived" },
    { status: "TRIP_STARTED", label: "On trip" },
];
const COPY = {
    DRIVER_SELECTED: ["Driver confirmed", "Your driver is getting ready to head your way."],
    DRIVER_EN_ROUTE: ["Driver is on the way", "Watch your driver approach your pickup point."],
    DRIVER_ARRIVED: ["Your driver has arrived", "Please meet your driver at the pickup point."],
    TRIP_STARTED: ["On your way", "Sit back and enjoy the ride."],
    REASSIGNING: ["Reassigning your ride", "We're connecting you with another available driver."],
};
const STYLES = `
@keyframes rj-sheet-in { from { transform: translateY(36px); opacity: 0; } to { transform: none; opacity: 1; } }
@keyframes rj-pop { 0% { transform: translateY(10px) scale(.97); opacity: 0; } 100% { transform: none; opacity: 1; } }
@keyframes rj-indeterminate { 0% { transform: translateX(-110%); } 100% { transform: translateX(260%); } }
.rj-sheet-in { animation: rj-sheet-in .42s cubic-bezier(.2,.8,.2,1) both; }
.rj-pop { animation: rj-pop .4s cubic-bezier(.2,.8,.2,1) both; }
.rj-indeterminate { animation: rj-indeterminate 1.8s cubic-bezier(.4,0,.2,1) infinite; }
@media (prefers-reduced-motion: reduce) { .rj-sheet-in, .rj-pop, .rj-indeterminate { animation: none !important; } }
`;
const offerKey = (offer) => String(offer?._id || offer?.offerId || "");

export default function RideJourneyExperience({
    ride, offers = [], busyId, onAccept, onReject, onCancel, cancelling, onShowMap, notification,
    chat = null, locationUpdatedAt = null,
    // Optional, additive props.
    token = null, routeInfo = null, driverLocationFresh = false, pickupLabel, destinationLabel,
}) {
    const [now, setNow] = useState(Date.now());
    const [showProfile, setShowProfile] = useState(false);
    const [driverProfile, setDriverProfile] = useState(null);
    const driverId = ride?.driverId?._id || ride?.driverId?.id || ride?.driverId;

    useEffect(() => {
        let cancelled = false;
        setDriverProfile(null);

        if (driverId && token) {
            apiRequest(`/drivers/profile/${driverId}`, { token })
                .then((data) => {
                    if (!cancelled) setDriverProfile(data.driver);
                })
                .catch(() => { });
        }

        return () => { cancelled = true; };
    }, [driverId, token]);

    useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
    useEffect(() => { setShowProfile(false); }, [ride?._id]);
    if (!ride) return null;

    if (SEARCHING.includes(ride.status)) {
        return (
            <SearchingFallback
                ride={ride} offers={offers} now={now} busyId={busyId} onAccept={onAccept} onReject={onReject}
                onCancel={onCancel} cancelling={cancelling} onShowMap={onShowMap} notification={notification}
            />
        );
    }

    const status = ride.status;
    const [title, subtitle] = COPY[status] || ["Trip in progress", "We'll keep your ride status updated."];
    const stepIndex = STEPS.findIndex((step) => step.status === status);
    const driver = describeDriver(ride.driverId);
    const vehicle = getVehicle(ride.vehicleType || driver.vehicleType);
    const VehicleIcon = vehicle?.Icon || Car;
    const stops = Array.isArray(ride.stops) ? ride.stops : [];
    const stopsCompleted = Math.min(Number(ride.stopsCompleted) || 0, stops.length);
    const tripStarted = status === "TRIP_STARTED";
    const arrived = status === "DRIVER_ARRIVED";
    const showEta = Boolean(routeInfo && driverLocationFresh && ["DRIVER_SELECTED", "DRIVER_EN_ROUTE", "TRIP_STARTED"].includes(status));
    const nextStop = tripStarted && stopsCompleted < stops.length ? stops[stopsCompleted] : null;
    const pickupText = pickupLabel || placeLabel(ride.pickup, "Your pickup point");
    const isRoundTrip = ride.tripType === "ROUND_TRIP";
    const destinationText = ride.tripType === "ROUND_TRIP"
        ? placeLabel(ride.pickup, "Original pickup")
        : destinationLabel || placeLabel(ride.destination, "Your destination");
    const vehicleLine = driver.vehicleText || vehicle?.name || "Vehicle";
    const lastFix = locationUpdatedAt ? new Date(locationUpdatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
    // Age of the last known fix, for the stale-marker label ("Last known
    // · 3 min ago") — the marker itself stays on the map (Round 5 hook
    // change); this line only reports how old it is.
    const lastFixAgeMs = locationUpdatedAt ? Math.max(0, now - new Date(locationUpdatedAt).getTime()) : null;
    const lastFixAge = lastFixAgeMs === null ? ""
        : lastFixAgeMs < 60000 ? "just now"
            : lastFixAgeMs < 3600000 ? `${Math.floor(lastFixAgeMs / 60000)} min ago`
                : `${Math.floor(lastFixAgeMs / 3600000)} h ${Math.floor((lastFixAgeMs % 3600000) / 60000)} min ago`;

    return (
        <section
            aria-label="Active ride"
            className="rj-sheet-in absolute inset-x-0 bottom-[calc(68px+env(safe-area-inset-bottom))] z-20"
        >
            <style>{STYLES}</style>

            {arrived && (
                <div role="alert" className="rj-pop mx-3 mb-3 flex items-center gap-3 rounded-2xl bg-[#087F5B] p-4 text-white shadow-[0_12px_32px_rgba(17,17,17,0.22)] sm:mx-auto sm:max-w-lg">
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#111111]">
                        <MapPin size={20} className="text-[#087F5B]" aria-hidden="true" />
                    </span>
                    <div className="min-w-0">
                        <p className="font-extrabold tracking-tight">Your driver is waiting</p>
                        <p className="truncate text-sm font-medium">
                            {vehicleLine}{driver.plate ? ` · ${driver.plate}` : ""} is at your pickup
                        </p>
                    </div>
                </div>
            )}

            <div className="max-h-[calc(62dvh-68px)] overflow-y-auto overscroll-contain rounded-t-[28px] bg-white px-4 pb-5 pt-3 shadow-[0_-16px_48px_rgba(17,17,17,0.16)] sm:px-6">
                <div className="mx-auto max-w-lg">
                    <button
                        type="button"
                        onClick={onShowMap}
                        aria-label="Minimise ride details and show map"
                        className="mx-auto mb-4 block h-1.5 w-10 rounded-full bg-[#E3E5E8]"
                    />

                    <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0" aria-live="polite">
                            <span className="inline-flex items-center gap-1.5 rounded-full bg-[#F4F5F7] px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-[#374151]">
                                <span className="relative flex h-2 w-2">
                                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-75" />
                                    <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                                </span>
                                Live
                            </span>
                            <h1 className="mt-2 text-pretty text-[22px] font-extrabold leading-tight tracking-tight">{title}</h1>
                            <p className="mt-0.5 text-sm text-[#6B7280]">{subtitle}</p>
                        </div>
                        {showEta ? (
                            <div className="shrink-0 rounded-2xl bg-[#111111] px-3.5 py-2.5 text-center text-white">
                                <p className="text-2xl font-extrabold leading-none tabular-nums text-[#087F5B]">
                                    {routeInfo.durationMinutes}<span className="ml-0.5 text-xs font-bold">min</span>
                                </p>
                                <p className="mt-1 text-[11px] font-semibold text-white/70">{routeInfo.distanceKm} km away</p>
                            </div>
                        ) : arrived ? (
                            <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-[#087F5B] text-white">
                                <Check size={26} strokeWidth={3} aria-hidden="true" />
                            </span>
                        ) : null}
                    </div>

                    {stepIndex >= 0 && (
                        <ol className="mt-4 grid grid-cols-4 gap-1.5" aria-label="Ride progress">
                            {STEPS.map((step, index) => {
                                const done = index < stepIndex;
                                const current = index === stepIndex;
                                return (
                                    <li key={step.status} aria-current={current ? "step" : undefined}>
                                        <div className="h-1.5 overflow-hidden rounded-full bg-[#F1F2F4]">
                                            {done && <div className="h-full w-full bg-[#087F5B]" />}
                                            {current && <div className="rj-indeterminate h-full w-1/2 rounded-full bg-[#087F5B]" />}
                                        </div>
                                        <p className={`mt-1.5 text-[11px] font-bold ${done || current ? "text-[#111111]" : "text-[#9CA3AF]"}`}>{step.label}</p>
                                    </li>
                                );
                            })}
                        </ol>
                    )}

                    {showEta && (
                        <p className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-[#374151]">
                            <Clock3 size={13} aria-hidden="true" />
                            {tripStarted
                                ? <>Estimated arrival at {nextStop
                                    ? (ride.tripType === "ROUND_TRIP" && stopsCompleted === stops.length - 1
                                        ? "outbound destination"
                                        : "next stop")
                                    : (ride.tripType === "ROUND_TRIP" ? "original pickup" : "destination")} {formatArrival(nextStop && routeInfo.nextLegDurationMinutes ? routeInfo.nextLegDurationMinutes : routeInfo.durationMinutes, now)}</>
                                : <>Driver arrives around {formatArrival(routeInfo.durationMinutes, now)}</>}
                        </p>
                    )}

                    <div className="mt-4 rounded-2xl border border-[#EEF0F2] p-3.5">
                        <div className="flex items-center gap-3">
                            <span className="relative flex h-13 w-13 shrink-0 items-center justify-center" aria-hidden="true">
                                <span className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-full bg-[#111111] text-sm font-extrabold text-[#087F5B]">
                                    {driverProfile?.profileImage ? (
                                        <img
                                            src={driverProfile.profileImage}
                                            alt="Driver"
                                            className="h-full w-full object-cover"
                                        />
                                    ) : (
                                        getInitials(driverProfile?.name || driver.name)
                                    )}
                                </span>
                                <span className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-[#087F5B] text-white">
                                    <VehicleIcon size={12} />
                                </span>
                            </span>
                            <div className="min-w-0 flex-1">
                                <p className="truncate font-bold">
                                    {driverProfile?.name || driver.name || "Your driver"}
                                </p>
                                <p className="mt-0.5 flex items-center gap-1.5 text-xs text-[#6B7280]">
                                    <span className="flex items-center gap-0.5 font-semibold text-[#111111]">
                                        <Star size={12} className="fill-[#F5A524] text-[#F5A524]" aria-hidden="true" />
                                        {driver.rating != null ? Number(driver.rating).toFixed(1) : "New"}
                                    </span>
                                    {driver.trips != null && <span>· {driver.trips} trips</span>}
                                </p>
                                <p className="truncate text-xs font-medium text-[#374151]">
                                    {vehicleLine}
                                    {driverProfile?.vehicle?.color &&
                                        !vehicleLine.toLowerCase().includes(driverProfile.vehicle.color.toLowerCase())
                                        ? ` · ${driverProfile.vehicle.color}`
                                        : ""}
                                </p>
                            </div>
                            {driver.plate && (
                                <span className="shrink-0 rounded-lg border border-[#E3E5E8] bg-[#F7F8F9] px-2 py-1 font-mono text-xs font-bold tracking-wider">
                                    {driver.plate}
                                </span>
                            )}
                        </div>

                        <div className="mt-3 flex items-center gap-2">
                            {chat && <div className="min-w-0 flex-1 [&>button]:w-full">{chat}</div>}
                            {driver.phone && (
                                <a
                                    href={`tel:${driver.phone}`}
                                    aria-label="Call driver"
                                    className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#F4F5F7] transition-colors hover:bg-[#E9EBEE]"
                                >
                                    <Phone size={19} />
                                </a>
                            )}
                            <button
                                type="button"
                                onClick={onShowMap}
                                aria-label="Show full map"
                                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#F4F5F7] transition-colors hover:bg-[#E9EBEE]"
                            >
                                <MapIcon size={19} />
                            </button>
                        </div>

                        {driver.id && token && (
                            <div className="mt-3 border-t border-[#EEF0F2] pt-2.5">
                                <button
                                    type="button"
                                    onClick={() => setShowProfile((value) => !value)}
                                    aria-expanded={showProfile}
                                    className="flex items-center gap-1 text-xs font-bold text-[#374151] hover:text-[#111111]"
                                >
                                    {showProfile ? "Hide driver profile" : "View driver profile"}
                                    <ChevronDown size={14} className={`transition-transform ${showProfile ? "rotate-180" : ""}`} aria-hidden="true" />
                                </button>
                                {showProfile && (
                                    <div className="mt-2 rounded-xl bg-[#F7F8F9] p-2">
                                        <DriverProfileCard driverId={driver.id} token={token} />
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {tripStarted && stops.length > 0 && (
                        <div className="mt-4">
                            <div className="flex items-center justify-between text-xs font-semibold text-[#6B7280]">
                                <span>Journey progress</span>
                                <span className="tabular-nums">{stopsCompleted}/{stops.length} stops completed</span>
                            </div>
                            <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-[#F1F2F4]">
                                <div
                                    className="h-full rounded-full bg-[#087F5B] transition-[width] duration-700"
                                    style={{ width: `${(stopsCompleted / (stops.length + 1)) * 100}%` }}
                                />
                            </div>
                        </div>
                    )}

                    <ol className="mt-4 rounded-2xl bg-[#F4F5F7] p-4" aria-label="Trip route">
                        <TimelineItem kind="pickup" label="Pickup" text={pickupText} done={tripStarted} />
                        {stops.map((stop, index) => (
                            <TimelineItem
                                key={`${stop.name || "stop"}-${index}`}
                                kind="stop"
                                index={index}
                                label={ride.tripType === "ROUND_TRIP" && index === stops.length - 1
                                    ? "Outbound Destination"
                                    : `Stop ${index + 1}`}
                                text={stop.name || (ride.tripType === "ROUND_TRIP" && index === stops.length - 1
                                    ? destinationLabel || "Outbound Destination"
                                    : `Stop ${index + 1}`)}
                                done={tripStarted && index < stopsCompleted}
                                active={tripStarted && index === stopsCompleted}
                                meta={tripStarted && index === stopsCompleted && showEta && routeInfo.nextLegDistanceKm != null
                                    ? `${routeInfo.nextLegDistanceKm} km · ${routeInfo.nextLegDurationMinutes} min` : ""}
                            />
                        ))}
                        <TimelineItem
                            kind="destination"
                            label={ride.tripType === "ROUND_TRIP" ? "Return to Pickup" : "Drop-off"}
                            text={destinationText}
                            active={tripStarted && stopsCompleted >= stops.length}
                            meta={tripStarted && !nextStop && showEta ? `${routeInfo.distanceKm} km · ${routeInfo.durationMinutes} min left` : ""}
                            last
                        />
                    </ol>

                    <div className="mt-3 flex items-center justify-between rounded-2xl border border-[#EEF0F2] px-4 py-3">
                        <span className="flex items-center gap-2 text-sm font-semibold text-[#374151]">
                            <VehicleIcon size={17} aria-hidden="true" />
                            {vehicle?.name || String(ride.vehicleType || "Ride").replaceAll("_", " ")}
                            <span className="text-[#D1D5DB]">·</span>
                            <Banknote size={16} aria-hidden="true" /> Cash
                        </span>
                        <span className="text-lg font-extrabold tabular-nums">{formatPKR(ride.finalPrice || ride.requestedPrice)}</span>
                    </div>

                    <p className="mt-3 flex items-center gap-1.5 text-xs text-[#6B7280]">
                        <span className={`h-2 w-2 rounded-full ${driverLocationFresh ? "bg-emerald-500" : "bg-amber-500"}`} aria-hidden="true" />
                        {driverLocationFresh
                            ? `Live driver GPS${lastFix ? ` · updated ${lastFix}` : ""}`
                            : lastFix
                                ? `Last known · ${lastFixAge}`
                                : "Waiting for your driver's live location"}
                    </p>
                    {showEta && <p className="mt-1 text-[11px] text-[#9CA3AF]">Times are road-route estimates and may change with traffic.</p>}
                </div>
            </div>
        </section>
    );
}

function TimelineItem({ kind, index, label, text, done = false, active = false, meta = "", last = false }) {
    const marker = kind === "pickup"
        ? <span className={`h-3.5 w-3.5 rounded-full border-[4px] ${done ? "border-[#9CA3AF]" : "border-[#111111]"}`} />
        : kind === "destination"
            ? <span className="flex h-4 w-4 items-center justify-center rounded-[4px] bg-[#E5484D]"><Flag size={9} className="text-white" /></span>
            : done
                ? <span className="flex h-4 w-4 items-center justify-center rounded-full bg-[#111111]"><Check size={10} strokeWidth={3} className="text-[#087F5B]" /></span>
                : <span className={`flex h-4 w-4 items-center justify-center rounded-full border-2 text-[9px] font-extrabold ${active ? "border-[#111111] bg-[#087F5B] text-white" : "border-[#9CA3AF] bg-white"}`}>{index + 1}</span>;

    return (
        <li className="flex gap-3">
            <div className="flex flex-col items-center pt-0.5" aria-hidden="true">
                {marker}
                {!last && <span className="my-1 w-0.5 flex-1 rounded-full bg-[#D9DCE0]" />}
            </div>
            <div className={`min-w-0 flex-1 ${last ? "" : "pb-3"}`}>
                <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-[#9CA3AF]">
                    {label}
                    {active && <span className="rounded-full bg-[#111111] px-1.5 py-0.5 text-[9px] font-bold text-[#087F5B]">Next</span>}
                    {done && <span className="sr-only">(completed)</span>}
                </p>
                <p className={`truncate text-sm font-semibold ${done ? "text-[#9CA3AF] line-through" : "text-[#111111]"}`} title={text}>{text}</p>
                {meta && <p className="mt-0.5 text-xs font-medium text-[#374151]">{meta}</p>}
            </div>
        </li>
    );
}

// Kept for any caller that still renders this component during bidding.
function SearchingFallback({ ride, offers, now, busyId, onAccept, onReject, onCancel, cancelling, onShowMap, notification }) {
    const visibleOffers = offers.filter((offer) => offer && offer.status !== "REJECTED" && (!offer.expiresAt || new Date(offer.expiresAt).getTime() > now));
    return (
        <section aria-label="Finding a driver" className="rj-sheet-in absolute inset-x-0 bottom-[calc(68px+env(safe-area-inset-bottom))] z-20 max-h-[calc(70dvh-68px)] overflow-y-auto rounded-t-[28px] bg-white px-4 pb-5 pt-3 shadow-[0_-16px_48px_rgba(17,17,17,0.16)]">
            <style>{STYLES}</style>
            <div className="mx-auto max-w-lg">
                <div className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-[#E3E5E8]" />
                <div className="flex items-center justify-between gap-3">
                    <div>
                        <h1 className="text-xl font-extrabold tracking-tight">Finding your driver</h1>
                        <p className="text-sm text-[#6B7280]">Your fare: {formatPKR(ride.requestedPrice)}</p>
                    </div>
                    <button type="button" onClick={onShowMap} aria-label="View map" className="flex h-11 w-11 items-center justify-center rounded-full bg-[#F4F5F7]">
                        <Navigation size={18} />
                    </button>
                </div>
                <div className="mt-4 h-1 overflow-hidden rounded-full bg-[#F1F2F4]"><div className="rj-indeterminate h-full w-2/5 rounded-full bg-[#111111]" /></div>
                {notification && <p role="status" className="mt-3 rounded-xl bg-[#F4F5F7] px-3 py-2 text-xs text-[#374151]">{notification}</p>}
                <ul className="mt-4 space-y-2.5">
                    {visibleOffers.map((offer) => {
                        const key = offerKey(offer);
                        const name = describeDriver(offer.driverId).name || "Nearby driver";
                        return (
                            <li key={key} className="rounded-2xl border border-[#EEF0F2] p-3.5">
                                <div className="flex items-center justify-between gap-2">
                                    <p className="truncate font-bold">{name}</p>
                                    <p className="text-lg font-extrabold tabular-nums">{formatPKR(offer.price)}</p>
                                </div>
                                <div className="mt-3 flex gap-2">
                                    <button type="button" disabled={!!busyId} onClick={() => onReject(key)} className="h-11 flex-1 rounded-xl bg-[#F4F5F7] text-sm font-bold text-[#374151] disabled:opacity-50">Decline</button>
                                    <button type="button" disabled={!!busyId} onClick={() => onAccept(key)} className="h-11 flex-[2] rounded-xl bg-[#087F5B] text-sm font-extrabold text-white disabled:opacity-50">Accept</button>
                                </div>
                            </li>
                        );
                    })}
                </ul>
                <button type="button" disabled={cancelling} onClick={onCancel} className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[#F4F5F7] text-sm font-bold text-[#E5484D] disabled:opacity-50">
                    <X size={17} aria-hidden="true" />
                    {cancelling ? "Cancelling..." : "Cancel ride request"}
                </button>
            </div>
        </section>
    );
}
