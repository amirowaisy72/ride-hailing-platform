"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    ArrowRight, CheckCircle2, ChevronRight, Compass, CornerUpRight, Flag, LifeBuoy, MapPin, MessageCircle, Navigation, Power, RefreshCw, Satellite, UserRound,
    WifiOff, XCircle, Menu, X, Bell, BellRing, Volume2, VolumeX, LocateFixed, Wallet,
    LayoutGrid, Store,
} from "lucide-react";
import { Geolocation } from "@capacitor/geolocation";
import {
    startDriverBackgroundGPS,
    stopDriverBackgroundGPS
} from "@/lib/backgroundDriverLocation";
import AuthGuard from "@/components/AuthGuard";
import DriverMap from "@/components/driver/map/DriverMap";
import NavigationBanner from "@/components/driver/map/NavigationBanner";
import { reverseGeocode } from "@/lib/locationService";
import RideChat from "@/components/RideChat";
import ParcelActivityBar from "@/components/ParcelActivityBar";
import { Package } from "lucide-react";
import Link from "next/link";
import MobileBottomNav from "@/components/MobileBottomNav";
import { useLanguage } from "@/components/i18n/LanguageProvider";
import DriverSheet from "@/components/driver/DriverSheet";
import { money, placeText, vehicleNames } from "@/components/driver/DriverRequestCard";
import RideRequestCard, { RideQueueRow, passengerNameOf } from "@/components/driver/ride/RideRequestCard";
import TripStepPanel, { RideEndedPanel, TRIP_PANEL_HEIGHT } from "@/components/driver/ride/TripStepPanel";
import RideReturnBanner from "@/components/driver/ride/RideReturnBanner";
import GuidedHomeCard from "@/components/driver/home/GuidedHomeCard";
import { DriverToast } from "@/components/driver/DriverMapControls";
import useDriverNotifications from "@/components/driver/useDriverNotifications";
import { useAuth } from "@/context/AuthContext";
import { BRAND } from "@/config/brand";
import { apiRequest } from "@/lib/api";
import { submitDriverOffer } from "@/lib/driverRideService";
import { getMyVehicles, selectVehicle, updateOnlineStatus, updateDriverLocation } from "@/lib/vehicleService";
import { getMyServices } from "@/lib/driverServicesService";
import { SERVICE_META, STATUS_META, humanizeReason } from "@/components/driver/ServiceMeta";
import { getRealtimeSocket } from "@/lib/socket";
import { useRideUnreadMessages } from "@/hooks/useRideUnreadMessages";
// Allowed driver-side transitions (unchanged backend contract).

const PARCEL_LINK = "/driver/parcels";

function ParcelShortcut() {
    return (
        <Link
            href={PARCEL_LINK}
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-[#087F5B] px-3 text-sm font-extrabold text-white"
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

function haversineMeters(from, to) {
    const earth = 6371000;
    const dLat = (to.latitude - from.latitude) * Math.PI / 180;
    const dLng = (to.longitude - from.longitude) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2
        + Math.cos(from.latitude * Math.PI / 180) * Math.cos(to.latitude * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
    return 2 * earth * Math.asin(Math.sqrt(a));
}

// Seconds a live request holds the full-screen takeover before the
// driver is returned to the list (the request itself stays listed).
const REQUEST_FOCUS_SECONDS = 45;

function DriverDashboard() {
    const { user, token } = useAuth();
    const { t } = useLanguage();
    const notifications = useDriverNotifications();
    const { notify } = notifications;
    const notifyRef = useRef(notify);
    notifyRef.current = notify;
    const [tab, setTab] = useState("requests");
    const [requestType, setRequestType] = useState("rides");
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
    const [focusRideId, setFocusRideId] = useState(null);
    const [focusDeadline, setFocusDeadline] = useState(0);
    // declined: the driver said no. seen: the card was shown and left
    // unanswered; those rides stay reachable from the banner and the list.
    const [declinedIds, setDeclinedIds] = useState([]);
    const [seenIds, setSeenIds] = useState([]);
    const [driverProfile, setDriverProfile] = useState(null);
    const [homeEarnings, setHomeEarnings] = useState(null);
    const [myServices, setMyServices] = useState(null);
    const [pendingVehicles, setPendingVehicles] = useState([]);
    const [guidedHeight, setGuidedHeight] = useState(260);
    const [onlineBlock, setOnlineBlock] = useState(null);
    const loadMyServices = useCallback(async () => {
        if (!token) return null;
        try {
            const data = await getMyServices(token);
            const list = data.services || [];
            setMyServices(list);
            return list;
        } catch {
            return null;
        }
    }, [token]);
    const [myComplaints, setMyComplaints] = useState([]);
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
    const guidedActive = !rideInProgress && !rideEnded && !isOnline;
    const sheetRatio = rideInProgress ? Math.min(0.62, TRIP_PANEL_HEIGHT / Math.max(1, viewportH))
        : guidedActive ? Math.min(0.7, (guidedHeight + navH + 12) / Math.max(1, viewportH))
            : Math.min(0.75, (sheetPx + navH) / Math.max(1, viewportH));
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
                setDriverProfile(driver || null);
                setIsOnline(Boolean(driver?.isOnline));
                setIsAvailable(Boolean(driver?.isAvailable));
                setSelectedVehicle(driver?.currentVehicleId || "");
                setSavedVehicle(driver?.currentVehicleId || "");
                setVehicles((vehicleData.vehicles || []).filter((v) => v.verificationStatus === "APPROVED" && v.isActive));
                setPendingVehicles((vehicleData.vehicles || []).filter((v) => v.verificationStatus === "PENDING" && v.isActive));
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
    // Full-screen takeover: the newest live (socket-arrived) request that
    // the driver has not answered or dismissed takes focus once. When one
    // is answered, closed by the passenger, or its countdown ends, focus
    // clears and the next waiting live request takes over.
    useEffect(() => {
        if (selectedRide) {
            if (focusRideId) setFocusRideId(null);
            return;
        }
        if (focusRideId) {
            const stillOpen = requests.some((r) => r.rideId === focusRideId);
            if (!stillOpen || submittedIds.includes(focusRideId)) setFocusRideId(null);
            return;
        }
        // Any waiting request the driver has not answered or seen takes
        // focus, including ones loaded after reopening the app.
        const next = requests.find((r) => !submittedIds.includes(r.rideId) && !declinedIds.includes(r.rideId) && !seenIds.includes(r.rideId));
        if (next) {
            setFocusRideId(next.rideId);
            setFocusDeadline(Date.now() + REQUEST_FOCUS_SECONDS * 1000);
        }
    }, [requests, selectedRide, focusRideId, submittedIds, declinedIds, seenIds]);
    useEffect(() => {
        if (focusRideId && focusDeadline && clock >= focusDeadline) {
            setSeenIds((previous) => [...new Set([...previous, focusRideId])]);
            setFocusRideId(null);
        }
    }, [clock, focusRideId, focusDeadline]);
    function openRequest(rideId) {
        setSeenIds((previous) => previous.filter((id) => id !== rideId));
        setDeclinedIds((previous) => previous.filter((id) => id !== rideId));
        setFocusRideId(rideId);
        setFocusDeadline(Date.now() + REQUEST_FOCUS_SECONDS * 1000);
    }
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
        setDriverProfile(status.driver || null);
        return active.ride || null;
    }, [token]);
    // Home summary data: earnings (today/week) + my complaint statuses.
    // Best-effort: failures simply leave the cards hidden/zeroed.
    useEffect(() => {
        if (!token) return;
        let cancelled = false;
        Promise.allSettled([
            apiRequest("/drivers/me/earnings", { token }),
            apiRequest("/complaints/mine", { token }),
            getMyServices(token),
        ]).then(([earningsResult, complaintsResult, servicesResult]) => {
            if (cancelled) return;
            if (earningsResult.status === "fulfilled") setHomeEarnings(earningsResult.value);
            if (complaintsResult.status === "fulfilled") setMyComplaints(complaintsResult.value.complaints || []);
            if (servicesResult.status === "fulfilled") setMyServices(servicesResult.value.services || []);
        });
        return () => { cancelled = true; };
    }, [token, selectedRide?.status]);
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
        const onRideClosed = ({ rideId } = {}) => {
            const id = String(rideId || "");
            if (!id) return;

            setRequests((previous) =>
                previous.filter(
                    (ride) => String(ride.rideId) !== id
                )
            );

            notifyRef.current({
                kind: "info",
                key: `ride:closed:${id}`,
                title: "Ride no longer available",
                body: "Passenger selected another driver.",
                sound: false,
            });
        };

        const onOfferRejected = ({ rideId, offerId } = {}) => {
            if (!rideId || !offerId) return;

            notifyRef.current({
                kind: "info",
                tone: "warning",
                key: `offer:rejected:${offerId}`,
                title: "Your offer was declined",
                body: "You can submit a new lower fare while the ride is available. A 15-second cooldown applies.",
            });
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
        socket.on("ride:request:closed", onRideClosed);
        socket.on("ride:offer:rejected", onOfferRejected);
        socket.on("ride:chat:new", onChat);
        socket.on("parcel:assigned", onParcelAssigned);
        return () => {
            socket.off("connect", onConnect);
            socket.off("disconnect", onDisconnect);
            socket.off("ride:created", onNewRide);
            socket.off("ride:cancelled", onCancelled);
            socket.off("ride:driver:selected", onSelected);
            socket.off("ride:request:closed", onRideClosed);
            socket.off("ride:offer:rejected", onOfferRejected);
            socket.off("ride:chat:new", onChat);
            socket.off("parcel:assigned", onParcelAssigned);
        };
    }, [token, loadRequests, isOnline, isAvailable, refreshActiveRide, reportError, user?._id, user?.id]);
    // Native background GPS follows driver Online/Offline status.
    useEffect(() => {
        if (!token) return;

        const syncGPS = isOnline
            ? startDriverBackgroundGPS(token)
            : stopDriverBackgroundGPS();

        void syncGPS.catch((error) => {
            console.error("Background GPS:", error.message);
        });
    }, [isOnline, token]);

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
            setOnlineBlock(null);
            void loadMyServices();
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
            // Going online failed: surface the specific per-service
            // reasons (Phase 2 eligibility), not just the raw error.
            if (!isOnline) {
                const list = await loadMyServices();
                if (list) {
                    setOnlineBlock({
                        message: error?.message || "You can't go online yet.",
                        services: list.filter((service) => !service.eligible),
                    });
                }
            }
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
            setTab("requests");
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
            if (error.message?.includes("DRIVER_WALLET_TOP_UP_REQUIRED") ||
                error.message?.includes("Service commission ke liye wallet top-up karein")) {
                notify({
                    kind: "error",
                    sound: false,
                    title: "Wallet Top-up Required",
                    body: "Your wallet balance is used to pay the platform commission on each completed ride. Please open the Earnings / Wallet page to top up your balance.",
                    key: `wallet-topup-required:${ride.rideId}`,
                });
            } else {
                reportError(error, "Offer not sent");
            }
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
        // No extra confirm dialog: the caller is the slide-to-confirm
        // control, which already requires a deliberate gesture.
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
    const focusRide = focusRideId ? namedRequests.find((r) => r.rideId === focusRideId) || null : null;
    const focusSecondsLeft = focusRide ? Math.max(0, Math.ceil((focusDeadline - clock) / 1000)) : 0;
    const focusPickupDistance = (() => {
        if (!focusRide || !location) return null;
        const coords = Array.isArray(focusRide.pickup?.coordinates)
            ? focusRide.pickup.coordinates
            : [focusRide.pickup?.longitude, focusRide.pickup?.latitude];
        const lng = Number(coords?.[0]);
        const lat = Number(coords?.[1]);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
        return formatMeters(haversineMeters(location, { latitude: lat, longitude: lng }));
    })();
    const activeVehicle = vehicles.find((v) => v._id === selectedVehicle);
    // Guided home: the driver is always in exactly one of these steps.
    const chosenVehicle = vehicles.find((v) => v._id === savedVehicle) || null;
    const guidedStep = isOnline ? "online"
        : chosenVehicle ? "offline"
            : vehicles.length === 0 && pendingVehicles.length > 0 ? "pending"
                : "choose";
    const choosingVehicle = tab === "vehicle" && guidedStep !== "online";
    const showGuidedCard = !rideInProgress && !rideEnded && guidedStep !== "online";
    // With a single approved vehicle there is nothing to pick: preselect it.
    useEffect(() => {
        if (!selectedVehicle && vehicles.length === 1) setSelectedVehicle(vehicles[0]._id);
    }, [vehicles, selectedVehicle]);
    // While admin is checking the vehicle, quietly re-check so the driver is never stuck on stale news.
    useEffect(() => {
        if (guidedStep !== "pending" || !token) return;
        const timer = setInterval(async () => {
            if (typeof document !== "undefined" && document.hidden) return;
            try {
                const vehicleData = await getMyVehicles(token);
                setVehicles((vehicleData.vehicles || []).filter((v) => v.verificationStatus === "APPROVED" && v.isActive));
                setPendingVehicles((vehicleData.vehicles || []).filter((v) => v.verificationStatus === "PENDING" && v.isActive));
            } catch {
                // Keep showing the current step; the next check will retry.
            }
        }, 30000);
        return () => clearInterval(timer);
    }, [guidedStep, token]);
    const completeBlocked = selectedRide?.status === "TRIP_STARTED" && (pendingStop || Boolean(selectedRide?.stopWaitingSince));
    const userId = user?._id || user?.id;
    const firstName = user?.firstName || "Driver";
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
                    {loading ? t("common.loading") : isOnline
                        ? (requests.length ? (requests.length > 1 ? t("dHome.requestsNearby", { count: requests.length }) : t("dHome.requestNearby", { count: requests.length })) : t("dHome.lookingForRides"))
                        : activeVehicle ? t("dHome.hiReady", { name: firstName }) : t("dHome.selectVehicle")}
                </p>
                <p className="dx-duty-sub">
                    {activeVehicle ? `${vehicleNames[activeVehicle.vehicleType] || activeVehicle.vehicleType} · ${activeVehicle.registrationNumber}` : t("dHome.vehicleRequired")}
                </p>
            </div>
            <button type="button" className="dx-power" data-on={isOnline} onClick={toggleOnline}
                disabled={loading || busy || (!isOnline && !activeVehicle)}
                aria-label={isOnline ? t("dHome.goOffline") : t("dHome.goOnline")}>
                <Power size={20} />
                <span>{busy ? t("dHome.wait") : isOnline ? t("dHome.goOffline") : t("dHome.goOnline")}</span>
            </button>
        </div>
    );
    const requestsView = (
        <div className="space-y-3">
            {parcelRequests.length > 0 && (
                <div className="grid grid-cols-2 gap-2 rounded-xl bg-pd-surface-2 p-1">
                    <button type="button" onClick={() => setRequestType("rides")}
                        className={`rounded-lg py-2.5 text-sm font-bold ${requestType === "rides" ? "bg-pd-surface text-pd-text shadow-sm" : "text-pd-muted"}`}>
                        {t("dHome.ridesCount", { count: requests.length })}
                    </button>
                    <button type="button" onClick={() => setRequestType("parcels")}
                        className={`rounded-lg py-2.5 text-sm font-bold ${requestType === "parcels" ? "bg-pd-surface text-pd-text shadow-sm" : "text-pd-muted"}`}>
                        {t("dHome.parcelsCount", { count: parcelRequests.length })}
                    </button>
                </div>
            )}

            {requestType === "parcels" && parcelRequests.length > 0 && (
                <div className="space-y-2">
                    <h2 className="dx-h2">
                        📦 Parcel requests ({parcelRequests.length})
                    </h2>
                    {parcelRequests.map((parcel) => (
                        <Link
                            key={parcel._id}
                            href="/driver/parcels"
                            className="block rounded-2xl border border-pd-line bg-pd-surface p-4"
                        >
                            <p className="font-bold">
                                {parcel.serviceType?.replaceAll("_", " ")}
                            </p>
                            <p className="text-sm text-pd-muted">
                                {parcel.parcel?.category} · {parcel.parcel?.weightKg} kg
                            </p>
                            <p className="mt-2 font-extrabold">
                                PKR {parcel.requestedPrice}
                            </p>
                            <span className="text-xs font-bold underline">
                                {t("dHome.viewSendOffer")}
                            </span>
                        </Link>
                    ))}
                </div>
            )}

            <div className={requestType === "parcels" && parcelRequests.length > 0 ? "hidden" : "flex items-center justify-between"}>
                <div className="flex min-w-0 items-center gap-2">
                    <h2 className="dx-h2">
                        {t("dHome.rideRequests")}
                        {requests.length > 0 && <span className="dx-count">{requests.length}</span>}
                    </h2>
                </div>
                <button type="button" className="dx-btn-ghost" onClick={refreshNow} disabled={!isOnline || refreshing} aria-label={t("dHome.refreshRequests")}>
                    <RefreshCw size={15} className={refreshing ? "dx-spin" : ""} /> {t("dHome.refresh")}
                </button>
            </div>
            {requestType !== "parcels" && !socketConnected && isOnline && (
                <p className="dx-inline-warn"><WifiOff size={14} /> {t("dHome.livePaused")}</p>
            )}
            {loading ? (
                <div className="space-y-3" aria-busy="true">{[0, 1].map((i) => <div key={i} className="dx-skeleton" />)}</div>
            ) : requests.length === 0 ? (
                <div className="dx-empty">
                    <span className="dx-empty-icon" data-on={isOnline}>{isOnline ? <Compass size={26} /> : <Power size={24} />}</span>
                    <p className="font-extrabold">{isOnline ? (isAvailable ? t("dHome.noNearbyRequests") : t("dHome.finishCurrentTrip")) : t("dHome.youreOffline")}</p>
                    <p className="dx-muted">{isOnline ? t("dHome.requestsAppear") : t("dHome.goOnlineHint")}</p>
                </div>
            ) : (
                namedRequests.map((ride) => (
                    <RideQueueRow key={ride.rideId} ride={ride}
                        submitted={submittedIds.includes(ride.rideId)}
                        onOpen={() => openRequest(ride.rideId)} />
                ))
            )}
        </div>
    );
    // Online home: only the live requests. Earnings, tasks, vehicles and
    // documents live on their own tabs.
    const idleBody = (
        <div className="space-y-4 pb-4">
            {requestsView}
        </div>
    );
    const tripPanel = rideInProgress && (
        <TripStepPanel
            key={`${selectedRide._id}:${selectedRide.status}:${stopsDone}:${Boolean(selectedRide.stopWaitingSince)}`}
            status={selectedRide.status}
            passengerName={passengerNameOf(selectedRide)}
            tripType={selectedRide.tripType}
            stopsDone={stopsDone}
            stopsTotal={stopsTotal}
            pendingStop={pendingStop}
            stopWaiting={Boolean(selectedRide.stopWaitingSince)}
            targetPoint={nextTarget}
            targetPlace={targetTitle}
            navigationInfo={navigationInfo}
            waitingTime={waitingSince ? waitingTime : null}
            completeBlocked={completeBlocked}
            busy={busy}
            unread={unreadMessages}
            onAdvance={advanceTrip}
            onStopAction={updateStop}
            onChat={() => { markMessagesRead(); setChatOpen(true); }}
        />
    );
    const endedPanel = rideEnded && (
        <RideEndedPanel status={selectedRide.status} firstName={firstName} finalPrice={selectedRide.finalPrice} onDone={finishRide} />
    );
    const waitingRides = namedRequests.filter((r) => !declinedIds.includes(r.rideId));
    const unansweredRides = waitingRides.filter((r) => !submittedIds.includes(r.rideId));
    const bannerRide = unansweredRides[0] || waitingRides[0] || null;
    const homeBanner = !rideInProgress && !rideEnded && !focusRide && isOnline && bannerRide && (
        <div className="pointer-events-none absolute inset-x-4 top-[calc(max(16px,env(safe-area-inset-top))+60px)] z-30 mx-auto max-w-xl">
            <RideReturnBanner
                kind={unansweredRides.length > 0 ? "available" : "offer"}
                title={unansweredRides.length > 0
                    ? (unansweredRides.length === 1 ? "1 ride is waiting for you" : `${unansweredRides.length} rides are waiting for you`)
                    : "Offer sent, waiting for passenger"}
                subtitle={`From ${placeText(bannerRide.pickup)}`}
                onClick={() => openRequest(bannerRide.rideId)}
            />
        </div>
    );
    return (
        <main className="driver-live-home dx-home" data-ride={rideInProgress ? "active" : "idle"}>
            <div className="absolute inset-0">
                {parcelAssignment?.parcelId && (
                    <Link
                        href={`/driver/parcels/details?parcelId=${parcelAssignment.parcelId}`}
                        className="fixed left-4 right-4 top-20 z-50 mx-auto max-w-md rounded-2xl bg-[#087F5B] p-4 font-bold text-white shadow-xl"
                    >
                        📦 Parcel Assigned! Tap to manage delivery →
                    </Link>
                )}
                <DriverMap
                    token={token}
                    locateRequest={locateRequest}
                    destination={nextTarget}
                    targetKind={selectedRide?.status === "TRIP_STARTED" ? "destination" : "pickup"}
                    navigationMode={rideInProgress}
                    driverLocation={location}
                    vehicleType={activeVehicle?.vehicleType || null}
                    vehicleColor={activeVehicle?.color || null}
                    onRouteUpdate={setNavigationInfo}
                    sheetRatio={sheetRatio}
                    selectedRideId={focusRideId}
                    onRideSelect={openRequest}
                    rideRequests={isOnline && isAvailable && !rideInProgress ? requests.map((ride) => ({
                        id: ride.rideId,
                        point: ride.pickup,
                        fare: ride.requestedPrice ? money(ride.requestedPrice) : "",
                        label: placeText(ride.pickup),
                    })) : []}
                />
            </div>
            {/* Menu sits at top-left; turn-by-turn guidance fills the rest of the top while a ride is active. */}
            {rideInProgress && navigating && (
                <NavigationBanner
                    info={navigationInfo}
                    targetKind={selectedRide?.status === "TRIP_STARTED" ? "destination" : "pickup"}
                    className="pointer-events-none absolute left-[76px] right-3 top-[calc(max(16px,env(safe-area-inset-top)))] z-20"
                />
            )}
            <div className="absolute left-4 top-[calc(max(16px,env(safe-area-inset-top)))] z-50">
                <button type="button" aria-label="Open driver menu" aria-expanded={mapMenuOpen}
                    onClick={() => { setMapMenuOpen((open) => !open); notifications.markRead(); }}
                    className="relative flex h-12 w-12 items-center justify-center rounded-2xl bg-pd-surface text-pd-text shadow-[0_6px_24px_rgba(17,17,17,0.12)]">
                    {mapMenuOpen ? <X size={23} /> : <Menu size={23} />}
                    {!mapMenuOpen && notifications.unread > 0 && <span className="absolute -right-1 -top-1 h-3 w-3 rounded-full bg-[#087F5B] ring-2 ring-white" />}
                </button>
            </div>
            {!rideInProgress && !rideEnded && (
                <Link href="/driver/complaints" aria-label="Help and support"
                    className="absolute right-4 top-[calc(max(16px,env(safe-area-inset-top)))] z-30 flex h-12 items-center gap-2 rounded-2xl bg-pd-surface px-4 text-sm font-extrabold text-pd-text shadow-[0_6px_24px_rgba(17,17,17,0.12)]">
                    <LifeBuoy size={20} aria-hidden="true" /> Help
                </Link>
            )}
            {mapMenuOpen && (
                <>
                    <button type="button" aria-label="Close driver menu" onClick={() => setMapMenuOpen(false)}
                        className="absolute inset-0 z-40 bg-black/20" />
                    <nav aria-label="Driver menu" className="absolute left-4 top-[calc(max(16px,env(safe-area-inset-top))+60px)] z-50 w-72 max-w-[calc(100vw-32px)] rounded-2xl bg-pd-surface p-2 text-pd-text shadow-xl">
                        <Link href="/driver/complaints" onClick={() => setMapMenuOpen(false)} className="flex min-h-12 items-center gap-3 rounded-xl px-3 text-sm font-extrabold text-pd-accent-text hover:bg-pd-surface-2">
                            <LifeBuoy size={19} /> Help and support
                        </Link>
                        <Link href="/driver/account" onClick={() => setMapMenuOpen(false)} className="flex min-h-12 items-center gap-3 rounded-xl px-3 text-sm font-semibold hover:bg-pd-surface-2">
                            <UserRound size={19} /> {t("dHome.myAccount")}
                        </Link>
                        <Link
                            href="/driver/parcels"
                            onClick={() => setMapMenuOpen(false)}
                            className="flex min-h-12 items-center gap-3 rounded-xl px-3 text-sm font-semibold hover:bg-pd-surface-2"
                        >
                            <Package size={19} />
                            <span className="flex-1">{t("dHome.parcelDeliveries")}</span>
                            <ParcelActivityBar token={token} role="DRIVER" variant="badge" />
                        </Link>
                        <Link href="/driver/services" onClick={() => setMapMenuOpen(false)} className="flex min-h-12 items-center gap-3 rounded-xl px-3 text-sm font-semibold hover:bg-pd-surface-2">
                            <LayoutGrid size={19} />
                            <span className="flex-1">{t("dHome.myServices")}</span>
                        </Link>
                        <Link href="/driver/rentals" onClick={() => setMapMenuOpen(false)} className="flex min-h-12 items-center gap-3 rounded-xl px-3 text-sm font-semibold hover:bg-pd-surface-2">
                            <Store size={19} />
                            <span className="flex-1">{t("dHome.myRentalBusiness")}</span>
                        </Link>
                        <button type="button" onClick={notifications.toggleSound} className="flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-semibold hover:bg-pd-surface-2">
                            {notifications.soundEnabled ? <Volume2 size={19} /> : <VolumeX size={19} />}
                            {notifications.soundEnabled ? t("dHome.muteAlerts") : t("dHome.enableAlertSounds")}
                        </button>
                        <div className="border-t border-pd-line px-3 py-2">
                            <div className="flex items-center justify-between gap-2">
                                <span className="flex items-center gap-2 text-sm font-semibold"><Bell size={19} /> {t("dHome.notifications")}</span>
                                {notifications.items.length > 0 && <button type="button" onClick={notifications.clear} className="text-xs font-semibold text-pd-muted">{t("dHome.clear")}</button>}
                            </div>
                            <div className="mt-2 max-h-60 space-y-1 overflow-y-auto">
                                {notifications.items.length === 0 ? <p className="py-2 text-xs text-pd-muted">{t("dHome.noNotifications")}</p> : notifications.items.map((item) => (
                                    <div key={item.id} className="rounded-xl bg-pd-surface-2 p-2.5">
                                        <p className="text-xs font-bold">{item.title}</p>
                                        {item.body && <p className="mt-0.5 text-xs text-pd-muted">{item.body}</p>}
                                    </div>
                                ))}
                            </div>
                        </div>
                    </nav>
                </>
            )}
            <button type="button" onClick={locateMe} disabled={locating} aria-label="Centre on my location"
                style={{ bottom: rideInProgress || rideEnded ? `${TRIP_PANEL_HEIGHT + 16}px` : showGuidedCard ? `calc(${guidedHeight}px + 68px + 24px + env(safe-area-inset-bottom))` : `calc(${heights[sheet]} + 78px)` }}
                className="absolute right-4 z-30 flex h-12 w-12 items-center justify-center rounded-2xl bg-pd-surface text-pd-text shadow-[0_6px_24px_rgba(17,17,17,0.12)] disabled:opacity-60">
                <LocateFixed size={21} className={locating ? "animate-pulse" : ""} />
            </button>
            <DriverToast toast={notifications.toast} onDismiss={notifications.dismissToast} />
            {rideInProgress && chatOpen && (
                <RideChat rideId={selectedRide._id} token={token} userId={userId}
                    directOpen onClose={() => setChatOpen(false)}
                    participantLabel={selectedRide.passengerId?.firstName || "passenger"}
                    participantPhoto={selectedRide.passengerId?.profileImage || ""}
                    participantFullName={[
                        selectedRide.passengerId?.firstName,
                        selectedRide.passengerId?.lastName
                    ].filter(Boolean).join(" ")} />
            )}
            {showGuidedCard && (
                <GuidedHomeCard
                    step={guidedStep}
                    loading={loading}
                    vehicles={vehicles}
                    selectedVehicle={selectedVehicle}
                    savedVehicle={savedVehicle}
                    chosenVehicle={chosenVehicle}
                    choosing={choosingVehicle}
                    busy={busy}
                    onlineBlock={onlineBlock}
                    blockedLine={onlineBlock?.services?.map((service) => (
                        <p key={service.service} className="mt-1 text-xs font-semibold">
                            {SERVICE_META[service.service]?.short}:{" "}
                            {(service.blockedReasons || []).map(humanizeReason).filter(Boolean).slice(0, 2).join(" · ")
                                || (STATUS_META[service.status]?.label || service.status)}
                        </p>
                    ))}
                    onOpenChoose={() => setTab("vehicle")}
                    onCloseChoose={() => setTab("requests")}
                    onSelectVehicle={setSelectedVehicle}
                    onSaveVehicle={saveVehicle}
                    onGoOnline={toggleOnline}
                    onHeight={setGuidedHeight}
                />
            )}
            {rideInProgress || rideEnded ? (rideInProgress ? tripPanel : endedPanel) : guidedStep !== "online" ? null : (
                <DriverSheet
                    label="Driver dashboard"
                    state={sheet}
                    onStateChange={setSheet}
                    heights={heights}
                    bottomOffset="calc(68px + env(safe-area-inset-bottom))"
                    peek={idlePeek}
                >
                    {idleBody}
                </DriverSheet>
            )}
            {homeBanner}
            {focusRide && !rideInProgress && (
                <RideRequestCard
                    ride={focusRide}
                    passengerName={passengerNameOf(focusRide)}
                    price={offerPrices[focusRide.rideId]}
                    onPriceChange={(value) => setOfferPrices((p) => ({ ...p, [focusRide.rideId]: value }))}
                    onAccept={() => sendOffer(focusRide)}
                    onDecline={() => {
                        setDeclinedIds((previous) => [...new Set([...previous, focusRide.rideId])]);
                        setFocusRideId(null);
                    }}
                    onClose={() => {
                        setSeenIds((previous) => [...new Set([...previous, focusRide.rideId])]);
                        setFocusRideId(null);
                    }}
                    pickupDistanceText={focusPickupDistance}
                    secondsLeft={focusSecondsLeft}
                    totalSeconds={REQUEST_FOCUS_SECONDS}
                    busy={offerBusy === focusRide.rideId}
                    submitted={submittedIds.includes(focusRide.rideId)}
                    cooldownSeconds={Math.max(0, Math.ceil(((nextBidAt[focusRide.rideId] || 0) - clock) / 1000))}
                />
            )}
            {!rideInProgress && <MobileBottomNav role="DRIVER" />}
        </main>
    );
}
