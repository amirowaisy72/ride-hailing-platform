"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    ArrowRight, CarFront, CheckCircle2, ChevronRight, Compass, CornerUpRight, FileCheck2,
    Flag, Hourglass, MapPin, MessageCircle, Navigation, Power, RefreshCw, Satellite, UserRound,
    WifiOff, XCircle, Menu, X, Bell, BellRing, Volume2, VolumeX, LocateFixed,
} from "lucide-react";
import { Geolocation } from "@capacitor/geolocation";
import AuthGuard from "@/components/AuthGuard";
import RideMap from "@/components/RideMap";
import { reverseGeocode } from "@/lib/locationService";
import RideChat from "@/components/RideChat";
import ParcelActivityBar from "@/components/ParcelActivityBar";
import { Package } from "lucide-react";
import Link from "next/link";
import MobileBottomNav from "@/components/MobileBottomNav";
import DriverSheet from "@/components/driver/DriverSheet";
import DriverRequestCard, { money, placeText, vehicleNames } from "@/components/driver/DriverRequestCard";
import { DriverToast } from "@/components/driver/DriverMapControls";
import useDriverNotifications from "@/components/driver/useDriverNotifications";
import { useAuth } from "@/context/AuthContext";
import { BRAND } from "@/config/brand";
import { apiRequest } from "@/lib/api";
import { submitDriverOffer } from "@/lib/driverRideService";
import { getMyVehicles, selectVehicle, updateOnlineStatus, updateDriverLocation } from "@/lib/vehicleService";
import { getRealtimeSocket } from "@/lib/socket";
import { useRideUnreadMessages } from "@/hooks/useRideUnreadMessages";
// Allowed driver-side transitions (unchanged backend contract).

const PARCEL_LINK = "/driver/parcels";

function ParcelShortcut() {
    return (
        <Link
            href={PARCEL_LINK}
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-[#C1F11D] px-3 text-sm font-extrabold text-[#111111]"
        >
            <Package size={19} />
            Parcels
        </Link>
    );
}

const ACTIONS = {
    DRIVER_SELECTED: ["DRIVER_EN_ROUTE", "Head to pickup"],
    DRIVER_EN_ROUTE: ["DRIVER_ARRIVED", "I've arrived"],
    DRIVER_ARRIVED: ["TRIP_STARTED", "Start trip"],
    TRIP_STARTED: ["TRIP_COMPLETED", "Complete trip"],
};

const IN_PROGRESS = ["DRIVER_SELECTED", "DRIVER_EN_ROUTE", "DRIVER_ARRIVED", "TRIP_STARTED"];

const ENDED = ["TRIP_COMPLETED", "CANCELLED", "EXPIRED"];

const STAGES = ["Accepted", "To pickup", "Arrived", "On trip"];

const STATUS_LABEL = {
    REQUESTED: "Requested", SEARCHING: "Searching", BIDDING: "Bidding", REASSIGNING: "Reassigning",
    DRIVER_SELECTED: "Assignment confirmed", DRIVER_EN_ROUTE: "Heading to pickup",
    DRIVER_ARRIVED: "Waiting at pickup", TRIP_STARTED: "Trip in progress",
    TRIP_COMPLETED: "Trip completed", CANCELLED: "Ride cancelled", EXPIRED: "Ride expired",
};

export default function DriverPage() {
    return (
        <AuthGuard role="DRIVER">
            <DriverDashboard />
        </AuthGuard>
    );
}

function useViewportHeight() {
    const [h, setH] = useState(800);
    useEffect(() => {
        const update = () => setH(window.visualViewport?.height || window.innerHeight || 800);
        update();
        window.addEventListener("resize", update);
        window.visualViewport?.addEventListener("resize", update);
        return () => {
            window.removeEventListener("resize", update);
            window.visualViewport?.removeEventListener("resize", update);
        };
    }, []);
    return h;
}

function formatMeters(m) {
    if (!Number.isFinite(m) || m <= 0) return null;
    return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m / 10) * 10} m`;
}

function DriverDashboard() {
    const { user, token } = useAuth();
    const notifications = useDriverNotifications();
    const { notify } = notifications;
    const notifyRef = useRef(notify);
    notifyRef.current = notify;
    const [tab, setTab] = useState("requests");
    const [vehicles, setVehicles] = useState([]);
    const [selectedVehicle, setSelectedVehicle] = useState("");
    const [savedVehicle, setSavedVehicle] = useState("");
    const [isOnline, setIsOnline] = useState(false);
    const [isAvailable, setIsAvailable] = useState(false);
    const [location, setLocation] = useState(null);
    const [locateRequest, setLocateRequest] = useState(0);
    const [locating, setLocating] = useState(false);
    const [gps, setGps] = useState({ accuracy: null, text: "Waiting for GPS" });
    const [requests, setRequests] = useState([]);
    const [parcelRequests, setParcelRequests] = useState([]);
    const [parcelAssignment, setParcelAssignment] = useState(null);
    const [selectedRide, setSelectedRide] = useState(null);
    const [requestAddresses, setRequestAddresses] = useState({});
    const addressCacheRef = useRef(new Map());
    // Resolve only newly seen request points; keep earlier results across polling.
    useEffect(() => {
        if (!token || (!requests.length && !selectedRide)) return;
        let cancelled = false;
        const unknown = [];
        for (const ride of [...requests, ...(selectedRide ? [selectedRide] : [])]) {
            for (const point of [ride.pickup, ride.destination, ...(ride.stops || [])]) {
                const coords = Array.isArray(point?.coordinates) ? point.coordinates : [point?.longitude, point?.latitude];
                const lng = Number(coords?.[0]);
                const lat = Number(coords?.[1]);
                if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
                const key = `${lat.toFixed(5)},${lng.toFixed(5)}`;
                if (!point?.name && !addressCacheRef.current.has(key) && !unknown.some((item) => item.key === key)) {
                    unknown.push({ key, lat, lng });
                }
            }
        }
        // Public Nominatim is rate-limited. One request per 1.2 s, maximum 12 new points in a batch.
        async function resolveNames() {
            for (const { key, lat, lng } of unknown.slice(0, 12)) {
                if (cancelled) break;
                addressCacheRef.current.set(key, "Locating place...");
                try {
                    const place = await reverseGeocode(lat, lng, token);
                    const raw = String(place?.display_name || place?.displayName || place?.name || "").trim();
                    const label = raw ? raw.split(",").slice(0, 2).join(",").trim() : "Nearby location";
                    addressCacheRef.current.set(key, label);
                } catch {
                    addressCacheRef.current.set(key, "Nearby location");
                }
                if (!cancelled) setRequestAddresses(Object.fromEntries(addressCacheRef.current));
                await new Promise((resolve) => setTimeout(resolve, 1200));
            }
        }
        void resolveNames();
        return () => { cancelled = true; };
    }, [token, requests, selectedRide?._id]);
    const labelPoint = (point) => {
        if (!point || point.name || point.address) return point;
        const coords = Array.isArray(point.coordinates) ? point.coordinates : [point.longitude, point.latitude];
        const lng = Number(coords?.[0]);
        const lat = Number(coords?.[1]);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return point;
        const key = `${lat.toFixed(5)},${lng.toFixed(5)}`;
        return { ...point, name: requestAddresses[key] || "Locating place..." };
    };
    const namedRequests = requests.map((ride) => ({
        ...ride, pickup: labelPoint(ride.pickup), destination: labelPoint(ride.destination), stops: ride.stops?.map(labelPoint)
    }));
    const [offerPrices, setOfferPrices] = useState({});
    const [submittedIds, setSubmittedIds] = useState([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [busy, setBusy] = useState(false);
    const [offerBusy, setOfferBusy] = useState(null);
    const [socketConnected, setSocketConnected] = useState(true);
    const [nextBidAt, setNextBidAt] = useState({});
    const [clock, setClock] = useState(Date.now());

    const waitingSince = selectedRide?.status === "DRIVER_ARRIVED"
        ? (selectedRide.pickupWaitingSince || selectedRide.driverArrivedAt)
        : selectedRide?.stopWaitingSince;

    const waitingSeconds = waitingSince
        ? Math.max(0, Math.floor(
            (clock - new Date(waitingSince).getTime()) / 1000
        ))
        : 0;

    const waitingTime = `${String(Math.floor(waitingSeconds / 60)).padStart(2, "0")}:${String(waitingSeconds % 60).padStart(2, "0")}`;
    const [navigationInfo, setNavigationInfo] = useState(null);
    const [sheet, setSheet] = useState("half");
    const [chatOpen, setChatOpen] = useState(false);
    const [mapMenuOpen, setMapMenuOpen] = useState(false);
    const lastGps = useRef({ time: 0, point: null });
    const selectedRideRef = useRef(null);
    selectedRideRef.current = selectedRide;
    const viewportH = useViewportHeight();
    const rideInProgress = Boolean(selectedRide && IN_PROGRESS.includes(selectedRide.status));
    const { unread: unreadMessages, markRead: markMessagesRead } = useRideUnreadMessages(
        rideInProgress ? String(selectedRide._id) : null, token, user?._id || user?.id, chatOpen
    );
    const rideEnded = Boolean(selectedRide && ENDED.includes(selectedRide.status));
    const stopsTotal = selectedRide?.stops?.length || 0;
    const stopsDone = selectedRide?.stopsCompleted || 0;
    const pendingStop = selectedRide?.status === "TRIP_STARTED" && stopsDone < stopsTotal;
    const nextTarget = !rideInProgress ? null : selectedRide.status === "TRIP_STARTED"
        ? (selectedRide.stops?.[stopsDone] || selectedRide.destination)
        : selectedRide.pickup;
    const stageIndex = { DRIVER_SELECTED: 0, DRIVER_EN_ROUTE: 1, DRIVER_ARRIVED: 2, TRIP_STARTED: 3 }[selectedRide?.status] ?? 0;
    const targetTitle = selectedRide?.status === "TRIP_STARTED"
        ? (pendingStop
            ? (selectedRide?.tripType === "ROUND_TRIP" && stopsDone === stopsTotal - 1
                ? "Outbound destination"
                : `Stop ${stopsDone + 1} of ${stopsTotal}`)
            : selectedRide?.tripType === "ROUND_TRIP"
                ? "Return to pickup"
                : "Destination")
        : "Passenger pickup";
    const navigating = rideInProgress && ["DRIVER_EN_ROUTE", "TRIP_STARTED"].includes(selectedRide.status);
    // Sheet geometry — the map camera is told how much of the screen the sheet covers.
    const navH = rideInProgress ? 0 : 68;
    const heights = useMemo(() => (rideInProgress
        ? { peek: "118px", half: "min(52dvh, 460px)", full: "calc(100dvh - 128px - env(safe-area-inset-top))" }
        : { peek: "148px", half: "min(50dvh, 440px)", full: "calc(100dvh - 150px - env(safe-area-inset-top))" }), [rideInProgress]);
    const sheetPx = sheet === "peek" ? (rideInProgress ? 118 : 148)
        : sheet === "half" ? Math.min(viewportH * 0.52, rideInProgress ? 460 : 440)
            : viewportH * 0.7;
    const sheetRatio = Math.min(0.75, (sheetPx + navH) / Math.max(1, viewportH));
    // Ride lifecycle drives the layout: navigation collapses the sheet to keep the map dominant.
    useEffect(() => {
        if (!selectedRide) { setNavigationInfo(null); return; }
        if (["DRIVER_EN_ROUTE", "TRIP_STARTED"].includes(selectedRide.status)) setSheet("peek");
        else if (selectedRide.status === "DRIVER_SELECTED" || selectedRide.status === "DRIVER_ARRIVED") setSheet("peek");
        else if (ENDED.includes(selectedRide.status)) setSheet("half");
    }, [selectedRide?._id, selectedRide?.status, stopsDone, Boolean(selectedRide?.stopWaitingSince)]); // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => { setNavigationInfo(null); }, [selectedRide?._id, selectedRide?.status, stopsDone]);
    useEffect(() => { if (!rideInProgress) setChatOpen(false); }, [rideInProgress]);
    useEffect(() => {
        const interval = setInterval(() => setClock(Date.now()), 1000);
        return () => clearInterval(interval);
    }, []);
    const reportError = useCallback((error, title = "Something went wrong") => {
        notifyRef.current({ kind: "error", title, body: error?.message || String(error || ""), key: `err:${error?.message}` });
    }, []);
    const loadRequests = useCallback(async () => {
        if (!token || !isOnline || !isAvailable) {
            setRequests([]);
            return;
        }
        try {
            const data = await apiRequest("/drivers/me/available-rides", { token });
            // REST response is the authoritative list; stale socket entries are removed.
            setRequests((previous) => {
                const live = new Set(previous.filter((r) => r.live).map((r) => r.rideId));
                return (data.rides || []).map((ride) => ({ ...ride, rideId: String(ride._id), live: live.has(String(ride._id)) }));
            });
        } catch (error) {
            reportError(error, "Couldn't load ride requests");
        }
    }, [token, isOnline, isAvailable, reportError]);
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
                setSavedVehicle(driver?.currentVehicleId || "");
                setVehicles((vehicleData.vehicles || []).filter((v) => v.verificationStatus === "APPROVED" && v.isActive));
                setSelectedRide(active.ride || null);
                const coordinates = driver?.currentLocation?.coordinates;
                if (Array.isArray(coordinates) && coordinates.length === 2 && !(coordinates[0] === 0 && coordinates[1] === 0)) {
                    setLocation((current) => current || { longitude: coordinates[0], latitude: coordinates[1] });
                }
            } catch (error) {
                if (!cancelled) reportError(error, "Couldn't load your driver status");
            } finally {
                if (!cancelled) setLoading(false);
            }
        }
        initialize();
        return () => { cancelled = true; };
    }, [token, reportError]);
    useEffect(() => { if (!loading) loadRequests(); }, [loading, loadRequests]);
    // Socket is primary; polling catches missed events, reconnects, and late GPS updates.
    useEffect(() => {
        if (!token || !isOnline || !isAvailable || loading) return;
        const timer = setInterval(() => {
            if (typeof document === "undefined" || !document.hidden) loadRequests();
        }, 12000);
        return () => clearInterval(timer);
    }, [token, isOnline, isAvailable, loading, loadRequests]);
    useEffect(() => {
        if (!token || !isOnline || !isAvailable) {
            setParcelRequests([]);
            return;
        }

        let active = true;

        async function loadParcels() {
            try {
                const data = await apiRequest("/parcels/available", { token });
                if (active) setParcelRequests(data.orders || []);
            } catch {
                if (active) setParcelRequests([]);
            }
        }

        loadParcels();
        const timer = setInterval(loadParcels, 12000);

        return () => {
            active = false;
            clearInterval(timer);
        };
    }, [token, isOnline, isAvailable]);

    const refreshActiveRide = useCallback(async () => {
        const [active, status] = await Promise.all([
            apiRequest("/drivers/me/active-ride", { token }),
            apiRequest("/drivers/me/status", { token }),
        ]);
        setIsOnline(Boolean(status.driver?.isOnline));
        setIsAvailable(Boolean(status.driver?.isAvailable));
        return active.ride || null;
    }, [token]);
    useEffect(() => {
        const socket = getRealtimeSocket();
        if (!socket || !token) return;
        setSocketConnected(socket.connected);
        const onConnect = () => {
            setSocketConnected((was) => {
                if (!was) notifyRef.current({ kind: "success", title: "Back online", body: "Live updates reconnected.", key: "socket:up", sound: false });
                return true;
            });
            loadRequests();
        };
        const onDisconnect = () => {
            setSocketConnected(false);
            notifyRef.current({ kind: "offline", title: "Connection lost", body: "Reconnecting… requests will refresh automatically.", key: "socket:down", sound: false });
        };
        const onNewRide = (ride) => {
            const id = String(ride?.rideId || ride?._id || "");
            if (!id || !isOnline || !isAvailable) return;
            setRequests((previous) => {
                if (previous.some((item) => item.rideId === id)) return previous;
                return [{ ...ride, rideId: id, live: true }, ...previous];
            });
            notifyRef.current({
                kind: "ride", tone: "ride", key: `ride:new:${id}`,
                title: "New ride request",
                body: [
                    vehicleNames[ride?.vehicleType],
                    ride?.tripType === "ROUND_TRIP" ? "Round Trip ↩" : "One Way",
                    ride?.requestedPrice ? money(ride.requestedPrice) : null
                ].filter(Boolean).join(" · "),
            });
        };
        const onCancelled = async ({ rideId } = {}) => {
            const id = String(rideId || "");
            setRequests((previous) => previous.filter((r) => r.rideId !== id));
            const current = selectedRideRef.current;
            if (current && String(current._id) === id && IN_PROGRESS.includes(current.status)) {
                notifyRef.current({ kind: "error", tone: "warning", key: `ride:cancel:${id}`, title: "Ride cancelled", body: "The passenger cancelled this trip." });
                try {
                    const fresh = await refreshActiveRide();
                    setSelectedRide(fresh || { ...current, status: "CANCELLED" });
                } catch {
                    setSelectedRide({ ...current, status: "CANCELLED" });
                }
            } else if (id) {
                notifyRef.current({ kind: "info", key: `ride:cancel:${id}`, title: "A nearby request was cancelled", sound: false });
            }
        };
        const onSelected = async ({ rideId } = {}) => {
            setRequests((previous) => previous.filter((r) => r.rideId !== rideId));
            try {
                const data = await apiRequest("/drivers/me/active-ride", { token });
                setSelectedRide(data.ride);
                setIsAvailable(false);
                setTab("requests");
                notifyRef.current({ kind: "success", tone: "success", key: `ride:selected:${rideId}`, title: "Passenger accepted your offer!", body: "Head to the pickup point." });
            } catch (error) {
                reportError(error);
            }
        };
        const onParcelAssigned = (data) => {
            if (!data?.parcelId) return;
            setParcelAssignment(data);
            notifyRef.current({
                kind: "success",
                tone: "success",
                key: `parcel:assigned:${data?.parcelId}`,
                title: "📦 Parcel assigned to you!",
                body: data?.message || "Passenger accepted your offer.",
            });
        };

        const onChat = (payload) => {
            const current = selectedRideRef.current;
            const msg = payload?.message;
            if (!current || !msg?._id || String(payload.rideId) !== String(current._id)) return;
            if (String(msg.senderId) === String(user?._id || user?.id)) return;
            notifyRef.current({ kind: "chat", tone: "chat", key: `chat:${msg._id}`, title: "New message from passenger", body: String(msg.body || "").slice(0, 80) });
        };
        socket.on("connect", onConnect);
        socket.on("disconnect", onDisconnect);
        socket.on("ride:created", onNewRide);
        socket.on("ride:cancelled", onCancelled);
        socket.on("ride:driver:selected", onSelected);
        socket.on("ride:chat:new", onChat);
        socket.on("parcel:assigned", onParcelAssigned);
        return () => {
            socket.off("connect", onConnect);
            socket.off("disconnect", onDisconnect);
            socket.off("ride:created", onNewRide);
            socket.off("ride:cancelled", onCancelled);
            socket.off("ride:driver:selected", onSelected);
            socket.off("ride:chat:new", onChat);
            socket.off("parcel:assigned", onParcelAssigned);
        };
    }, [token, loadRequests, isOnline, isAvailable, refreshActiveRide, reportError, user?._id, user?.id]);
    // GPS tracking: map shows any fix; backend only receives fixes within 100 m accuracy.
    useEffect(() => {
        if (!isOnline || !token) return;
        let stopped = false;
        let watchId;
        let sending = false;
        async function track() {
            try {
                watchId = await Geolocation.watchPosition(
                    { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 },
                    async (position, error) => {
                        if (stopped || !position || error || sending) return;
                        const { latitude, longitude, accuracy } = position.coords;
                        if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return;
                        const point = { latitude, longitude };
                        setLocation(point);
                        if (!Number.isFinite(accuracy) || accuracy > 100) {
                            setGps({ accuracy: Number.isFinite(accuracy) ? Math.round(accuracy) : null, text: "Approximate location — waiting for accurate GPS" });
                            return;
                        }
                        setGps({ accuracy: Math.round(accuracy), text: `GPS ±${Math.round(accuracy)} m` });
                        const now = Date.now();
                        const last = lastGps.current;
                        if (now - last.time < 10000) return;
                        if (last.point) {
                            const moved = Math.hypot(
                                (latitude - last.point.latitude) * 111000,
                                (longitude - last.point.longitude) * 111000 * Math.cos(latitude * Math.PI / 180)
                            );
                            if (moved < 20 && now - last.time < 30000) return;
                        }
                        sending = true;
                        try {
                            await updateDriverLocation(latitude, longitude, token);
                            lastGps.current = { time: Date.now(), point };
                            loadRequests();
                        } catch (err) {
                            setGps((g) => ({ ...g, text: err.message }));
                        } finally {
                            sending = false;
                        }
                    }
                );
                if (stopped && watchId != null) await Geolocation.clearWatch({ id: watchId });
            } catch (error) {
                if (!stopped) setGps({ accuracy: null, text: error.message });
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
        (async () => {
            try {
                const position = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 15000 });
                if (cancelled) return;
                setLocation({ latitude: position.coords.latitude, longitude: position.coords.longitude });
                setGps({ accuracy: Math.round(position.coords.accuracy), text: `GPS ±${Math.round(position.coords.accuracy)} m` });
            } catch (error) {
                if (!cancelled) setGps({ accuracy: null, text: error.message || "Location permission required" });
            }
        })();
        return () => { cancelled = true; };
    }, []);
    async function locateMe() {
        setLocating(true);
        try {
            const pos = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 15000 });
            setLocation({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
            setLocateRequest((value) => value + 1);
            setGps({ accuracy: Math.round(pos.coords.accuracy), text: `GPS ±${Math.round(pos.coords.accuracy)} m` });
        } catch (error) {
            reportError(error, "Location unavailable");
        } finally {
            setLocating(false);
        }
    }
    async function toggleOnline() {
        if (busy) return;
        setBusy(true);
        try {
            const goingOnline = !isOnline;
            let point = null;
            if (goingOnline) {
                const position = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
                const { latitude, longitude, accuracy } = position.coords;
                if (!Number.isFinite(accuracy) || accuracy > 100 || !Number.isFinite(latitude) || !Number.isFinite(longitude) ||
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
            notify({
                kind: data.isOnline ? "success" : "info", key: `online:${data.isOnline}:${Date.now()}`, sound: false,
                title: data.isOnline ? "You're online" : "You're offline",
                body: data.isOnline ? "Location synced. Requests will appear automatically." : "You won't receive new requests."
            });
            if (data.isOnline) {
                const available = await apiRequest("/drivers/me/available-rides", { token });
                setRequests((available.rides || []).map((ride) => ({ ...ride, rideId: String(ride._id) })));
            } else {
                setRequests([]);
            }
        } catch (error) {
            reportError(error, "Couldn't change status");
        } finally {
            setBusy(false);
        }
    }
    async function saveVehicle() {
        if (!selectedVehicle || isOnline || busy) return;
        setBusy(true);
        try {
            await selectVehicle(selectedVehicle, token);
            setSavedVehicle(selectedVehicle);
            notify({ kind: "success", title: "Active vehicle updated", key: `veh:${selectedVehicle}:${Date.now()}`, sound: false });
        } catch (error) {
            reportError(error, "Couldn't update vehicle");
        } finally {
            setBusy(false);
        }
    }
    async function refreshNow() {
        setRefreshing(true);
        await loadRequests();
        setRefreshing(false);
    }
    async function sendOffer(ride) {
        const price = Number(offerPrices[ride.rideId] ?? ride.requestedPrice);
        if (!Number.isSafeInteger(price) || price <= 0 || price > 1000000 || offerBusy) {
            notify({ kind: "error", title: "Please enter a valid fare", key: `fare:${ride.rideId}:${price}` });
            return;
        }
        if (clock < (nextBidAt[ride.rideId] || 0)) {
            notify({ kind: "info", title: "Please wait for the rebid cooldown", key: `cool:${ride.rideId}`, sound: false });
            return;
        }
        const wasSubmitted = submittedIds.includes(ride.rideId);
        setOfferBusy(ride.rideId);
        try {
            await submitDriverOffer(ride.rideId, price, token);
            setSubmittedIds((previous) => [...new Set([...previous, ride.rideId])]);
            setNextBidAt((previous) => ({ ...previous, [ride.rideId]: Date.now() + 15000 }));
            notify({
                kind: "success", sound: false, key: `offer:${ride.rideId}:${price}:${Date.now()}`,
                title: wasSubmitted ? "Offer updated" : "Offer sent", body: `${money(price)} · waiting for passenger`
            });
        } catch (error) {
            reportError(error, "Offer not sent");
        } finally {
            setOfferBusy(null);
        }
    }
    async function updateStop(action) {
        if (!selectedRide?._id || busy) return;
        setBusy(true);
        try {
            const data = await apiRequest(`/rides/${selectedRide._id}/stops`, { method: "PATCH", token, body: JSON.stringify({ action }) });
            setSelectedRide(data.ride);
            notify({
                kind: "success", sound: false, key: `stop:${action}:${data.ride?.stopsCompleted}`,
                title: action === "ARRIVE" ? "Stop arrival recorded" : "Stop completed",
                body: action === "ARRIVE" ? "Waiting timer started." : "Navigating to the next location."
            });
        } catch (error) {
            reportError(error, "Stop update failed");
        } finally {
            setBusy(false);
        }
    }
    async function advanceTrip() {
        const action = ACTIONS[selectedRide?.status];
        if (!action || busy || !selectedRide?._id) return;

        if (
            action[0] === "TRIP_COMPLETED" &&
            selectedRide.tripType === "ROUND_TRIP" &&
            !window.confirm(
                "Have you returned the passenger to the original pickup location?"
            )
        ) return;

        setBusy(true);
        try {
            const data = await apiRequest(`/rides/${selectedRide._id}/status`, { method: "PATCH", token, body: JSON.stringify({ status: action[0] }) });
            setSelectedRide(data.ride);
            const s = data.ride.status;
            notify({
                kind: "success", sound: s === "TRIP_COMPLETED", tone: "success", key: `status:${data.ride._id}:${s}`,
                title: STATUS_LABEL[s] || s.replaceAll("_", " "),
                body: s === "DRIVER_ARRIVED" ? "Passenger has been notified." : s === "TRIP_STARTED" ? "Navigating to the next destination." : ""
            });
            if (s === "TRIP_COMPLETED") setIsAvailable(isOnline);
        } catch (error) {
            reportError(error, "Status update failed");
        } finally {
            setBusy(false);
        }
    }
    function finishRide() {
        setSelectedRide(null);
        setNavigationInfo(null);
        setSheet("half");
        loadRequests();
    }
    const activeVehicle = vehicles.find((v) => v._id === selectedVehicle);
    const completeBlocked = selectedRide?.status === "TRIP_STARTED" && (pendingStop || Boolean(selectedRide?.stopWaitingSince));
    const userId = user?._id || user?.id;
    const firstName = user?.firstName || "Driver";
    const turnDistance = formatMeters(navigationInfo?.stepDistanceMeters);
    const etaClock = navigationInfo?.durationMinutes
        ? new Date(clock + navigationInfo.durationMinutes * 60000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
        : null;
    /* ---------- Sheet content builders ---------- */
    const statusPill = (
        <span className="dx-status" data-on={isOnline}>
            <span className="dx-status-dot" />
            {isOnline ? (isAvailable ? "Online" : "On trip") : "Offline"}
        </span>
    );
    const idlePeek = (
        <div className="dx-duty">
            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                    {statusPill}
                    {isOnline && <span className="dx-gps" data-ok={gps.accuracy != null && gps.accuracy <= 100}><Satellite size={12} /> {gps.accuracy != null ? `±${gps.accuracy} m` : "GPS…"}</span>}
                </div>
                <p className="dx-duty-title">
                    {loading ? "Loading…" : isOnline
                        ? (requests.length ? `${requests.length} request${requests.length > 1 ? "s" : ""} nearby` : "Looking for rides…")
                        : activeVehicle ? `Hi ${firstName}, ready to drive?` : "Select an approved vehicle"}
                </p>
                <p className="dx-duty-sub">
                    {activeVehicle ? `${vehicleNames[activeVehicle.vehicleType] || activeVehicle.vehicleType} · ${activeVehicle.registrationNumber}` : "Vehicle required to go online"}
                </p>
            </div>
            <button type="button" className="dx-power" data-on={isOnline} onClick={toggleOnline}
                disabled={loading || busy || (!isOnline && !activeVehicle)}
                aria-label={isOnline ? "Go offline" : "Go online"}>
                <Power size={20} />
                <span>{busy ? "Wait" : isOnline ? "Go offline" : "Go online"}</span>
            </button>
        </div>
    );
    const requestsView = (
        <div className="space-y-3">
            {parcelRequests.length > 0 && (
                <div className="space-y-2">
                    <h2 className="dx-h2">
                        📦 Parcel requests ({parcelRequests.length})
                    </h2>
                    {parcelRequests.map((parcel) => (
                        <Link
                            key={parcel._id}
                            href="/driver/parcels"
                            className="block rounded-2xl border border-[#E9EBEE] bg-white p-4"
                        >
                            <p className="font-bold">
                                {parcel.serviceType?.replaceAll("_", " ")}
                            </p>
                            <p className="text-sm text-gray-500">
                                {parcel.parcel?.category} · {parcel.parcel?.weightKg} kg
                            </p>
                            <p className="mt-2 font-extrabold">
                                PKR {parcel.requestedPrice}
                            </p>
                            <span className="text-xs font-bold underline">
                                View & Send Offer →
                            </span>
                        </Link>
                    ))}
                </div>
            )}

            <div className="flex items-center justify-between">
                <div className="flex min-w-0 items-center gap-2">
                    <h2 className="dx-h2">
                        Ride requests
                        {requests.length > 0 && <span className="dx-count">{requests.length}</span>}
                    </h2>
                </div>
                <button type="button" className="dx-btn-ghost" onClick={refreshNow} disabled={!isOnline || refreshing} aria-label="Refresh requests">
                    <RefreshCw size={15} className={refreshing ? "dx-spin" : ""} /> Refresh
                </button>
            </div>
            {!socketConnected && isOnline && (
                <p className="dx-inline-warn"><WifiOff size={14} /> Live updates paused — checking every 12 s.</p>
            )}
            {loading ? (
                <div className="space-y-3" aria-busy="true">{[0, 1].map((i) => <div key={i} className="dx-skeleton" />)}</div>
            ) : requests.length === 0 ? (
                <div className="dx-empty">
                    <span className="dx-empty-icon" data-on={isOnline}>{isOnline ? <Compass size={26} /> : <Power size={24} />}</span>
                    <p className="font-extrabold">{isOnline ? (isAvailable ? "No nearby requests yet" : "Finish your current trip") : "You're offline"}</p>
                    <p className="dx-muted">{isOnline ? "New requests appear here automatically." : "Go online to start receiving rides."}</p>
                </div>
            ) : (
                namedRequests.map((ride) => {
                    const left = Math.max(0, Math.ceil(((nextBidAt[ride.rideId] || 0) - clock) / 1000));
                    return (
                        <DriverRequestCard key={ride.rideId} ride={ride}
                            price={offerPrices[ride.rideId]}
                            onPriceChange={(value) => setOfferPrices((p) => ({ ...p, [ride.rideId]: value }))}
                            onSend={() => sendOffer(ride)}
                            busy={offerBusy === ride.rideId}
                            disabled={Boolean(offerBusy)}
                            submitted={submittedIds.includes(ride.rideId)}
                            cooldownSeconds={left} />
                    );
                })
            )}
        </div>
    );
    const vehicleView = (
        <div className="space-y-3">
            <h2 className="dx-h2">Active vehicle</h2>
            {vehicles.length === 0 ? (
                <div className="dx-empty">
                    <span className="dx-empty-icon"><CarFront size={24} /></span>
                    <p className="font-extrabold">No approved vehicles</p>
                    <p className="dx-muted">Register a vehicle and upload documents for approval.</p>
                </div>
            ) : (
                <div className="space-y-2" role="radiogroup" aria-label="Approved vehicles">
                    {vehicles.map((v) => (
                        <button key={v._id} type="button" role="radio" aria-checked={selectedVehicle === v._id}
                            disabled={isOnline} onClick={() => setSelectedVehicle(v._id)} className="dx-vehicle" data-active={selectedVehicle === v._id}>
                            <span className="dx-vehicle-icon"><CarFront size={18} /></span>
                            <span className="min-w-0 flex-1 text-left">
                                <strong>{vehicleNames[v.vehicleType] || v.vehicleType}</strong>
                                <small>{v.registrationNumber}{savedVehicle === v._id ? " · current" : ""}</small>
                            </span>
                            <span className="dx-radio" />
                        </button>
                    ))}
                </div>
            )}
            {isOnline && <p className="dx-inline-warn">Go offline to change your active vehicle.</p>}
            <button type="button" className="dx-btn dx-btn-lime w-full" onClick={saveVehicle}
                disabled={isOnline || busy || !selectedVehicle || selectedVehicle === savedVehicle}>
                {selectedVehicle && selectedVehicle === savedVehicle ? "Active vehicle set" : "Set active vehicle"}
            </button>
            <div className="grid grid-cols-2 gap-2">
                <Link href="/driver/vehicles" className="dx-link-card"><CarFront size={17} /> Vehicles <ChevronRight size={15} /></Link>
                <Link href="/driver/documents" className="dx-link-card"><FileCheck2 size={17} /> Documents <ChevronRight size={15} /></Link>
            </div>
        </div>
    );
    const idleBody = (
        <>
            <div className="dx-tabs" role="tablist">
                <button type="button" role="tab" aria-selected={tab === "requests"} onClick={() => setTab("requests")}>Requests</button>
                <button type="button" role="tab" aria-selected={tab === "vehicle"} onClick={() => setTab("vehicle")}>My vehicle</button>
            </div>
            {tab === "vehicle" ? vehicleView : requestsView}
        </>
    );
    const primaryAction = selectedRide && ACTIONS[selectedRide.status] && (
        pendingStop ? (
            <button type="button" className="dx-btn dx-btn-lime dx-btn-xl" disabled={busy}
                onClick={() => updateStop(selectedRide.stopWaitingSince ? "CONTINUE" : "ARRIVE")}>
                {busy
                    ? "Please wait…"
                    : selectedRide.stopWaitingSince
                        ? "Continue trip"
                        : selectedRide.tripType === "ROUND_TRIP" && stopsDone === stopsTotal - 1
                            ? "Arrived at outbound destination"
                            : `Arrived at stop ${stopsDone + 1}`}
                <ArrowRight size={18} />
            </button>
        ) : (
            <button type="button" className={`dx-btn dx-btn-xl ${selectedRide.status === "TRIP_STARTED" ? "dx-btn-ink" : "dx-btn-lime"}`}
                onClick={advanceTrip} disabled={busy || completeBlocked}>
                {busy
                    ? "Please wait…"
                    : selectedRide.status === "TRIP_STARTED" &&
                        selectedRide.tripType === "ROUND_TRIP"
                        ? "Complete Round Trip"
                        : ACTIONS[selectedRide.status][1]}
                <ArrowRight size={18} />
            </button>
        )
    );
    const tripPeek = rideInProgress && (
        <div className="flex items-center gap-3 px-1 py-1">
            <span className="h-3 w-3 shrink-0 rounded-full bg-[#C1F11D] ring-4 ring-[#C1F11D]/20" />
            <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-extrabold">{STATUS_LABEL[selectedRide.status]}</p>
                <p className="truncate text-xs text-[#6B7280]">
                    {navigationInfo ? `${navigationInfo.distanceKm} km · approx. ${navigationInfo.durationMinutes} min · ${targetTitle}` : targetTitle}
                </p>
            </div>
            <button type="button" onClick={() => setSheet("half")}
                className="shrink-0 rounded-xl bg-[#C1F11D] px-3 py-2 text-xs font-extrabold text-[#111111]">
                Details
            </button>
        </div>
    );
    const tripBody = rideInProgress && (
        <div className="space-y-3">
            {primaryAction}
            <div className="dx-stages" aria-label="Trip progress">
                {STAGES.map((stage, i) => (
                    <div key={stage} data-done={i <= stageIndex} data-current={i === stageIndex}>
                        <span /><small>{stage}</small>
                    </div>
                ))}
            </div>
            {selectedRide.status === "DRIVER_SELECTED" && (
                <div className="dx-banner dx-banner-lime">
                    <CheckCircle2 size={18} />
                    <p><strong>Assignment confirmed</strong><small>Route shown from your GPS position to the pickup. Tap “Head to pickup” to start.</small></p>
                </div>
            )}
            {selectedRide.status === "DRIVER_ARRIVED" && (
                <div className="dx-banner dx-banner-amber">
                    <Hourglass size={18} />
                    <p>
                        <strong>Waiting for passenger</strong>
                        <small>
                            {waitingSince
                                ? `Waiting time: ${waitingTime}`
                                : "Waiting timer unavailable"}
                        </small>
                    </p>
                </div>
            )}
            {selectedRide.stopWaitingSince && (
                <div className="dx-banner dx-banner-amber">
                    <Hourglass size={18} />
                    <p><strong>Waiting at stop {stopsDone + 1}</strong><small>Since {new Date(selectedRide.stopWaitingSince).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</small></p>
                </div>
            )}
            <ol className="dx-route dx-route-card">
                <li data-done={selectedRide.status === "TRIP_STARTED"}><span className="dx-dot dx-dot-pickup"><Navigation size={11} /></span><p><small>Pickup</small>{placeText(labelPoint(selectedRide.pickup))}</p></li>
                {selectedRide.stops?.map((stop, i) => (
                    <li key={i} data-done={i < stopsDone} data-next={selectedRide.status === "TRIP_STARTED" && i === stopsDone}>
                        <span className="dx-dot dx-dot-stop">{i + 1}</span><p><small>
                            {selectedRide.tripType === "ROUND_TRIP" && i === selectedRide.stops.length - 1
                                ? "Outbound Destination"
                                : `Stop ${i + 1}`}
                            {i < stopsDone ? " · done" : ""}
                        </small>{placeText(labelPoint(stop))}</p>
                    </li>
                ))}
                <li><span className="dx-dot dx-dot-drop"><Flag size={11} /></span><p><small>
                    {selectedRide.tripType === "ROUND_TRIP" ? "Return to Pickup" : "Destination"}
                </small>
                    {placeText(labelPoint(selectedRide.destination))}</p></li>
            </ol>
            {completeBlocked && !pendingStop && <p className="dx-inline-warn">Continue from the current stop before completing.</p>}
            <button type="button" className="dx-btn dx-btn-ink" onClick={() => { markMessagesRead(); setChatOpen(true); }}>
                <MessageCircle size={18} /> Message passenger{unreadMessages > 0 && <span className="rounded-full bg-[#C1F11D] px-2 py-0.5 text-xs font-extrabold text-[#111111]">{unreadMessages === 99 ? "99+" : unreadMessages}</span>}
            </button>
        </div>
    );
    const endedView = rideEnded && (
        <div className="dx-ended" data-status={selectedRide.status}>
            <span className="dx-ended-icon">{selectedRide.status === "TRIP_COMPLETED" ? <CheckCircle2 size={34} /> : <XCircle size={34} />}</span>
            <h2>{STATUS_LABEL[selectedRide.status]}</h2>
            {selectedRide.status === "TRIP_COMPLETED" ? (
                <>
                    <p className="dx-muted">Great job, {firstName}. Fare confirmed by the system.</p>
                    <p className="dx-ended-fare">{money(selectedRide.finalPrice)}</p>
                    <Link href="/driver/earnings" className="dx-btn-ghost mx-auto">View earnings <ChevronRight size={15} /></Link>
                </>
            ) : (
                <p className="dx-muted">This trip is no longer active. No action is needed.</p>
            )}
            <button type="button" className="dx-btn dx-btn-lime dx-btn-xl" onClick={finishRide}>Back to ride requests <ArrowRight size={18} /></button>
        </div>
    );
    return (
        <main className="driver-live-home dx-home" data-ride={rideInProgress ? "active" : "idle"}>
            <div className="absolute inset-0">
                <ParcelActivityBar token={token} role="DRIVER" />
                {parcelAssignment?.parcelId && (
                    <Link
                        href={`/driver/parcels/details?parcelId=${parcelAssignment.parcelId}`}
                        className="fixed left-4 right-4 top-20 z-50 mx-auto max-w-md rounded-2xl bg-[#C1F11D] p-4 font-bold text-[#111111] shadow-xl"
                    >
                        📦 Parcel Assigned! Tap to manage delivery →
                    </Link>
                )}
                <RideMap
                    userLocation={location}
                    locateRequest={locateRequest}
                    destination={nextTarget}
                    navigationMode={rideInProgress}
                    driverLocation={location}
                    followDriver={navigating}
                    onRouteUpdate={setNavigationInfo}
                    sheetRatio={sheetRatio}
                    rideRequestPoints={isOnline && isAvailable && !rideInProgress ? requests.map((ride) => ({ id: ride.rideId, point: ride.pickup })) : []}
                    showNavigationControl={false}
                    stops={[]}
                />
            </div>
            {/* Minimal passenger-style map controls: menu at top-left, GPS bottom-right. */}
            {rideInProgress && navigating && navigationInfo?.nextStep && (
                <div className="pointer-events-none absolute left-[76px] right-4 top-[calc(max(16px,env(safe-area-inset-top)))] z-20 rounded-xl bg-[#111111]/90 px-3 py-2 text-white shadow-md">
                    <p className="truncate text-xs font-semibold">{turnDistance ? `${turnDistance} · ` : ""}{navigationInfo.nextStep}</p>
                </div>
            )}
            <div className="absolute left-4 top-[calc(max(16px,env(safe-area-inset-top)))] z-50">
                <button type="button" aria-label="Open driver menu" aria-expanded={mapMenuOpen}
                    onClick={() => { setMapMenuOpen((open) => !open); notifications.markRead(); }}
                    className="relative flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-[#111111] shadow-[0_6px_24px_rgba(17,17,17,0.12)]">
                    {mapMenuOpen ? <X size={23} /> : <Menu size={23} />}
                    {!mapMenuOpen && notifications.unread > 0 && <span className="absolute -right-1 -top-1 h-3 w-3 rounded-full bg-[#C1F11D] ring-2 ring-white" />}
                </button>
            </div>
            {mapMenuOpen && (
                <>
                    <button type="button" aria-label="Close driver menu" onClick={() => setMapMenuOpen(false)}
                        className="absolute inset-0 z-40 bg-black/20" />
                    <nav aria-label="Driver menu" className="absolute left-4 top-[calc(max(16px,env(safe-area-inset-top))+60px)] z-50 w-72 max-w-[calc(100vw-32px)] rounded-2xl bg-white p-2 text-[#111111] shadow-xl">
                        <Link href="/driver/account" onClick={() => setMapMenuOpen(false)} className="flex min-h-12 items-center gap-3 rounded-xl px-3 text-sm font-semibold hover:bg-[#F4F5F7]">
                            <UserRound size={19} /> My account
                        </Link>
                        <ParcelShortcut />
                        <button type="button" onClick={notifications.toggleSound} className="flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-semibold hover:bg-[#F4F5F7]">
                            {notifications.soundEnabled ? <Volume2 size={19} /> : <VolumeX size={19} />}
                            {notifications.soundEnabled ? "Mute ride alerts" : "Enable ride alert sounds"}
                        </button>
                        <div className="border-t border-[#E9EBEE] px-3 py-2">
                            <div className="flex items-center justify-between gap-2">
                                <span className="flex items-center gap-2 text-sm font-semibold"><Bell size={19} /> Notifications</span>
                                {notifications.items.length > 0 && <button type="button" onClick={notifications.clear} className="text-xs font-semibold text-[#6B7280]">Clear</button>}
                            </div>
                            <div className="mt-2 max-h-60 space-y-1 overflow-y-auto">
                                {notifications.items.length === 0 ? <p className="py-2 text-xs text-[#6B7280]">No notifications yet</p> : notifications.items.map((item) => (
                                    <div key={item.id} className="rounded-xl bg-[#F4F5F7] p-2.5">
                                        <p className="text-xs font-bold">{item.title}</p>
                                        {item.body && <p className="mt-0.5 text-xs text-[#6B7280]">{item.body}</p>}
                                    </div>
                                ))}
                            </div>
                        </div>
                    </nav>
                </>
            )}
            <button type="button" onClick={locateMe} disabled={locating} aria-label="Centre on my location"
                style={{ bottom: `calc(${heights[sheet]} + ${rideInProgress ? "18px" : "78px"})` }}
                className="absolute right-4 z-30 flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-[#111111] shadow-[0_6px_24px_rgba(17,17,17,0.12)] disabled:opacity-60">
                <LocateFixed size={21} className={locating ? "animate-pulse" : ""} />
            </button>
            <DriverToast toast={notifications.toast} onDismiss={notifications.dismissToast} />
            {rideInProgress && chatOpen && (
                <RideChat rideId={selectedRide._id} token={token} userId={userId}
                    directOpen onClose={() => setChatOpen(false)} participantLabel="passenger" />
            )}
            {rideInProgress && (
                <div className="dx-quick" style={{ bottom: `calc(${heights[sheet]} + 12px)` }}>
                    <button type="button" className="dx-fab relative" aria-label="Open chat with passenger"
                        onClick={() => { markMessagesRead(); setChatOpen(true); }}>
                        <MessageCircle size={18} />
                        {unreadMessages > 0 && <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-[#C1F11D] px-1 text-[11px] font-extrabold text-[#111111] ring-2 ring-white">{unreadMessages === 99 ? "99+" : unreadMessages}</span>}
                    </button>
                    <span className="dx-target-chip"><MapPin size={13} /> {targetTitle}</span>
                </div>
            )}
            <DriverSheet
                label={rideInProgress ? "Trip controls" : "Driver dashboard"}
                state={sheet}
                onStateChange={setSheet}
                heights={heights}
                bottomOffset={rideInProgress ? "0px" : "calc(68px + env(safe-area-inset-bottom))"}
                peek={rideEnded ? null : rideInProgress ? tripPeek : idlePeek}
            >
                {rideEnded ? endedView : rideInProgress ? tripBody : idleBody}
            </DriverSheet>
            {!rideInProgress && <MobileBottomNav role="DRIVER" />}
        </main>
    );
}
