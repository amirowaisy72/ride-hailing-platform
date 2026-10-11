"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {

    ArrowRight, CarFront, Compass, LocateFixed,

    MapPin, Navigation, RefreshCw, Volume2, VolumeX,

} from "lucide-react";

import { Geolocation } from "@capacitor/geolocation";

import AuthGuard from "@/components/AuthGuard";

import RideMap from "@/components/RideMap";
import RideChat from "@/components/RideChat";

import { useAuth } from "@/context/AuthContext";

import { BRAND } from "@/config/brand";

import { apiRequest } from "@/lib/api";

import { submitDriverOffer } from "@/lib/driverRideService";

import {

    getMyVehicles, selectVehicle,

    updateOnlineStatus, updateDriverLocation,

} from "@/lib/vehicleService";

import { getRealtimeSocket } from "@/lib/socket";

import Link from "next/link";

import { UserRound } from "lucide-react";

import MobileBottomNav from "@/components/MobileBottomNav";

const ACTIONS = {

    DRIVER_SELECTED: ["DRIVER_EN_ROUTE", "Head to pickup"],

    DRIVER_EN_ROUTE: ["DRIVER_ARRIVED", "I've arrived"],

    DRIVER_ARRIVED: ["TRIP_STARTED", "Start trip"],

    TRIP_STARTED: ["TRIP_COMPLETED", "Complete trip"],

};

const vehicleNames = {

    BIKE: "Motorcycle",

    RICKSHAW: "Rickshaw",

    CAR_AC: "Car · AC",

    CAR_NON_AC: "Car · Non-AC",

};

const money = (v) =>

    Number.isFinite(Number(v))

        ? `PKR ${Number(v).toLocaleString("en-PK")}`

        : "—";

const placeText = (point) =>

    Array.isArray(point?.coordinates)

        ? `${point.coordinates[1].toFixed(5)}, ${point.coordinates[0].toFixed(5)}`

        : "Location unavailable";

export default function DriverPage() {

    return (

        <AuthGuard role="DRIVER">

            <DriverDashboard />

        </AuthGuard>

    );

}

function DriverDashboard() {

    const { user, token } = useAuth();

    const [tab, setTab] = useState("requests");

    const [vehicles, setVehicles] = useState([]);

    const [selectedVehicle, setSelectedVehicle] = useState("");

    const [isOnline, setIsOnline] = useState(false);

    const [isAvailable, setIsAvailable] = useState(false);

    const [location, setLocation] = useState(null);

    const [locateRequest, setLocateRequest] = useState(0);

    const [gpsMessage, setGpsMessage] = useState("Waiting for GPS");

    const [requests, setRequests] = useState([]);

    const [selectedRide, setSelectedRide] = useState(null);

    const [offerPrices, setOfferPrices] = useState({});

    const [submittedIds, setSubmittedIds] = useState([]);

    const [loading, setLoading] = useState(true);

    const [busy, setBusy] = useState(false);

    const [offerBusy, setOfferBusy] = useState(null);

    const [message, setMessage] = useState("");

    const [socketConnected, setSocketConnected] = useState(false);

    const lastGps = useRef({ time: 0, point: null });

    const [soundEnabled, setSoundEnabled] = useState(false);

    const [nextBidAt, setNextBidAt] = useState({});

    const [clock, setClock] = useState(Date.now());

    const audioRef = useRef(null);

    const soundRef = useRef(false);

    const [mapExpanded, setMapExpanded] = useState(false);
    const [navigationInfo, setNavigationInfo] = useState(null);
    const rideInProgress = Boolean(selectedRide && ["DRIVER_SELECTED", "DRIVER_EN_ROUTE", "DRIVER_ARRIVED", "TRIP_STARTED"].includes(selectedRide.status));
    const nextTarget = !rideInProgress ? null : selectedRide.status === "TRIP_STARTED"
        ? (selectedRide.stops?.[selectedRide.stopsCompleted || 0] || selectedRide.destination)
        : selectedRide.pickup;
    const targetTitle = selectedRide?.status === "TRIP_STARTED"
        ? ((selectedRide.stopsCompleted || 0) < (selectedRide.stops?.length || 0) ? "Next stop" : "Destination")
        : "Passenger pickup";
    useEffect(() => {
        if (rideInProgress) setMapExpanded(true);
        else { setMapExpanded(false); setNavigationInfo(null); }
    }, [rideInProgress, selectedRide?._id]);

    useEffect(() => { soundRef.current = soundEnabled; }, [soundEnabled]);

    const playAlert = useCallback(() => {

        if (!soundRef.current || typeof window === "undefined") return;

        try {

            const AudioContext = window.AudioContext || window.webkitAudioContext;

            if (!AudioContext) return;

            const context = audioRef.current || new AudioContext();

            audioRef.current = context;

            if (context.state === "suspended") context.resume().catch(() => { });

            const start = context.currentTime;

            [660, 880].forEach((frequency, index) => {

                const oscillator = context.createOscillator();

                const gain = context.createGain();

                oscillator.type = "sine";

                oscillator.frequency.value = frequency;

                const at = start + index * 0.13;

                gain.gain.setValueAtTime(0.0001, at);

                gain.gain.exponentialRampToValueAtTime(0.065, at + 0.015);

                gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.12);

                oscillator.connect(gain).connect(context.destination);

                oscillator.start(at);

                oscillator.stop(at + 0.13);

            });

        } catch { /* Browser may block autoplay until a user gesture. */ }

    }, []);

    useEffect(() => {

        const interval = setInterval(() => setClock(Date.now()), 1000);

        return () => clearInterval(interval);

    }, []);

    const loadRequests = useCallback(async () => {

        if (!token || !isOnline || !isAvailable) {

            setRequests([]);

            return;

        }

        try {

            const data = await apiRequest(

                "/drivers/me/available-rides",

                { token }

            );

            setRequests((previous) => {

                const fetched = (data.rides || []).map((ride) => ({

                    ...ride,

                    rideId: String(ride._id),

                }));

                // REST response is the authoritative list; stale socket entries are removed.

                return fetched;

            });

        } catch (error) {

            setMessage(error.message);

        }

    }, [token, isOnline, isAvailable]);

    useEffect(() => {

        if (!token) return;

        let cancelled = false;

        async function initialize() {

            try {

                const [status, vehicleData, active] = await Promise.all([

                    apiRequest("/drivers/me/status", { token }),

                    getMyVehicles(token),

                    apiRequest("/drivers/me/active-ride", { token }),

                ]);

                if (cancelled) return;

                const driver = status.driver;

                setIsOnline(Boolean(driver?.isOnline));

                setIsAvailable(Boolean(driver?.isAvailable));

                setSelectedVehicle(driver?.currentVehicleId || "");

                setVehicles(

                    (vehicleData.vehicles || []).filter(

                        (v) => v.verificationStatus === "APPROVED" && v.isActive

                    )

                );

                setSelectedRide(active.ride || null);

                const coordinates = driver?.currentLocation?.coordinates;

                if (

                    Array.isArray(coordinates) &&

                    coordinates.length === 2 &&

                    !(coordinates[0] === 0 && coordinates[1] === 0)

                ) {

                    setLocation({

                        longitude: coordinates[0],

                        latitude: coordinates[1],

                    });

                }

            } catch (error) {

                if (!cancelled) setMessage(error.message);

            } finally {

                if (!cancelled) setLoading(false);

            }

        }

        initialize();

        return () => { cancelled = true; };

    }, [token]);

    useEffect(() => {

        if (!loading) loadRequests();

    }, [loading, loadRequests]);

    // Socket is primary; polling catches missed events, reconnects, and late GPS updates.

    useEffect(() => {

        if (!token || !isOnline || !isAvailable || loading) return;

        const timer = setInterval(() => {

            if (typeof document === "undefined" || !document.hidden) loadRequests();

        }, 12000);

        return () => clearInterval(timer);

    }, [token, isOnline, isAvailable, loading, loadRequests]);

    useEffect(() => {

        const socket = getRealtimeSocket();

        if (!socket || !token) return;

        setSocketConnected(socket.connected);

        const onConnect = () => {

            setSocketConnected(true);

            loadRequests();

        };

        const onDisconnect = () => setSocketConnected(false);

        const onNewRide = (ride) => {

            const id = String(ride?.rideId || ride?._id || "");

            if (!id || !isOnline || !isAvailable) return;

            setRequests((previous) => {

                if (previous.some((item) => item.rideId === id)) return previous;

                playAlert();

                return [{ ...ride, rideId: id, live: true }, ...previous];

            });

        };

        const onCancelled = ({ rideId }) => {

            setRequests((previous) =>

                previous.filter((r) => r.rideId !== rideId)

            );

        };

        const onSelected = async ({ rideId }) => {

            setRequests((previous) =>

                previous.filter((r) => r.rideId !== rideId)

            );

            try {

                const data = await apiRequest(

                    "/drivers/me/active-ride",

                    { token }

                );

                setSelectedRide(data.ride);

                setIsAvailable(false);

                setTab("trip");

                setMessage("Passenger selected your offer!");

            } catch (error) {

                setMessage(error.message);

            }

        };

        socket.on("connect", onConnect);

        socket.on("disconnect", onDisconnect);

        socket.on("ride:created", onNewRide);

        socket.on("ride:cancelled", onCancelled);

        socket.on("ride:driver:selected", onSelected);

        return () => {

            socket.off("connect", onConnect);

            socket.off("disconnect", onDisconnect);

            socket.off("ride:created", onNewRide);

            socket.off("ride:cancelled", onCancelled);

            socket.off("ride:driver:selected", onSelected);

        };

    }, [token, loadRequests, isOnline, isAvailable, playAlert]);

    useEffect(() => {

        if (!isOnline || !token) return;

        let stopped = false;

        let watchId;

        let sending = false;

        async function track() {

            try {

                watchId = await Geolocation.watchPosition(

                    {

                        enableHighAccuracy: true,

                        timeout: 15000,

                        maximumAge: 5000,

                    },

                    async (position, error) => {

                        if (stopped || !position || error || sending) return;

                        const { latitude, longitude, accuracy } = position.coords;

                        if (

                            !Number.isFinite(latitude) ||

                            !Number.isFinite(longitude) ||

                            Math.abs(latitude) > 90 ||

                            Math.abs(longitude) > 180

                        ) return;

                        const point = { latitude, longitude };

                        // Show approximate location on the map.

                        setLocation(point);

                        if (!Number.isFinite(accuracy) || accuracy > 100) {

                            setGpsMessage(

                                "Approximate location only — waiting for accurate GPS"

                            );

                            return;

                        }

                        setGpsMessage(`GPS accuracy: ${Math.round(accuracy)} m`);

                        const now = Date.now();

                        const last = lastGps.current;

                        if (now - last.time < 10000) return;

                        if (last.point) {

                            const moved = Math.hypot(

                                (latitude - last.point.latitude) * 111000,

                                (longitude - last.point.longitude) * 111000 *

                                Math.cos(latitude * Math.PI / 180)

                            );

                            if (moved < 20 && now - last.time < 30000) return;

                        }

                        sending = true;

                        try {

                            await updateDriverLocation(latitude, longitude, token);

                            lastGps.current = { time: Date.now(), point };

                            loadRequests();

                        } catch (err) {

                            setGpsMessage(err.message);

                        } finally {

                            sending = false;

                        }

                    }

                );

                if (stopped && watchId != null) {

                    await Geolocation.clearWatch({ id: watchId });

                }

            } catch (error) {

                if (!stopped) setGpsMessage(error.message);

            }

        }

        track();

        return () => {

            stopped = true;

            if (watchId != null) Geolocation.clearWatch({ id: watchId });

        };

    }, [isOnline, token, loadRequests]);

    useEffect(() => {

        let cancelled = false;

        async function detectLocation() {

            try {

                const position = await Geolocation.getCurrentPosition({

                    enableHighAccuracy: true,

                    timeout: 15000,

                });

                if (cancelled) return;

                setLocation({

                    latitude: position.coords.latitude,

                    longitude: position.coords.longitude,

                });

                setGpsMessage(

                    `Location accuracy: ${Math.round(position.coords.accuracy)} m`

                );

            } catch (error) {

                if (!cancelled) {

                    setGpsMessage(

                        error.message || "Location permission required"

                    );

                }

            }

        }

        detectLocation();

        return () => {

            cancelled = true;

        };

    }, []);

    async function toggleOnline() {

        if (busy) return;

        setBusy(true);

        try {

            const goingOnline = !isOnline;

            let point = null;

            if (goingOnline) {

                const position = await Geolocation.getCurrentPosition({

                    enableHighAccuracy: true,

                    timeout: 15000,

                    maximumAge: 0,

                });

                const { latitude, longitude, accuracy } = position.coords;

                if (!Number.isFinite(accuracy) || accuracy > 100 ||

                    !Number.isFinite(latitude) || !Number.isFinite(longitude) ||

                    Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {

                    throw new Error("Accurate GPS required (within 100 metres).");

                }

                point = { latitude, longitude };

                setLocation(point);

                setLocateRequest((value) => value + 1);

            }

            const data = await updateOnlineStatus(goingOnline, token);

            if (goingOnline && point) {

                try {

                    await updateDriverLocation(point.latitude, point.longitude, token);

                    lastGps.current = { time: Date.now(), point };

                } catch (error) {

                    try {

                        await updateOnlineStatus(false, token);

                        setIsOnline(false);

                        setIsAvailable(false);

                    } catch {

                        // Rollback failed; refresh status so UI never claims certainty.

                        const status = await apiRequest("/drivers/me/status", { token });

                        setIsOnline(Boolean(status.driver?.isOnline));

                        setIsAvailable(Boolean(status.driver?.isAvailable));

                    }

                    throw error;

                }

            }

            setIsOnline(Boolean(data.isOnline));

            setIsAvailable(Boolean(data.isAvailable));

            setMessage(data.isOnline ? "You are online and location synced." : "You are offline.");

            if (data.isOnline) {

                const available = await apiRequest("/drivers/me/available-rides", { token });

                setRequests((available.rides || []).map((ride) => ({

                    ...ride, rideId: String(ride._id),

                })));

            } else {

                setRequests([]);

            }

        } catch (error) {

            setMessage(error.message);

        } finally {

            setBusy(false);

        }

    }

    async function saveVehicle() {

        if (!selectedVehicle || isOnline || busy) return;

        setBusy(true);

        try {

            await selectVehicle(selectedVehicle, token);

            setMessage("Active vehicle updated.");

        } catch (error) {

            setMessage(error.message);

        } finally {

            setBusy(false);

        }

    }

    async function sendOffer(ride) {

        const price = Number(

            offerPrices[ride.rideId] ?? ride.requestedPrice

        );

        if (!Number.isSafeInteger(price) || price <= 0 || price > 1000000 || offerBusy) {

            setMessage("Please enter a valid fare.");

            return;

        }

        if (clock < (nextBidAt[ride.rideId] || 0)) {

            setMessage("Please wait for the rebid cooldown.");

            return;

        }

        setOfferBusy(ride.rideId);

        try {

            await submitDriverOffer(ride.rideId, price, token);

            setSubmittedIds((previous) => [...new Set([...previous, ride.rideId])]);

            setNextBidAt((previous) => ({ ...previous, [ride.rideId]: Date.now() + 15000 }));

            setMessage(submittedIds.includes(ride.rideId) ? "Offer updated successfully." : "Offer submitted successfully.");

        } catch (error) {

            setMessage(error.message);

        } finally {

            setOfferBusy(null);

        }

    }

    async function updateStop(action) {

        if (!selectedRide?._id || busy) return;

        setBusy(true);

        try {

            const data = await apiRequest(

                `/rides/${selectedRide._id}/stops`,

                {

                    method: "PATCH",

                    token,

                    body: JSON.stringify({ action }),

                }

            );

            setSelectedRide(data.ride);

            setMessage(

                action === "ARRIVE"

                    ? "Stop arrival recorded. Waiting timer started."

                    : "Stop completed. Continue to next location."

            );

        } catch (error) {

            setMessage(error.message);

        } finally {

            setBusy(false);

        }

    }

    async function advanceTrip() {

        const action = ACTIONS[selectedRide?.status];

        if (!action || busy || !selectedRide?._id) return;

        setBusy(true);

        try {

            const data = await apiRequest(

                `/rides/${selectedRide._id}/status`,

                {

                    method: "PATCH",

                    token,

                    body: JSON.stringify({ status: action[0] }),

                }

            );

            setSelectedRide(data.ride);

            setMessage(`Trip status: ${data.ride.status}`);

            if (data.ride.status === "TRIP_COMPLETED") {

                setIsAvailable(isOnline);

            }

        } catch (error) {

            setMessage(error.message);

        } finally {

            setBusy(false);

        }

    }

    const activeVehicle = vehicles.find(

        (v) => v._id === selectedVehicle

    );

    return (

        <main className="relative h-dvh overflow-hidden bg-[#F8FAF9] text-slate-900">

            <div className="absolute inset-0">

                <RideMap

                    userLocation={location}

                    locateRequest={locateRequest}

                    destination={nextTarget}
                    navigationMode={Boolean(selectedRide && ["DRIVER_SELECTED", "DRIVER_EN_ROUTE", "DRIVER_ARRIVED", "TRIP_STARTED"].includes(selectedRide.status))}
                    driverLocation={location}
                    followDriver={rideInProgress}
                    onRouteUpdate={setNavigationInfo}

                    stops={[]}

                />

            </div>

            <header className="absolute inset-x-0 top-0 z-20 flex items-center justify-between px-4 pt-[max(20px,env(safe-area-inset-top))]">

                <div className="flex items-center gap-3 rounded-2xl bg-white px-4 py-3 shadow-lg">

                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#087F5B] font-bold text-white">

                        {BRAND.shortName}

                    </div>



                    <Link

                        href="/driver/account"

                        aria-label="My Account"

                        className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-50 text-[#087F5B]"

                    >

                        <UserRound size={20} />

                    </Link>

                </div>

                <div className="flex items-center gap-2 rounded-xl bg-white px-3 py-3 shadow-lg">

                    <span className={`h-2.5 w-2.5 rounded-full ${isOnline ? "bg-emerald-500" : "bg-slate-400"

                        }`} />

                    <span className="text-xs font-bold">

                        {isOnline ? (isAvailable ? "ONLINE" : "ON TRIP") : "OFFLINE"}

                    </span>

                </div>

            </header>

            <button

                type="button"

                aria-label="Locate me"

                onClick={async () => {

                    try {

                        const pos = await Geolocation.getCurrentPosition({

                            enableHighAccuracy: true,

                            timeout: 15000,

                        });

                        setLocation({

                            latitude: pos.coords.latitude,

                            longitude: pos.coords.longitude,

                        });

                        setLocateRequest((value) => value + 1);

                        setGpsMessage(

                            `Location accuracy: ${Math.round(pos.coords.accuracy)} m`

                        );

                    } catch (error) {

                        setMessage(error.message);

                    }

                }}

                className="absolute right-4 top-28 z-20 flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-[#087F5B] shadow-lg"

            >

                <LocateFixed size={21} />

            </button>

            <div className="absolute right-4 top-44 z-20 flex flex-col gap-2">

                <button type="button" onClick={() => setMapExpanded((value) => !value)}

                    className="rounded-xl bg-white px-3 py-2 text-xs font-bold text-[#087F5B] shadow-lg">

                    {mapExpanded ? "Show controls" : "Full map"}

                </button>

                <button type="button" onClick={() => { setSoundEnabled((value) => !value); }}

                    className="flex items-center justify-center gap-2 rounded-xl bg-white px-3 py-2 text-xs font-bold text-[#087F5B] shadow-lg"

                    aria-label={soundEnabled ? "Mute new ride alerts" : "Enable new ride alerts"}>

                    {soundEnabled ? <Volume2 size={17} /> : <VolumeX size={17} />}

                    Alerts {soundEnabled ? "on" : "off"}

                </button>

            </div>

            {rideInProgress && mapExpanded && (
                <div className="pointer-events-none absolute inset-x-3 bottom-[calc(85px+env(safe-area-inset-bottom))] z-30 mx-auto max-w-lg">
                    <div className="pointer-events-auto rounded-[22px] border border-emerald-100 bg-white/95 p-4 shadow-2xl backdrop-blur-md">
                        <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0 flex-1">
                                <p className="text-[11px] font-bold uppercase tracking-widest text-emerald-700">{targetTitle}</p>
                                <p className="mt-1 truncate text-base font-extrabold text-slate-900">
                                    {navigationInfo?.nextStep || (selectedRide.status === "DRIVER_ARRIVED" ? "Waiting at pickup" : "Follow the blue road route")}
                                </p>
                                <p className="mt-1 text-xs text-slate-600">
                                    {navigationInfo ? `${navigationInfo.distanceKm} km · approx. ${navigationInfo.durationMinutes} min` : "Calculating road ETA…"}
                                </p>
                            </div>
                            <button type="button" onClick={() => setMapExpanded(false)}
                                className="shrink-0 rounded-xl bg-[#087F5B] px-3 py-3 text-xs font-bold text-white">
                                Trip controls
                            </button>
                        </div>
                        {selectedRide.status === "DRIVER_ARRIVED" && (
                            <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">Passenger pickup confirmed. Start trip only after passenger boards.</p>
                        )}
                    </div>
                </div>
            )}

            <section className={`absolute inset-x-0 bottom-[calc(68px+env(safe-area-inset-bottom))] z-20 max-h-[calc(78dvh-68px)] overflow-y-auto rounded-t-[32px] bg-white shadow-[0_-12px_50px_rgba(15,23,42,0.14)] transition-transform duration-300 ${mapExpanded ? "translate-y-[120%] pointer-events-none" : ""}`}>

                <div className="mx-auto max-w-2xl px-5 pb-[max(24px,env(safe-area-inset-bottom))] pt-4">

                    <div className="mx-auto mb-5 h-1.5 w-12 rounded-full bg-slate-200" />

                    <div className="mb-5 flex items-center justify-between">

                        <div>

                            <p className="text-sm text-slate-500">

                                Hello, {user?.firstName || "Driver"} 👋

                            </p>

                            <h1 className="mt-1 text-2xl font-extrabold">

                                Your driving hub

                            </h1>

                        </div>

                        <CarFront className="text-[#087F5B]" size={30} />

                    </div>

                    <div className={`mb-5 flex items-center justify-between gap-3 rounded-2xl p-4 ${isOnline ? "bg-emerald-50" : "bg-slate-50"

                        }`}>

                        <div>

                            <p className="font-bold">

                                {loading ? "Loading..." : isOnline ? "You're online" : "You're offline"}

                            </p>

                            <p className="mt-1 text-xs text-slate-500">

                                {isOnline ? gpsMessage : "Choose an approved vehicle to start"}

                            </p>

                        </div>

                        <button

                            type="button"

                            onClick={toggleOnline}

                            disabled={loading || busy || (!isOnline && !activeVehicle)}

                            className={`rounded-xl px-5 py-3 text-sm font-bold text-white disabled:opacity-50 ${isOnline ? "bg-slate-800" : "bg-[#087F5B]"

                                }`}

                        >

                            {busy ? "Please wait..." : isOnline ? "Go Offline" : "Go Online"}

                        </button>

                    </div>

                    <div className="mb-5 grid grid-cols-2 gap-3">

                        <button

                            type="button"

                            onClick={() => setTab("requests")}

                            className={`rounded-xl border p-3 text-sm font-bold ${tab === "requests"

                                ? "border-[#087F5B] bg-emerald-50 text-[#065F46]"

                                : "border-slate-200"

                                }`}

                        >

                            Ride Requests

                        </button>

                        <button

                            type="button"

                            onClick={() => setTab("vehicle")}

                            className={`rounded-xl border p-3 text-sm font-bold ${tab === "vehicle"

                                ? "border-[#087F5B] bg-emerald-50 text-[#065F46]"

                                : "border-slate-200"

                                }`}

                        >

                            My Vehicle

                        </button>

                    </div>

                    {selectedRide && ACTIONS[selectedRide.status] && (

                        <div className="mb-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4">

                            <h3 className="font-bold text-[#065F46]">

                                Active Trip

                            </h3>

                            <p className="mt-2 text-sm">

                                {selectedRide.status.replaceAll("_", " ")}

                            </p>

                            <RideChat rideId={selectedRide._id} token={token} userId={user?._id || user?.id} />
                            <p className="mt-1 font-semibold">

                                {money(selectedRide.finalPrice)}

                            </p>

                            {selectedRide.stops?.length > 0 && (

                                <div className="mt-4 space-y-2 rounded-xl bg-white p-3">

                                    <p className="text-sm font-bold text-[#087F5B]">

                                        Journey Stops ({selectedRide.stops.length})

                                    </p>

                                    {selectedRide.stops.map((stop, index) => (

                                        <div

                                            key={index}

                                            className={`flex gap-2 text-sm ${index < (selectedRide.stopsCompleted || 0)

                                                ? "text-emerald-600 line-through"

                                                : ""

                                                }`}

                                        >

                                            <span className="font-bold text-[#087F5B]">

                                                {index + 1}.

                                            </span>

                                            <span>

                                                {stop.name || placeText(stop)}

                                            </span>

                                        </div>

                                    ))}

                                    {selectedRide.status === "TRIP_STARTED" &&

                                        (selectedRide.stopsCompleted || 0) <

                                        selectedRide.stops.length && (

                                            <div className="rounded-xl border border-emerald-200 p-3">

                                                <p className="mb-2 text-sm font-bold">

                                                    Current Stop: {

                                                        (selectedRide.stopsCompleted || 0) + 1

                                                    } / {selectedRide.stops.length}

                                                </p>

                                                {selectedRide.stopWaitingSince && (

                                                    <p className="mb-2 text-xs text-amber-700">

                                                        Waiting started: {

                                                            new Date(

                                                                selectedRide.stopWaitingSince

                                                            ).toLocaleTimeString()

                                                        }

                                                    </p>

                                                )}

                                                <button

                                                    type="button"

                                                    disabled={busy}

                                                    onClick={() =>

                                                        updateStop(

                                                            selectedRide.stopWaitingSince

                                                                ? "CONTINUE"

                                                                : "ARRIVE"

                                                        )

                                                    }

                                                    className="w-full rounded-xl bg-[#087F5B] p-3 font-bold text-white disabled:opacity-50"

                                                >

                                                    {selectedRide.stopWaitingSince

                                                        ? "Continue Trip"

                                                        : "Arrived at Stop"}

                                                </button>

                                            </div>

                                        )}

                                    <p className="border-t pt-2 text-sm font-semibold">

                                        Destination: {placeText(selectedRide.destination)}

                                    </p>

                                </div>

                            )}

                            <button

                                type="button"

                                onClick={advanceTrip}

                                disabled={

                                    busy ||

                                    (selectedRide.status === "TRIP_STARTED" &&

                                        ((selectedRide.stopsCompleted || 0) < (selectedRide.stops?.length || 0) ||

                                            Boolean(selectedRide.stopWaitingSince)))

                                }

                                className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-[#087F5B] p-4 font-bold text-white disabled:opacity-50"

                            >

                                {ACTIONS[selectedRide.status][1]}

                                <ArrowRight size={18} />

                            </button>

                        </div>

                    )}

                    {tab === "vehicle" ? (

                        <div className="rounded-2xl bg-slate-50 p-4">

                            <h2 className="mb-3 font-bold">Approved Vehicle</h2>

                            <select

                                value={selectedVehicle}

                                disabled={isOnline}

                                onChange={(e) => setSelectedVehicle(e.target.value)}

                                className="h-12 w-full rounded-xl border bg-white px-3 text-sm"

                            >

                                <option value="">Select approved vehicle</option>

                                {vehicles.map((vehicle) => (

                                    <option key={vehicle._id} value={vehicle._id}>

                                        {vehicleNames[vehicle.vehicleType] || vehicle.vehicleType}

                                        {" — "}

                                        {vehicle.registrationNumber}

                                    </option>

                                ))}

                            </select>

                            <button

                                type="button"

                                onClick={saveVehicle}

                                disabled={isOnline || busy || !selectedVehicle}

                                className="mt-3 h-12 w-full rounded-xl bg-[#087F5B] font-bold text-white disabled:opacity-50"

                            >

                                Set Active Vehicle

                            </button>

                            {vehicles.length === 0 && (

                                <p className="mt-3 text-sm text-slate-500">

                                    No approved vehicles found.

                                </p>

                            )}

                            <Link

                                href="/driver/vehicles"

                                className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-xl border-2 border-[#087F5B] bg-white font-bold text-[#087F5B]"

                            >

                                <CarFront size={19} />

                                Manage / Register Vehicles

                                <ArrowRight size={17} />

                            </Link>

                            <Link

                                href="/driver/documents"

                                className="mt-3 flex h-12 w-full items-center justify-center rounded-xl border-2 border-emerald-200 bg-white text-sm font-bold text-[#087F5B]"

                            >

                                Upload Verification Documents

                            </Link>

                        </div>

                    ) : (

                        <div className="space-y-3">

                            <div className="flex items-center justify-between">

                                <h2 className="text-lg font-extrabold">

                                    Nearby Ride Requests

                                </h2>

                                <button

                                    type="button"

                                    onClick={loadRequests}

                                    disabled={!isOnline}

                                    className="flex items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2 text-sm font-bold text-[#087F5B]"

                                >

                                    <RefreshCw size={16} /> Refresh

                                </button>

                            </div>

                            {requests.length === 0 ? (

                                <div className="rounded-2xl border border-dashed p-8 text-center">

                                    <Compass

                                        size={30}

                                        className="mx-auto mb-3 text-[#087F5B]"

                                    />

                                    <p className="font-bold">

                                        {isOnline ? "No nearby requests yet" : "You're offline"}

                                    </p>

                                    <p className="mt-2 text-sm text-slate-500">

                                        {isOnline

                                            ? "New requests will appear here."

                                            : "Go online to receive rides."}

                                    </p>

                                </div>

                            ) : (

                                requests.map((ride) => (

                                    <div

                                        key={ride.rideId}

                                        className="rounded-2xl border border-slate-200 p-4 shadow-sm"

                                    >

                                        <div className="mb-3 flex justify-between">

                                            <span className="rounded-lg bg-emerald-50 px-3 py-1 text-xs font-bold text-[#065F46]">

                                                {vehicleNames[ride.vehicleType] || ride.vehicleType}

                                            </span>

                                            <span className="font-extrabold text-[#087F5B]">

                                                {money(ride.requestedPrice)}

                                            </span>

                                        </div>

                                        <p className="mb-2 text-sm">

                                            <Navigation size={15} className="mr-2 inline text-[#087F5B]" />

                                            {placeText(ride.pickup)}

                                        </p>

                                        <p className="mb-3 text-sm">

                                            <MapPin size={15} className="mr-2 inline text-red-500" />

                                            {placeText(ride.destination)}

                                        </p>

                                        {ride.stops?.length > 0 && (

                                            <div className="mb-3 rounded-xl bg-emerald-50 p-3 text-sm">

                                                <p className="font-bold text-[#087F5B]">

                                                    {ride.stops.length} Intermediate Stops

                                                </p>

                                                {ride.stops.map((stop, index) => (

                                                    <p key={index} className="mt-1">

                                                        {index + 1}. {stop.name || placeText(stop)}

                                                    </p>

                                                ))}

                                            </div>

                                        )}

                                        {ride.distance != null && (

                                            <p className="mb-3 text-xs text-slate-500">

                                                {ride.distance} km estimated

                                            </p>

                                        )}

                                        <div className="flex gap-2">

                                            <input

                                                type="number"

                                                min="1"

                                                step="1"

                                                value={

                                                    offerPrices[ride.rideId] ??

                                                    ride.requestedPrice ??

                                                    ""

                                                }

                                                onChange={(e) =>

                                                    setOfferPrices((previous) => ({

                                                        ...previous,

                                                        [ride.rideId]: e.target.value,

                                                    }))

                                                }

                                                className="min-w-0 flex-1 rounded-xl border px-3"

                                                aria-label="Your offer in PKR"

                                            />

                                            <button

                                                type="button"

                                                onClick={() => sendOffer(ride)}

                                                disabled={Boolean(offerBusy) || clock < (nextBidAt[ride.rideId] || 0)}

                                                className="rounded-xl bg-[#087F5B] px-4 py-3 text-sm font-bold text-white disabled:opacity-50"

                                            >

                                                {offerBusy === ride.rideId

                                                    ? "Sending..."

                                                    : clock < (nextBidAt[ride.rideId] || 0)

                                                        ? `Wait ${Math.ceil((nextBidAt[ride.rideId] - clock) / 1000)}s`

                                                        : submittedIds.includes(ride.rideId)

                                                            ? "Update Offer"

                                                            : "Send Offer"}

                                            </button>

                                        </div>

                                    </div>

                                ))

                            )}

                        </div>

                    )}

                    {message && (

                        <p

                            role="status"

                            className="mt-4 rounded-xl bg-emerald-50 p-3 text-sm text-[#065F46]"

                        >

                            {message}

                        </p>

                    )}

                    <p className="mt-5 text-center text-xs text-slate-400">

                        Manage your account and sign out from the Account screen.

                    </p>

                </div>

            </section>

            <MobileBottomNav role="DRIVER" />

        </main>

    );

}
