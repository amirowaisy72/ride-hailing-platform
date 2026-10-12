"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
    ArrowRight, Banknote, Bell, Check, ChevronDown, ChevronUp, Clock, Crosshair, LocateFixed,
    Map as MapIcon, MapPin, Minimize2, Minus, Navigation, Plus, Radio, Route as RouteIcon,
    ShieldCheck, Star, UserRound, Users, Volume2, VolumeX, X, Car,
} from "lucide-react";
import { Geolocation } from "@capacitor/geolocation";
import AuthGuard from "@/components/AuthGuard";
import { useAuth } from "@/context/AuthContext";
import { getRealtimeSocket } from "@/lib/socket";
import { BRAND } from "@/config/brand";
import DriverRating from "@/components/DriverRating";
import DriverProfileCard from "@/components/DriverProfileCard";
import RideJourneyExperience from "@/components/RideJourneyExperience";
import { apiRequest } from "@/lib/api";
import { getSuggestedFare } from "@/lib/pricingService";
import {
    reverseGeocode,
    searchLocations,
    calculateRoute,
} from "@/lib/locationService";
import RideMap from "@/components/RideMap";
import { useLiveDriverLocation } from "@/hooks/useLiveDriverLocation";
import { useNearbyDrivers } from "@/hooks/useNearbyDrivers";
import RideChat from "@/components/RideChat";
import MobileBottomNav from "@/components/MobileBottomNav";
import { PickupLocationSearch } from "@/components/PassengerBookingExperience";
import RideStopsEditor from "@/components/RideStopsEditor";
import {
    VEHICLES, describeDriver, formatArrival, formatClock, formatPKR, getInitials, getVehicle, placeLabel,
} from "@/lib/rideDisplay";

const SEARCHING_STATUSES = ["REQUESTED", "SEARCHING", "BIDDING"];
const ASSIGNED_STATUSES = ["DRIVER_SELECTED", "DRIVER_EN_ROUTE", "DRIVER_ARRIVED", "TRIP_STARTED"];
const FARE_STEP = 10;
const DEFAULT_OFFER_WINDOW_MS = 60000;
const LONG_SEARCH_MS = 45000;
const FLOATING_SHADOW = "shadow-[0_6px_24px_rgba(17,17,17,0.12)]";

const MOTION_STYLES = `
@keyframes rx-indeterminate { 0% { transform: translateX(-110%); } 100% { transform: translateX(260%); } }
@keyframes rx-radar { 0% { transform: scale(0.55); opacity: 0.75; } 100% { transform: scale(2.3); opacity: 0; } }
@keyframes rx-slide-up { from { opacity: 0; transform: translateY(18px); } to { opacity: 1; transform: none; } }
@keyframes rx-slide-down { from { opacity: 0; transform: translateY(-14px); } to { opacity: 1; transform: none; } }
@keyframes rx-shimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }
@keyframes rx-sheet-in { from { transform: translateY(40px); opacity: 0; } to { transform: none; opacity: 1; } }
.rx-indeterminate { animation: rx-indeterminate 1.6s cubic-bezier(.4,0,.2,1) infinite; }
.rx-radar { animation: rx-radar 2.4s cubic-bezier(0,0,.2,1) infinite; }
.rx-radar-delay { animation-delay: 1.2s; }
.rx-slide-up { animation: rx-slide-up .38s cubic-bezier(.2,.8,.2,1) both; }
.rx-slide-down { animation: rx-slide-down .32s cubic-bezier(.2,.8,.2,1) both; }
.rx-sheet-in { animation: rx-sheet-in .42s cubic-bezier(.2,.8,.2,1) both; }
.rx-shimmer { background: linear-gradient(90deg,#F1F2F4 25%,#E6E8EB 37%,#F1F2F4 63%); background-size: 400% 100%; animation: rx-shimmer 1.6s ease infinite; }
@media (prefers-reduced-motion: reduce) {
  .rx-indeterminate, .rx-radar, .rx-slide-up, .rx-slide-down, .rx-shimmer, .rx-sheet-in { animation: none !important; }
}
`;

function getOfferId(offer) {
    return String(offer._id || offer.offerId);
}

export default function PassengerPage() {
    return (
        <AuthGuard role="PASSENGER">
            <PassengerDashboard />
        </AuthGuard>
    );
}

function PassengerDashboard() {
    const { user, token } = useAuth();
    const [notification, setNotification] = useState("");
    const [toast, setToast] = useState(null);
    const [offers, setOffers] = useState([]);
    const [soundEnabled, setSoundEnabled] = useState(false);
    const soundEnabledRef = useRef(false);
    const audioContextRef = useRef(null);
    const lastSoundEventRef = useRef({ key: "", time: 0 });
    const [offerClock, setOfferClock] = useState(Date.now());

    useEffect(() => {
        const timer = setInterval(() => setOfferClock(Date.now()), 1000);
        return () => clearInterval(timer);
    }, []);

    useEffect(() => {
        if (!notification) return;
        setToast({ text: notification, id: Date.now() });
        const timer = setTimeout(() => setToast(null), 4000);
        return () => clearTimeout(timer);
    }, [notification]);

    const playAlert = () => {
        if (!soundEnabledRef.current || typeof window === "undefined") return;
        try {
            const AudioContextClass = window.AudioContext || window.webkitAudioContext;
            if (!AudioContextClass) return;
            const context = audioContextRef.current;
            if (!context || context.state !== "running") return;
            const start = context.currentTime;
            [740, 990].forEach((frequency, index) => {
                const oscillator = context.createOscillator();
                const gain = context.createGain();
                const at = start + index * 0.14;
                oscillator.type = "sine";
                oscillator.frequency.value = frequency;
                gain.gain.setValueAtTime(0.0001, at);
                gain.gain.exponentialRampToValueAtTime(0.09, at + 0.02);
                gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.13);
                oscillator.connect(gain).connect(context.destination);
                oscillator.start(at);
                oscillator.stop(at + 0.14);
            });
        } catch { /* Alerts are optional when audio is unsupported. */ }
    };

    const toggleSound = async () => {
        if (soundEnabledRef.current) {
            soundEnabledRef.current = false;
            setSoundEnabled(false);
            return;
        }
        try {
            const AudioContextClass = window.AudioContext || window.webkitAudioContext;
            if (!AudioContextClass) throw new Error("Audio unsupported on this device");
            const context = audioContextRef.current || new AudioContextClass();
            audioContextRef.current = context;
            await context.resume();
            if (context.state !== "running") throw new Error("Browser blocked sound. Tap again.");
            soundEnabledRef.current = true;
            setSoundEnabled(true);
            setNotification("Ride alert sounds enabled.");
            playAlert(); // audible test from the user's button gesture
        } catch (error) {
            soundEnabledRef.current = false;
            setSoundEnabled(false);
            setNotification(error.message || "Could not enable sound");
        }
    };

    useEffect(() => () => {
        soundEnabledRef.current = false;
        const context = audioContextRef.current;
        audioContextRef.current = null;
        if (context) void context.close().catch(() => { });
    }, []);

    const validOffers = offers.filter((offer) =>
        offer.status !== "REJECTED" &&
        offer.status !== "ACCEPTED" &&
        (!offer.expiresAt || new Date(offer.expiresAt).getTime() > offerClock)
    );

    const [userLocation, setUserLocation] = useState(null);
    const [currentCity, setCurrentCity] = useState("");
    const [citySupported, setCitySupported] = useState(null);
    useEffect(() => {
        if (!userLocation || !token) return;
        let cancelled = false;
        setCitySupported(null);
        setCurrentCity("");
        async function checkCity() {
            try {
                const params = new URLSearchParams({
                    latitude: String(userLocation.latitude),
                    longitude: String(userLocation.longitude),
                });
                const result = await apiRequest(
                    `/admin/service-areas/check?${params}`,
                    { token }
                );
                if (!cancelled) {
                    setCitySupported(result.supported);
                    setCurrentCity(result.city || "");
                }
            } catch {
                if (!cancelled) {
                    setCitySupported(null);
                    setCurrentCity("");
                }
            }
        }
        checkCity();
        return () => {
            cancelled = true;
        };
    }, [
        token,
        userLocation?.latitude,
        userLocation?.longitude,
    ]);
    const [pickupAddress, setPickupAddress] = useState("");
    const [fullScreenMap, setFullScreenMap] = useState(false);
    const [manualPickup, setManualPickup] = useState(false);
    const [mapPickTarget, setMapPickTarget] = useState(null);
    useEffect(() => {
        if (!userLocation || !token || manualPickup) return;
        let cancelled = false;
        async function loadAddress() {
            try {
                const result = await reverseGeocode(
                    userLocation.latitude,
                    userLocation.longitude,
                    token
                );
                if (!cancelled) {
                    setPickupAddress(
                        result?.display_name ||
                        result?.displayName ||
                        "Selected pickup location"
                    );
                }
            } catch {
                if (!cancelled) {
                    setPickupAddress("Selected pickup location");
                }
            }
        }
        loadAddress();
        return () => {
            cancelled = true;
        };
    }, [
        userLocation?.latitude,
        userLocation?.longitude,
        token,
        manualPickup,
    ]);
    const [destination, setDestination] = useState(null);
    const [stops, setStops] = useState([]);
    const [destinationQuery, setDestinationQuery] = useState("");
    const [searchResults, setSearchResults] = useState([]);
    const [searching, setSearching] = useState(false);
    const [destinationSelected, setDestinationSelected] = useState(false);
    const [route, setRoute] = useState(null);
    const [routeLoading, setRouteLoading] = useState(false);
    const [vehicleType, setVehicleType] = useState("CAR_NON_AC");
    const [passengerCount, setPassengerCount] = useState(1);
    const [fare, setFare] = useState(null);
    const [fareLoading, setFareLoading] = useState(false);
    const [proposedFare, setProposedFare] = useState("");
    const [booking, setBooking] = useState(false);
    const [cancelling, setCancelling] = useState(false);
    async function cancelRide() {
        if (!activeRide?._id || cancelling) return;
        if (!window.confirm("Are you sure you want to cancel this ride?")) return;
        setCancelling(true);
        try {
            await apiRequest(`/rides/${activeRide._id}/cancel`, {
                method: "POST",
                token,
            });
            setActiveRide(null);
            setOffers([]);
            setNotification("Ride cancelled successfully.");
        } catch (error) {
            setNotification(error.message);
        } finally {
            setCancelling(false);
        }
    }
    const [activeRide, setActiveRide] = useState(null);
    const activeRideRef = useRef(null);
    activeRideRef.current = activeRide;
    const [completedRideId, setCompletedRideId] = useState(null);
    const [completedRide, setCompletedRide] = useState(null);
    const [reviewSubmitted, setReviewSubmitted] = useState(false);
    const activeRideId = activeRide?._id?.toString();
    const { driverLocation, driverLocationUpdatedAt, driverLocationFresh } = useLiveDriverLocation(activeRideId, token, Boolean(activeRide?.driverId || ASSIGNED_STATUSES.includes(activeRide?.status)));
    const searchingForDriver = Boolean(activeRide && SEARCHING_STATUSES.includes(activeRide.status));
    const rideAssigned = Boolean(activeRide && ASSIGNED_STATUSES.includes(activeRide.status));
    const nearbyDrivers = useNearbyDrivers(activeRideId, token, searchingForDriver);
    const [liveRoute, setLiveRoute] = useState(null);
    useEffect(() => {
        setLiveRoute(null);
    }, [activeRideId, activeRide?.status, activeRide?.stopsCompleted]);
    const [rideRestoring, setRideRestoring] = useState(true);
    useEffect(() => {
        if (!token) return;
        let disposed = false;
        let requestId = 0;
        async function syncRide() {
            const currentRequest = ++requestId;
            try {
                const [activeResult, completedResult] = await Promise.all([
                    apiRequest("/rides/active", { token }),
                    apiRequest("/rides/latest-completed", { token }),
                ]);
                if (disposed || currentRequest !== requestId) return;
                setActiveRide(activeResult.ride || null);
                const completed = completedResult.ride;
                if (completed && !completedResult.reviewed) {
                    setCompletedRideId(String(completed._id));
                    setCompletedRide(completed);
                    setReviewSubmitted(false);
                } else {
                    setCompletedRideId(null);
                    setReviewSubmitted(Boolean(completedResult.reviewed));
                }
            } catch (error) {
                if (!disposed) {
                    console.error("Ride synchronization failed:", error.message);
                }
            }
        }
        function onForeground() {
            if (document.visibilityState === "visible") {
                syncRide();
            }
        }
        function onFocus() {
            syncRide();
        }
        function onOnline() {
            syncRide();
        }
        const socket = getRealtimeSocket();
        document.addEventListener("visibilitychange", onForeground);
        window.addEventListener("focus", onFocus);
        window.addEventListener("online", onOnline);
        socket?.on("connect", syncRide);
        return () => {
            disposed = true;
            requestId++;
            document.removeEventListener("visibilitychange", onForeground);
            window.removeEventListener("focus", onFocus);
            window.removeEventListener("online", onOnline);
            socket?.off("connect", syncRide);
        };
    }, [token]);
    useEffect(() => {
        if (!token) return;
        let cancelled = false;
        async function restoreRide() {
            try {
                const [activeResult, completedResult] = await Promise.all([
                    apiRequest("/rides/active", { token }),
                    apiRequest("/rides/latest-completed", { token }),
                ]);
                if (!cancelled) {
                    setActiveRide(activeResult.ride || null);
                    const completed = completedResult.ride;
                    if (completed && !completedResult.reviewed) {
                        setCompletedRideId(String(completed._id));
                        setCompletedRide(completed);
                        setReviewSubmitted(false);
                    } else {
                        setCompletedRideId(null);
                        setReviewSubmitted(Boolean(completedResult.reviewed));
                    }
                }
            } catch (error) {
                if (!cancelled) setNotification(error.message);
            } finally {
                if (!cancelled) setRideRestoring(false);
            }
        }
        restoreRide();
        return () => {
            cancelled = true;
        };
    }, [token]);
    const [selectingOfferId, setSelectingOfferId] = useState(null);
    useEffect(() => {
        const rideId = String(activeRide?._id || "");
        if (!rideId || !token || !SEARCHING_STATUSES.includes(activeRide.status)) {
            setOffers([]);
            return;
        }

        let disposed = false;
        let sequence = 0;
        const socket = getRealtimeSocket();

        async function syncOffers() {
            const current = ++sequence;
            try {
                const data = await apiRequest(`/rides/${rideId}/offers`, { token });
                if (!disposed && current === sequence) {
                    setOffers((data.offers || []).map((offer) => ({
                        ...offer,
                        offerId: String(offer._id || offer.offerId),
                    })));
                }
            } catch (error) {
                if (!disposed && current === sequence) setNotification(error.message);
            }
        }

        const onForeground = () => {
            if (document.visibilityState === "visible") void syncOffers();
        };
        void syncOffers();
        const interval = window.setInterval(() => {
            if (document.visibilityState === "visible") void syncOffers();
        }, 15000);
        socket?.on("connect", syncOffers);
        document.addEventListener("visibilitychange", onForeground);
        return () => {
            disposed = true;
            sequence++;
            window.clearInterval(interval);
            socket?.off("connect", syncOffers);
            document.removeEventListener("visibilitychange", onForeground);
        };
    }, [activeRide?._id, activeRide?.status, token]);

    async function rejectOffer(offerId) {
        if (!activeRide?._id || selectingOfferId) return;
        setSelectingOfferId(offerId);
        try {
            await apiRequest(
                `/rides/${activeRide._id}/offers/${offerId}/reject`,
                {
                    method: "PATCH",
                    token,
                }
            );
            setOffers((previous) =>
                previous.filter(
                    (offer) =>
                        String(offer._id || offer.offerId) !== String(offerId)
                )
            );
            setNotification("Offer rejected.");
        } catch (error) {
            setNotification(error.message);
        } finally {
            setSelectingOfferId(null);
        }
    }
    async function acceptOffer(offerId) {
        if (!activeRide?._id || selectingOfferId) return;
        setSelectingOfferId(offerId);
        try {
            await apiRequest(`/rides/${activeRide._id}/select-driver`, {
                method: "POST",
                token,
                body: JSON.stringify({ offerId }),
            });
            setActiveRide((previous) => ({
                ...previous,
                status: "DRIVER_SELECTED",
            }));
            setOffers([]);
            setFullScreenMap(false);
            setNotification("Driver selected successfully!");
        } catch (error) {
            setNotification(error.message);
        } finally {
            setSelectingOfferId(null);
        }
    }
    async function bookRide() {
        const price = Number(proposedFare);
        if (!userLocation || !destination || !route || !fare ||
            !Number.isSafeInteger(price) || price <= 0 || booking) {
            setNotification("Please select a valid ride and fare.");
            return;
        }
        setBooking(true);
        try {
            const data = await apiRequest("/rides", {
                method: "POST",
                token,
                body: JSON.stringify({
                    pickup: userLocation,
                    destination: {
                        latitude: destination.latitude,
                        longitude: destination.longitude,
                    },
                    vehicleType,
                    requestedPrice: price,
                    passengerCount,
                    stops: stops.map(({ latitude, longitude, name }) => ({
                        latitude,
                        longitude,
                        name,
                    })),
                }),
            });
            setOffers([]);
            setActiveRide(data.ride);
            setFullScreenMap(false);
            setNotification("Ride requested! Waiting for driver offers.");
        } catch (error) {
            setNotification(error.message);
        } finally {
            setBooking(false);
        }
    }
    useEffect(() => {
        if (!route?.distanceKm || !token) {
            setFare(null);
            return;
        }
        let cancelled = false;
        setFare(null);
        setFareLoading(true);
        getSuggestedFare(vehicleType, route.distanceKm, token)
            .then((result) => {
                if (!cancelled) {
                    setFare(result);
                    setProposedFare(String(result.suggestedFare));
                }
            })
            .catch((error) => {
                if (!cancelled) setNotification(error.message);
            })
            .finally(() => {
                if (!cancelled) setFareLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [vehicleType, route?.distanceKm, token]);
    useEffect(() => {
        const seats = getVehicle(vehicleType)?.seats || 1;
        setPassengerCount((count) => Math.min(Math.max(1, count), seats));
    }, [vehicleType]);
    useEffect(() => {
        if (
            !token ||
            !userLocation ||
            destinationSelected ||
            destinationQuery.trim().length < 3
        ) {
            setSearchResults([]);
            setSearching(false);
            return;
        }
        let cancelled = false;
        setSearching(true);
        const timer = setTimeout(async () => {
            try {
                const results = await searchLocations(
                    destinationQuery,
                    token,
                    userLocation
                );
                if (!cancelled) setSearchResults(results);
            } catch (error) {
                if (!cancelled) {
                    setSearchResults([]);
                    setNotification(error.message);
                }
            } finally {
                if (!cancelled) setSearching(false);
            }
        }, 500);
        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [
        destinationQuery,
        token,
        userLocation?.latitude,
        userLocation?.longitude,
    ]);
    const [locating, setLocating] = useState(false);
    const [mapLocateRequest, setMapLocateRequest] = useState(0);
    const locationRequested = useRef(false);
    useEffect(() => {
        if (locationRequested.current) return;
        locationRequested.current = true;
        locateMe();
    }, []);
    async function locateMe() {
        setLocating(true);
        try {
            const position = await Geolocation.getCurrentPosition({
                enableHighAccuracy: true,
                timeout: 15000,
            });
            setManualPickup(false);
            setUserLocation({
                latitude: position.coords.latitude,
                longitude: position.coords.longitude,
            });
            setMapLocateRequest((n) => n + 1);
        } catch (error) {
            console.error("GPS Error:", error);
            setNotification(error.message || "Unable to detect location.");
        } finally {
            setLocating(false);
        }
    }
    useEffect(() => {
        const socket = getRealtimeSocket();
        if (!socket) return;
        const handleOffer = (data) => {
            if (String(data.rideId) !== String(activeRideId)) return;
            const eventKey = `${data.offerId || data._id}:${data.price}:${data.expiresAt}`;
            if (lastSoundEventRef.current.key !== eventKey ||
                Date.now() - lastSoundEventRef.current.time > 2500) {
                lastSoundEventRef.current = { key: eventKey, time: Date.now() };
                playAlert();
            }
            setOffers((previous) => {
                const id = String(data.offerId || data._id);
                return [
                    {
                        ...data,
                        _id: id,
                        offerId: id,
                    },
                    ...previous.filter(
                        (offer) =>
                            String(offer._id || offer.offerId) !== id
                    ),
                ];
            });
            setNotification("New driver offer received!");
        };
        const handleRide = () => {
            setNotification("Your ride request is active.");
        };
        const handleCompleted = (data) => {
            if (String(data.rideId) !== String(activeRideId)) return;
            playAlert();
            const finishedRide = activeRideRef.current;
            if (finishedRide && String(finishedRide._id) === String(data.rideId)) {
                setCompletedRide({ ...finishedRide, status: "TRIP_COMPLETED" });
            }
            setCompletedRideId(String(data.rideId));
            setReviewSubmitted(false);
            setActiveRide((previous) => {
                if (String(previous?._id) !== String(data.rideId)) {
                    return previous;
                }
                return null;
            });
            setOffers([]);
            setNotification("Trip completed! Please rate your driver.");
        };
        const handleTripStatus = (data) => {
            if (String(data.rideId) !== String(activeRideId)) return;
            setActiveRide((previous) => {
                if (!previous || String(previous._id) !== String(data.rideId)) {
                    return previous;
                }
                return {
                    ...previous,
                    status: data.status,
                };
            });
            const messages = {
                DRIVER_EN_ROUTE: "Your driver is heading to your pickup location.",
                DRIVER_ARRIVED: "Your driver has arrived!",
                TRIP_STARTED: "Your trip has started. Have a safe journey!",
            };
            if (messages[data.status]) {
                setNotification(messages[data.status]);
                if (data.status === "DRIVER_ARRIVED") playAlert();
            }
        };
        socket.on("ride:status:updated", handleTripStatus);
        socket.on("ride:started", handleTripStatus);
        socket.on("ride:completed", handleCompleted);
        socket.on("ride:offer:new", handleOffer);
        socket.on("ride:offer:updated", handleOffer);
        socket.on("ride:created", handleRide);
        return () => {
            socket.off("ride:status:updated", handleTripStatus);
            socket.off("ride:started", handleTripStatus);
            socket.off("ride:completed", handleCompleted);
            socket.off("ride:offer:new", handleOffer);
            socket.off("ride:offer:updated", handleOffer);
            socket.off("ride:created", handleRide);
        };
    }, [activeRideId]);
    useEffect(() => {
        if (!userLocation || !destination || !token) {
            setRoute(null);
            return;
        }
        let cancelled = false;
        async function loadRoute() {
            setRouteLoading(true);
            setRoute(null);
            try {
                const waypoints = [userLocation, ...stops, destination];
                const legs = await Promise.all(
                    waypoints.slice(0, -1).map((point, index) =>
                        calculateRoute(
                            {
                                latitude: point.latitude,
                                longitude: point.longitude,
                            },
                            {
                                latitude: waypoints[index + 1].latitude,
                                longitude: waypoints[index + 1].longitude,
                            },
                            token
                        )
                    )
                );
                const result = {
                    distanceKm: Number(
                        legs.reduce(
                            (sum, leg) => sum + Number(leg.distanceKm), 0
                        ).toFixed(2)
                    ),
                    durationMinutes: Math.ceil(
                        legs.reduce(
                            (sum, leg) => sum + Number(leg.durationMinutes), 0
                        )
                    ),
                };
                if (
                    !Number.isFinite(result.distanceKm) ||
                    !Number.isFinite(result.durationMinutes) ||
                    result.distanceKm <= 0
                ) {
                    throw new Error("Unable to calculate complete journey");
                }
                if (!cancelled) setRoute(result);
            } catch (error) {
                if (!cancelled) setNotification(error.message);
            } finally {
                if (!cancelled) setRouteLoading(false);
            }
        }
        loadRoute();
        return () => {
            cancelled = true;
        };
    }, [
        userLocation?.latitude,
        userLocation?.longitude,
        destination?.latitude,
        destination?.longitude,
        JSON.stringify(stops.map(
            ({ latitude, longitude }) => [latitude, longitude]
        )),
        token,
    ]);

    async function handleMapPick(position) {
        const target = mapPickTarget;
        setMapPickTarget(null);
        setFullScreenMap(false);
        let name = target === "pickup" ? "Pinned pickup" : "Pinned destination";
        try {
            const result = await reverseGeocode(position.latitude, position.longitude, token);
            name = result?.display_name || result?.displayName || name;
        } catch { /* Keep the pinned label when the address lookup fails. */ }
        if (target === "pickup") {
            setManualPickup(true);
            setPickupAddress(name);
            setUserLocation({ latitude: position.latitude, longitude: position.longitude });
            setRoute(null);
            setFare(null);
            setNotification("Pickup set on the map.");
        } else {
            setDestination({ latitude: position.latitude, longitude: position.longitude, name, display_name: name });
            setDestinationSelected(true);
            setDestinationQuery(name);
            setSearchResults([]);
        }
    }

    function startMapPick(target) {
        setMapPickTarget(target);
        setFullScreenMap(true);
    }

    function finishCompletedTrip({ rated }) {
        setReviewSubmitted(true);
        setCompletedRideId(null);
        setCompletedRide(null);
        setDestination(null);
        setDestinationQuery("");
        setDestinationSelected(false);
        setStops([]);
        setRoute(null);
        setFare(null);
        setProposedFare("");
        setFullScreenMap(false);
        if (rated) setNotification("Thank you for rating your driver!");
    }

    const fareValue = Number(proposedFare);
    const fareIsValid = Number.isSafeInteger(fareValue) && fareValue > 0;
    const adjustFare = (delta) => {
        const base = Number.isFinite(fareValue) && fareValue > 0 ? fareValue : Number(fare?.suggestedFare || 0);
        setProposedFare(String(Math.max(FARE_STEP, Math.round(base + delta))));
    };
    const fareDelta = fare && fareIsValid ? fareValue - Number(fare.suggestedFare) : 0;
    const canBook = !(booking || rideRestoring || !route || !fare || fareLoading || routeLoading || !!activeRide || !fareIsValid);
    const onlineNearby = Number(nearbyDrivers?.onlineDrivers || 0);
    const selectedVehicle = getVehicle(vehicleType) || VEHICLES[2];
    const bookingHint = !destination
        ? "Enter a destination to see rides and fares"
        : routeLoading ? "Calculating your route..."
            : fareLoading ? "Calculating your fare..."
                : !fareIsValid && fare ? "Enter a valid fare" : "";
    const sheetRatio = fullScreenMap || mapPickTarget
        ? 0.14
        : !activeRide ? 0.6 : searchingForDriver ? 0.58 : 0.46;
    const pickupLabel = activeRide ? placeLabel(activeRide.pickup, pickupAddress || "Pickup location") : pickupAddress;
    const destinationLabel = activeRide ? placeLabel(activeRide.destination, destinationQuery || "Destination") : destinationQuery;

    return (
        <main className="relative h-dvh w-full overflow-hidden bg-[#F4F5F7] text-[#111111]">
            <style>{MOTION_STYLES}</style>
            <div className="absolute inset-0">
                <RideMap
                    userLocation={activeRide?.pickup || userLocation}
                    locateRequest={mapLocateRequest}
                    driverLocation={driverLocation}
                    nearbyDriverCells={searchingForDriver ? nearbyDrivers.cells : []}
                    navigationMode={rideAssigned}
                    followDriver={Boolean(driverLocation && activeRide?.status === "DRIVER_EN_ROUTE")}
                    destination={activeRide
                        ? (["DRIVER_SELECTED", "DRIVER_EN_ROUTE"].includes(activeRide.status) ? activeRide.pickup : activeRide.destination)
                        : destination}
                    stops={activeRide ? (activeRide.status === "TRIP_STARTED" ? (activeRide.stops || []).slice(activeRide.stopsCompleted || 0) : []) : stops}
                    onPickupChange={!activeRide && !mapPickTarget ? (position) => {
                        setManualPickup(false);
                        setUserLocation(position);
                        setNotification("Pickup updated on the map.");
                    } : null}
                    onRouteUpdate={rideAssigned ? setLiveRoute : null}
                    onMapClick={mapPickTarget ? handleMapPick : null}
                    passengerView
                    searching={searchingForDriver}
                    vehicleType={activeRide?.vehicleType || vehicleType}
                    sheetRatio={sheetRatio}
                    showNavigationControl={false}
                />
            </div>

            <header className="pointer-events-none absolute inset-x-0 top-0 z-30 flex items-center justify-between gap-3 px-4 pb-4 pt-[max(16px,env(safe-area-inset-top))]">
                <div className={`pointer-events-auto flex items-center gap-1.5 rounded-2xl bg-white p-1.5 ${FLOATING_SHADOW}`}>
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#111111] text-sm font-black tracking-tight text-[#C1F11D]">
                        {BRAND.shortName}
                    </div>
                    <Link
                        href="/passenger/account"
                        aria-label="My account"
                        className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#F4F5F7] text-[#111111] transition-colors hover:bg-[#E9EBEE]"
                    >
                        <UserRound size={20} />
                    </Link>
                </div>

                {searchingForDriver && (
                    <div className="flex min-w-0 items-center gap-2 rounded-full bg-[#111111] px-3.5 py-2 text-xs font-semibold text-white shadow-lg">
                        <span className="relative flex h-2.5 w-2.5 shrink-0">
                            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#C1F11D] opacity-75" />
                            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[#C1F11D]" />
                        </span>
                        <span className="truncate">{onlineNearby} online nearby</span>
                    </div>
                )}

                <div className="pointer-events-auto flex items-center gap-2">
                    <button
                        type="button"
                        aria-label={soundEnabled ? "Mute ride alerts" : "Enable ride alert sound"}
                        aria-pressed={soundEnabled}
                        title={soundEnabled ? "Mute alerts" : "Enable alerts"}
                        onClick={toggleSound}
                        className={`flex h-12 w-12 items-center justify-center rounded-2xl bg-white transition-transform active:scale-95 ${FLOATING_SHADOW}`}
                    >
                        {soundEnabled ? <Volume2 size={20} /> : <VolumeX size={20} className="text-[#6B7280]" />}
                    </button>
                    <button
                        type="button"
                        onClick={() => setNotification((message) => message ? "" : "No new notifications")}
                        aria-label="Notifications"
                        className={`relative flex h-12 w-12 items-center justify-center rounded-2xl bg-white transition-transform active:scale-95 ${FLOATING_SHADOW}`}
                    >
                        <Bell size={21} />
                        {notification && (
                            <span className="absolute right-3 top-3 h-2.5 w-2.5 rounded-full border-2 border-white bg-[#E5484D]" />
                        )}
                    </button>
                </div>
            </header>

            <div className="absolute right-4 top-[calc(max(16px,env(safe-area-inset-top))+64px)] z-20">
                <button
                    type="button"
                    aria-label={activeRide ? "Recenter map" : "Locate me"}
                    onClick={activeRide ? () => setMapLocateRequest((n) => n + 1) : locateMe}
                    disabled={locating}
                    className={`flex h-12 w-12 items-center justify-center rounded-2xl bg-white transition-transform active:scale-95 disabled:opacity-60 ${FLOATING_SHADOW}`}
                >
                    <LocateFixed size={21} className={locating ? "animate-pulse" : ""} />
                </button>
            </div>

            {toast && !mapPickTarget && (
                <div
                    key={toast.id}
                    role="status"
                    aria-live="polite"
                    className="rx-slide-down pointer-events-none absolute left-4 right-[76px] top-[calc(max(16px,env(safe-area-inset-top))+64px)] z-40 mx-auto max-w-md rounded-2xl bg-[#111111] px-4 py-3 text-sm font-semibold text-white shadow-xl"
                >
                    {toast.text}
                </div>
            )}

            {mapPickTarget && (
                <MapPickBanner target={mapPickTarget} onCancel={() => { setMapPickTarget(null); setFullScreenMap(false); }} />
            )}

            {!activeRide && fullScreenMap && !mapPickTarget && (
                <BookingPeek
                    destinationLabel={destinationSelected ? destinationQuery : ""}
                    route={route}
                    onOpen={() => setFullScreenMap(false)}
                />
            )}

            <section
                aria-hidden={fullScreenMap || Boolean(activeRide)}
                inert={fullScreenMap || Boolean(activeRide)}
                aria-label="Book a ride"
                className={`absolute inset-x-0 bottom-[calc(68px+env(safe-area-inset-bottom))] z-10 flex max-h-[calc(80dvh-68px)] flex-col rounded-t-[28px] bg-white shadow-[0_-16px_48px_rgba(17,17,17,0.14)] transition-transform duration-300 ease-out ${(fullScreenMap || activeRide) ? "pointer-events-none translate-y-[120%]" : ""}`}
            >
                <button
                    type="button"
                    onClick={() => setFullScreenMap(true)}
                    aria-label="Minimise booking panel"
                    className="flex shrink-0 justify-center pb-2 pt-3"
                >
                    <span className="h-1.5 w-10 rounded-full bg-[#E3E5E8]" />
                </button>

                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-3 sm:px-6">
                    <div className="mx-auto max-w-lg">
                        <div className="mb-4 flex items-end justify-between gap-3">
                            <div className="min-w-0">
                                <p className="text-sm font-medium text-[#6B7280]">
                                    Hello, {user?.firstName || "Passenger"}
                                </p>
                                <h1 className="mt-0.5 text-pretty text-2xl font-extrabold tracking-tight">
                                    {currentCity ? `Where to in ${currentCity}?` : "Where to today?"}
                                </h1>
                            </div>
                            <button
                                type="button"
                                onClick={() => setFullScreenMap(true)}
                                aria-label="Show full map"
                                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#F4F5F7] transition-colors hover:bg-[#E9EBEE]"
                            >
                                <ChevronDown size={20} />
                            </button>
                        </div>

                        <div className="rounded-2xl border border-[#EEF0F2] bg-white shadow-[0_4px_18px_rgba(17,17,17,0.05)]">
                            <div className="px-3.5 py-3">
                                <PickupLocationSearch
                                    token={token}
                                    currentLocation={userLocation}
                                    pickupAddress={pickupAddress || (locating ? "Detecting location..." : "")}
                                    disabled={Boolean(activeRide) || booking}
                                    onUseGPS={locateMe}
                                    onSelect={(place) => {
                                        setManualPickup(true);
                                        setPickupAddress(place.name);
                                        setUserLocation({
                                            latitude: place.latitude,
                                            longitude: place.longitude,
                                        });
                                        setRoute(null);
                                        setFare(null);
                                    }}
                                />
                            </div>
                            <div className="relative mx-3.5 border-t border-[#EEF0F2]">
                                <span className="absolute -top-3 left-[9px] h-6 border-l-2 border-dotted border-[#C7CBD1]" aria-hidden="true" />
                            </div>
                            <label className="flex items-center gap-3 px-3.5 py-3">
                                <span className="flex h-5 w-5 shrink-0 items-center justify-center" aria-hidden="true">
                                    <span className="h-3.5 w-3.5 rounded-[4px] bg-[#E5484D]" />
                                </span>
                                <span className="min-w-0 flex-1">
                                    <span className="block text-[11px] font-semibold uppercase tracking-wide text-[#9CA3AF]">Destination</span>
                                    <input
                                        type="text"
                                        value={destinationQuery}
                                        onChange={(e) => {
                                            setDestinationQuery(e.target.value);
                                            setDestination(null);
                                            setDestinationSelected(false);
                                        }}
                                        placeholder="Where do you want to go?"
                                        className="w-full min-w-0 bg-transparent text-[15px] font-semibold outline-none placeholder:font-medium placeholder:text-[#9CA3AF]"
                                    />
                                </span>
                                {destinationQuery ? (
                                    <button
                                        type="button"
                                        aria-label="Clear destination"
                                        onClick={() => {
                                            setDestinationQuery("");
                                            setDestination(null);
                                            setDestinationSelected(false);
                                        }}
                                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#F4F5F7] text-[#6B7280]"
                                    >
                                        <X size={15} />
                                    </button>
                                ) : (
                                    <button
                                        type="button"
                                        aria-label="Choose destination on the map"
                                        onClick={() => startMapPick("destination")}
                                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#F4F5F7] text-[#111111] hover:bg-[#E9EBEE]"
                                    >
                                        <Crosshair size={16} />
                                    </button>
                                )}
                            </label>
                        </div>

                        {searching && (
                            <div className="mt-2 space-y-2" aria-label="Searching locations">
                                <div className="rx-shimmer h-14 rounded-xl" />
                                <div className="rx-shimmer h-14 rounded-xl" />
                            </div>
                        )}
                        {!searching && searchResults.length > 0 && (
                            <ul className="rx-slide-up mt-2 max-h-60 overflow-y-auto rounded-2xl border border-[#EEF0F2] bg-white">
                                {searchResults.map((place, index) => (
                                    <li key={place.place_id || index} className="border-b border-[#F1F2F4] last:border-b-0">
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setDestination(place);
                                                setDestinationSelected(true);
                                                setDestinationQuery(place.name);
                                                setSearchResults([]);
                                            }}
                                            className="flex w-full items-center gap-3 p-3 text-left transition-colors hover:bg-[#F7F8F9]"
                                        >
                                            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#F4F5F7]">
                                                <MapPin size={16} className="text-[#6B7280]" aria-hidden="true" />
                                            </span>
                                            <span className="min-w-0">
                                                <span className="block truncate text-sm font-semibold">{place.shortName || place.name || "Selected location"}</span>
                                                {(place.subtitle || place.display_name) && (
                                                    <span className="mt-0.5 block truncate text-xs text-[#6B7280]" title={place.display_name}>
                                                        {place.subtitle || place.display_name}
                                                    </span>
                                                )}
                                            </span>
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        )}

                        <div className="mt-3 flex flex-wrap items-start gap-2">
                            <RideStopsEditor
                                stops={stops}
                                onChange={(nextStops) => {
                                    setStops(nextStops);
                                    setRoute(null);
                                    setFare(null);
                                }}
                                token={token}
                                pickup={userLocation}
                                disabled={Boolean(activeRide) || booking}
                            />
                        </div>
                        {!destinationQuery && (
                            <div className="mt-2 flex flex-wrap gap-2">
                                <button
                                    type="button"
                                    onClick={() => startMapPick("destination")}
                                    className="flex h-10 items-center gap-2 rounded-full bg-[#F4F5F7] px-3.5 text-xs font-bold transition-colors hover:bg-[#E9EBEE]"
                                >
                                    <MapIcon size={15} aria-hidden="true" /> Choose destination on map
                                </button>
                                <button
                                    type="button"
                                    onClick={() => startMapPick("pickup")}
                                    className="flex h-10 items-center gap-2 rounded-full bg-[#F4F5F7] px-3.5 text-xs font-bold transition-colors hover:bg-[#E9EBEE]"
                                >
                                    <Navigation size={15} aria-hidden="true" /> Set pickup on map
                                </button>
                            </div>
                        )}

                        {citySupported === false && (
                            <p className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                                Service is currently unavailable at your pickup location. Please select a pickup inside an active service area.
                            </p>
                        )}

                        {routeLoading && (
                            <div className="mt-5 space-y-3" aria-label="Calculating route">
                                <div className="grid grid-cols-3 gap-2">
                                    {[0, 1, 2].map((item) => <div key={item} className="rx-shimmer h-16 rounded-2xl" />)}
                                </div>
                                <div className="grid grid-cols-4 gap-2">
                                    {VEHICLES.map((vehicle) => <div key={vehicle.id} className="rx-shimmer h-24 rounded-2xl" />)}
                                </div>
                            </div>
                        )}

                        {route && (
                            <div className="rx-slide-up mt-5 space-y-4">
                                <div className="grid grid-cols-3 gap-2">
                                    <TripStat icon={RouteIcon} label="Distance" value={`${route.distanceKm} km`} />
                                    <TripStat icon={Clock} label="Duration" value={`${route.durationMinutes} min`} />
                                    <TripStat icon={MapPin} label="Arrive by" value={formatArrival(route.durationMinutes, offerClock)} />
                                </div>

                                <div>
                                    <h2 className="mb-2.5 text-sm font-bold uppercase tracking-wide text-[#6B7280]">Choose a ride</h2>
                                    <div className="grid grid-cols-4 gap-2" role="radiogroup" aria-label="Vehicle type">
                                        {VEHICLES.map((vehicle) => (
                                            <VehicleOption
                                                key={vehicle.id}
                                                vehicle={vehicle}
                                                selected={vehicleType === vehicle.id}
                                                onSelect={() => setVehicleType(vehicle.id)}
                                            />
                                        ))}
                                    </div>
                                    <p className="mt-2 text-xs font-medium text-[#6B7280]">{selectedVehicle.name} · {selectedVehicle.description}</p>
                                </div>

                                <div className="flex items-center justify-between rounded-2xl bg-[#F4F5F7] px-4 py-3">
                                    <span className="flex items-center gap-2 text-sm font-bold">
                                        <Users size={17} aria-hidden="true" /> Passengers
                                    </span>
                                    <div className="flex items-center gap-3">
                                        <button
                                            type="button"
                                            aria-label="Fewer passengers"
                                            disabled={passengerCount <= 1}
                                            onClick={() => setPassengerCount((count) => Math.max(1, count - 1))}
                                            className="flex h-9 w-9 items-center justify-center rounded-full bg-white shadow-sm transition-transform active:scale-95 disabled:opacity-40"
                                        >
                                            <Minus size={16} />
                                        </button>
                                        <span className="w-4 text-center text-base font-extrabold tabular-nums" aria-live="polite">{passengerCount}</span>
                                        <button
                                            type="button"
                                            aria-label="More passengers"
                                            disabled={passengerCount >= selectedVehicle.seats}
                                            onClick={() => setPassengerCount((count) => Math.min(selectedVehicle.seats, count + 1))}
                                            className="flex h-9 w-9 items-center justify-center rounded-full bg-white shadow-sm transition-transform active:scale-95 disabled:opacity-40"
                                        >
                                            <Plus size={16} />
                                        </button>
                                    </div>
                                </div>

                                <div className="rounded-2xl bg-[#F4F5F7] p-4">
                                    <div className="flex items-center justify-between">
                                        <p className="text-sm font-bold">Offer your fare</p>
                                        {fare && (
                                            <button
                                                type="button"
                                                onClick={() => setProposedFare(String(fare.suggestedFare))}
                                                className="text-xs font-medium text-[#6B7280] hover:text-[#111111]"
                                            >
                                                Recommended <span className="font-bold text-[#111111]">{formatPKR(fare.suggestedFare)}</span>
                                            </button>
                                        )}
                                    </div>

                                    {fareLoading ? (
                                        <div className="rx-shimmer mt-3 h-16 rounded-xl" aria-label="Calculating fare" />
                                    ) : fare ? (
                                        <>
                                            <div className="mt-3 flex items-center gap-2">
                                                <button
                                                    type="button"
                                                    aria-label={`Decrease fare by ${FARE_STEP}`}
                                                    onClick={() => adjustFare(-FARE_STEP)}
                                                    className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-white shadow-sm transition-transform active:scale-95"
                                                >
                                                    <Minus size={20} />
                                                </button>
                                                <label className="flex h-14 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-xl bg-white px-3 shadow-sm focus-within:ring-2 focus-within:ring-[#111111]">
                                                    <span className="text-base font-bold text-[#6B7280]">PKR</span>
                                                    <span className="sr-only">Your fare offer in PKR</span>
                                                    <input
                                                        type="number"
                                                        inputMode="numeric"
                                                        min="1"
                                                        step="1"
                                                        value={proposedFare}
                                                        onChange={(e) => setProposedFare(e.target.value)}
                                                        className="w-24 min-w-0 bg-transparent text-center text-2xl font-extrabold tabular-nums outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                                                    />
                                                </label>
                                                <button
                                                    type="button"
                                                    aria-label={`Increase fare by ${FARE_STEP}`}
                                                    onClick={() => adjustFare(FARE_STEP)}
                                                    className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-white shadow-sm transition-transform active:scale-95"
                                                >
                                                    <Plus size={20} />
                                                </button>
                                            </div>
                                            <p className={`mt-2.5 text-center text-xs font-medium ${fareDelta < 0 ? "text-amber-700" : "text-[#6B7280]"}`}>
                                                {fareDelta < 0
                                                    ? "Lower fares may take longer to get offers"
                                                    : fareDelta > 0
                                                        ? "A higher fare helps you get a driver faster"
                                                        : "Drivers nearby will see your offer and respond"}
                                            </p>
                                        </>
                                    ) : (
                                        <p className="mt-2 text-sm text-[#6B7280]">Fare unavailable for this route.</p>
                                    )}
                                </div>

                                <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-[#6B7280]">
                                    <span className="flex items-center gap-1.5 rounded-full bg-[#F4F5F7] px-3 py-1.5">
                                        <Banknote size={14} aria-hidden="true" /> Cash
                                    </span>
                                    <span className="flex items-center gap-1.5 rounded-full bg-[#F4F5F7] px-3 py-1.5">
                                        <ShieldCheck size={14} aria-hidden="true" /> Verified drivers
                                    </span>
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                <div className="shrink-0 border-t border-[#F1F2F4] bg-white px-4 pb-4 pt-3 sm:px-6">
                    <div className="mx-auto max-w-lg">
                        {bookingHint && <p className="mb-2 text-center text-xs font-medium text-[#6B7280]">{bookingHint}</p>}
                        <button
                            type="button"
                            onClick={bookRide}
                            disabled={!canBook}
                            className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-[#C1F11D] text-base font-extrabold text-[#111111] shadow-[0_8px_24px_rgba(140,180,0,0.35)] transition-all active:scale-[0.98] disabled:bg-[#E9EBEE] disabled:text-[#9CA3AF] disabled:shadow-none"
                        >
                            {booking
                                ? "Requesting ride..."
                                : activeRide
                                    ? "Ride requested"
                                    : fare && fareIsValid ? `Find a driver · ${formatPKR(fareValue)}` : "Find a driver"}
                            {!booking && <ArrowRight size={20} aria-hidden="true" />}
                        </button>
                    </div>
                </div>
            </section>

            {activeRide && fullScreenMap && (
                <button
                    type="button"
                    onClick={() => setFullScreenMap(false)}
                    aria-label="Show ride details"
                    className="absolute bottom-[calc(88px+env(safe-area-inset-bottom))] left-1/2 z-30 flex h-12 -translate-x-1/2 items-center gap-2 rounded-full bg-[#111111] px-5 text-sm font-bold text-white shadow-xl"
                >
                    <Minimize2 size={18} aria-hidden="true" />
                    {searchingForDriver
                        ? validOffers.length > 0 ? `View ${validOffers.length} offer${validOffers.length > 1 ? "s" : ""}` : "Show search details"
                        : "Show ride details"}
                </button>
            )}

            {activeRide && !fullScreenMap && searchingForDriver && (
                <DriverSearchSheet
                    ride={activeRide}
                    offers={validOffers}
                    onlineDrivers={onlineNearby}
                    radiusKm={nearbyDrivers.radiusKm}
                    clock={offerClock}
                    busyId={selectingOfferId}
                    onAccept={acceptOffer}
                    onReject={rejectOffer}
                    onCancel={cancelRide}
                    cancelling={cancelling}
                    onShowMap={() => setFullScreenMap(true)}
                    token={token}
                    pickupLabel={pickupLabel}
                    destinationLabel={destinationLabel}
                />
            )}

            {activeRide && !fullScreenMap && !searchingForDriver && (
                <RideJourneyExperience
                    ride={activeRide}
                    offers={validOffers}
                    busyId={selectingOfferId}
                    onAccept={acceptOffer}
                    onReject={rejectOffer}
                    onCancel={cancelRide}
                    cancelling={cancelling}
                    onShowMap={() => setFullScreenMap(true)}
                    notification={notification}
                    chat={ASSIGNED_STATUSES.includes(activeRide.status)
                        ? <RideChat rideId={activeRide._id} token={token} userId={user?._id || user?.id} /> : null}
                    locationUpdatedAt={driverLocationUpdatedAt}
                    token={token}
                    routeInfo={liveRoute}
                    driverLocationFresh={driverLocationFresh}
                    pickupLabel={pickupLabel}
                    destinationLabel={destinationLabel}
                />
            )}

            {completedRideId && !reviewSubmitted && (
                <TripCompletedDialog
                    key={completedRideId}
                    rideId={completedRideId}
                    ride={completedRide}
                    token={token}
                    pickupLabel={placeLabel(completedRide?.pickup, pickupAddress || "Pickup point")}
                    destinationLabel={placeLabel(completedRide?.destination, destinationQuery || "Destination")}
                    onFinish={finishCompletedTrip}
                />
            )}
            <MobileBottomNav role="PASSENGER" />
        </main>
    );
}

function TripStat({ icon: Icon, label, value }) {
    return (
        <div className="rounded-2xl bg-[#F4F5F7] px-3 py-2.5">
            <p className="flex items-center gap-1 text-[11px] font-semibold text-[#6B7280]">
                <Icon size={12} aria-hidden="true" /> {label}
            </p>
            <p className="mt-0.5 truncate text-sm font-extrabold tabular-nums">{value}</p>
        </div>
    );
}

function VehicleOption({ vehicle, selected, onSelect }) {
    const { name, seats, Icon } = vehicle;
    return (
        <button
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={onSelect}
            className={`relative flex flex-col items-center gap-1 rounded-2xl border-2 px-1 py-3 transition-all active:scale-95 ${selected
                ? "border-[#111111] bg-[#F7FDE6]"
                : "border-transparent bg-[#F4F5F7] hover:bg-[#EEF0F2]"
                }`}
        >
            {selected && (
                <span className="absolute right-1.5 top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-[#111111]">
                    <Check size={10} className="text-[#C1F11D]" strokeWidth={3} />
                </span>
            )}
            <span className={`flex h-10 w-10 items-center justify-center rounded-full ${selected ? "bg-[#C1F11D]" : "bg-white"}`}>
                <Icon size={22} strokeWidth={1.9} aria-hidden="true" />
            </span>
            <span className="text-xs font-bold">{name}</span>
            <span className="flex items-center gap-0.5 text-[10px] font-medium text-[#6B7280]">
                <Users size={10} aria-hidden="true" /> {seats}
            </span>
        </button>
    );
}

function BookingPeek({ destinationLabel, route, onOpen }) {
    return (
        <button
            type="button"
            onClick={onOpen}
            className={`rx-sheet-in absolute inset-x-3 bottom-[calc(80px+env(safe-area-inset-bottom))] z-20 mx-auto flex max-w-lg items-center gap-3 rounded-2xl bg-white p-3 text-left ${FLOATING_SHADOW}`}
        >
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#C1F11D]">
                <MapPin size={20} aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
                <span className="block text-xs font-semibold text-[#6B7280]">{destinationLabel ? "Your trip" : "Ready to ride?"}</span>
                <span className="block truncate text-[15px] font-bold">{destinationLabel || "Where to?"}</span>
            </span>
            {route && <span className="shrink-0 text-xs font-bold text-[#6B7280]">{route.distanceKm} km · {route.durationMinutes} min</span>}
            <ChevronUp size={20} className="shrink-0" aria-hidden="true" />
            <span className="sr-only">Open booking panel</span>
        </button>
    );
}

function MapPickBanner({ target, onCancel }) {
    return (
        <>
            <div className="rx-slide-down absolute inset-x-4 top-[calc(max(16px,env(safe-area-inset-top))+64px)] z-40 mx-auto flex max-w-md items-center gap-3 rounded-2xl bg-[#111111] p-3 pl-4 text-white shadow-xl">
                <Crosshair size={20} className="shrink-0 text-[#C1F11D]" aria-hidden="true" />
                <p className="min-w-0 flex-1 text-sm font-semibold">
                    Tap the map to set your {target === "pickup" ? "pickup point" : "destination"}
                </p>
                <button
                    type="button"
                    onClick={onCancel}
                    className="h-9 shrink-0 rounded-xl bg-white/10 px-3 text-xs font-bold hover:bg-white/20"
                >
                    Cancel
                </button>
            </div>
            <div className="pointer-events-none absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2" aria-hidden="true">
                <span className="block h-10 w-10 rounded-full border-2 border-dashed border-[#111111]/50" />
            </div>
        </>
    );
}

function DriverSearchSheet({
    ride, offers, onlineDrivers, radiusKm, clock, busyId, onAccept, onReject, onCancel,
    cancelling, onShowMap, token, pickupLabel, destinationLabel,
}) {
    const [localStart, setLocalStart] = useState(() => Date.now());
    useEffect(() => { setLocalStart(Date.now()); }, [ride._id]);
    const createdAt = ride.createdAt ? new Date(ride.createdAt).getTime() : NaN;
    const startedAt = Number.isFinite(createdAt) ? createdAt : localStart;
    const elapsedMs = Math.max(0, clock - startedAt);
    const vehicle = getVehicle(ride.vehicleType);
    const VehicleIcon = vehicle?.Icon || Car;
    const sortedOffers = [...offers].sort((a, b) => Number(a.price) - Number(b.price));
    const hasOffers = sortedOffers.length > 0;
    const searchingLong = !hasOffers && elapsedMs >= LONG_SEARCH_MS;

    const title = hasOffers
        ? `${sortedOffers.length} driver${sortedOffers.length > 1 ? "s" : ""} responded`
        : ride.status === "REQUESTED" ? "Sending your request" : "Finding your drivers";
    const subtitle = hasOffers
        ? "Choose the offer that suits you best"
        : onlineDrivers > 0
            ? `Your offer is shown to ${onlineDrivers} driver${onlineDrivers > 1 ? "s" : ""} within ${radiusKm} km`
            : "Looking for drivers in your area";

    return (
        <section
            aria-label="Finding your drivers"
            className="rx-sheet-in absolute inset-x-0 bottom-[calc(68px+env(safe-area-inset-bottom))] z-20 flex max-h-[calc(78dvh-68px)] flex-col rounded-t-[28px] bg-white shadow-[0_-16px_48px_rgba(17,17,17,0.18)]"
        >
            <div className="mx-auto w-full max-w-lg shrink-0 px-4 sm:px-6">
                <button
                    type="button"
                    onClick={onShowMap}
                    aria-label="Minimise and show map"
                    className="mx-auto mb-4 mt-3 block h-1.5 w-10 rounded-full bg-[#E3E5E8]"
                />
                <div className="flex items-center gap-4">
                    <div className="relative flex h-14 w-14 shrink-0 items-center justify-center" aria-hidden="true">
                        {!hasOffers && (
                            <>
                                <span className="rx-radar absolute inset-0 rounded-full bg-[#C1F11D]" />
                                <span className="rx-radar rx-radar-delay absolute inset-0 rounded-full bg-[#C1F11D]" />
                            </>
                        )}
                        <span className="relative flex h-14 w-14 items-center justify-center rounded-full bg-[#111111]">
                            {hasOffers
                                ? <Users size={24} className="text-[#C1F11D]" />
                                : <Radio size={24} className="text-[#C1F11D]" />}
                        </span>
                    </div>
                    <div className="min-w-0 flex-1" aria-live="polite">
                        <h2 className="truncate text-xl font-extrabold tracking-tight">{title}</h2>
                        <p className="mt-0.5 text-sm text-[#6B7280]">{subtitle}</p>
                    </div>
                    <button
                        type="button"
                        onClick={onShowMap}
                        aria-label="View map"
                        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#F4F5F7] transition-colors hover:bg-[#E9EBEE]"
                    >
                        <MapIcon size={19} />
                    </button>
                </div>

                <div className="mt-4 h-1 overflow-hidden rounded-full bg-[#F1F2F4]" role="progressbar" aria-label="Searching for drivers" aria-busy="true">
                    <div className="rx-indeterminate h-full w-2/5 rounded-full bg-[#111111]" />
                </div>

                <div className="mt-3 flex items-center justify-between text-xs font-semibold text-[#6B7280]">
                    <span className="flex items-center gap-1.5">
                        <span className="relative flex h-2 w-2">
                            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-75" />
                            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                        </span>
                        {onlineDrivers} online · {radiusKm} km range
                    </span>
                    <span className="flex items-center gap-1 tabular-nums">
                        <Clock size={12} aria-hidden="true" /> Searching {formatClock(elapsedMs)}
                    </span>
                </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-5 pt-4 sm:px-6">
                <div className="mx-auto max-w-lg">
                    {hasOffers ? (
                        <ul className="space-y-3">
                            {sortedOffers.map((offer, index) => (
                                <li key={getOfferId(offer)}>
                                    <OfferCard
                                        offer={offer}
                                        requestedPrice={Number(ride.requestedPrice)}
                                        rideVehicleType={ride.vehicleType}
                                        isBest={index === 0 && sortedOffers.length > 1}
                                        clock={clock}
                                        busyId={busyId}
                                        onAccept={onAccept}
                                        onReject={onReject}
                                        token={token}
                                    />
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <NearbyDriversWaiting onlineDrivers={onlineDrivers} radiusKm={radiusKm} vehicleType={ride.vehicleType} />
                    )}

                    {searchingLong && (
                        <p className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-900">
                            No offers yet. Drivers may be busy. You can keep waiting, or cancel and request again with a higher fare.
                        </p>
                    )}

                    <div className="mt-4 rounded-2xl border border-[#EEF0F2] p-4">
                        <div className="flex gap-3">
                            <div className="flex flex-col items-center pt-1" aria-hidden="true">
                                <span className="h-3 w-3 rounded-full border-[3px] border-[#111111]" />
                                <span className="my-1 w-0.5 flex-1 rounded-full bg-[#D9DCE0]" />
                                <span className="h-3 w-3 rounded-[3px] bg-[#E5484D]" />
                            </div>
                            <div className="min-w-0 flex-1 space-y-3">
                                <div>
                                    <p className="text-[11px] font-semibold uppercase tracking-wide text-[#9CA3AF]">Pickup</p>
                                    <p className="truncate text-sm font-semibold" title={pickupLabel}>{pickupLabel}</p>
                                </div>
                                {(ride.stops || []).length > 0 && (
                                    <p className="text-xs font-semibold text-[#6B7280]">
                                        + {ride.stops.length} stop{ride.stops.length > 1 ? "s" : ""}
                                    </p>
                                )}
                                <div>
                                    <p className="text-[11px] font-semibold uppercase tracking-wide text-[#9CA3AF]">Drop-off</p>
                                    <p className="truncate text-sm font-semibold" title={destinationLabel}>{destinationLabel}</p>
                                </div>
                            </div>
                        </div>
                        <div className="mt-4 flex items-center justify-between border-t border-[#EEF0F2] pt-3">
                            <span className="flex items-center gap-2 text-sm font-semibold text-[#374151]">
                                <VehicleIcon size={18} aria-hidden="true" />
                                {vehicle?.name || "Ride"}
                                <span className="text-[#D1D5DB]">·</span>
                                <Banknote size={16} aria-hidden="true" /> Cash
                            </span>
                            <span className="rounded-full bg-[#F7FDE6] px-3 py-1 text-sm font-extrabold">
                                {formatPKR(ride.requestedPrice)}
                            </span>
                        </div>
                    </div>

                    <button
                        type="button"
                        onClick={onCancel}
                        disabled={cancelling}
                        className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[#F4F5F7] text-sm font-bold text-[#E5484D] transition-colors hover:bg-[#FDECEC] disabled:opacity-50"
                    >
                        <X size={18} aria-hidden="true" />
                        {cancelling ? "Cancelling..." : "Cancel request"}
                    </button>
                </div>
            </div>
        </section>
    );
}

function NearbyDriversWaiting({ onlineDrivers, radiusKm, vehicleType }) {
    const visibleAvatars = Math.min(Math.max(onlineDrivers, 0), 5);
    const VehicleIcon = getVehicle(vehicleType)?.Icon || Car;

    if (onlineDrivers === 0) {
        return (
            <div className="rounded-2xl border border-[#EEF0F2] bg-[#F7F8F9] p-5 text-center">
                <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-white shadow-sm">
                    <VehicleIcon size={22} className="text-[#6B7280]" aria-hidden="true" />
                </span>
                <p className="mt-3 text-sm font-bold">No drivers online in your area yet</p>
                <p className="mx-auto mt-1 max-w-xs text-xs leading-relaxed text-[#6B7280]">
                    We&apos;re still searching within {radiusKm} km and will alert you the moment a driver sends an offer.
                </p>
            </div>
        );
    }

    return (
        <div>
            <div className="flex items-center gap-3 rounded-2xl bg-[#F4F5F7] p-4">
                <div className="flex -space-x-2.5" aria-hidden="true">
                    {Array.from({ length: visibleAvatars }).map((_, index) => (
                        <span
                            key={index}
                            className="rx-slide-up flex h-9 w-9 items-center justify-center rounded-full border-2 border-[#F4F5F7] bg-[#111111]"
                            style={{ animationDelay: `${index * 90}ms` }}
                        >
                            <VehicleIcon size={15} className="text-[#C1F11D]" />
                        </span>
                    ))}
                    {onlineDrivers > visibleAvatars && (
                        <span className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-[#F4F5F7] bg-white text-[11px] font-extrabold">
                            +{onlineDrivers - visibleAvatars}
                        </span>
                    )}
                </div>
                <p className="min-w-0 text-xs font-medium leading-relaxed text-[#374151]">
                    {onlineDrivers} driver{onlineDrivers > 1 ? "s are" : " is"} online within range and can see your request. Map pins show approximate areas only.
                </p>
            </div>

            <div className="mt-3 space-y-2.5" aria-hidden="true">
                {[0, 1].map((item) => (
                    <div key={item} className="flex items-center gap-3 rounded-2xl border border-[#EEF0F2] p-3.5" style={{ opacity: 1 - item * 0.4 }}>
                        <div className="rx-shimmer h-11 w-11 shrink-0 rounded-full" />
                        <div className="flex-1 space-y-2">
                            <div className="rx-shimmer h-3 w-2/5 rounded-full" />
                            <div className="rx-shimmer h-2.5 w-3/5 rounded-full" />
                        </div>
                        <div className="rx-shimmer h-7 w-16 rounded-lg" />
                    </div>
                ))}
            </div>
        </div>
    );
}

function OfferCard({ offer, requestedPrice, rideVehicleType, isBest, clock, busyId, onAccept, onReject, token }) {
    const [showProfile, setShowProfile] = useState(false);
    const offerId = getOfferId(offer);
    const driver = describeDriver(offer.driverId);
    const name = driver.name || "Driver";
    const price = Number(offer.price);
    const priceDiff = Number.isFinite(requestedPrice) ? price - requestedPrice : 0;
    const VehicleIcon = getVehicle(driver.vehicleType || rideVehicleType)?.Icon || Car;

    const expiresAt = offer.expiresAt ? new Date(offer.expiresAt).getTime() : null;
    const createdAt = offer.createdAt ? new Date(offer.createdAt).getTime() : null;
    const remainingMs = expiresAt ? Math.max(0, expiresAt - clock) : null;
    const windowMs = expiresAt && createdAt && expiresAt > createdAt ? expiresAt - createdAt : DEFAULT_OFFER_WINDOW_MS;
    const remainingRatio = remainingMs != null ? Math.min(1, remainingMs / windowMs) : null;
    const urgent = remainingMs != null && remainingMs < 15000;

    const eta = offer.etaMinutes ?? offer.eta ?? offer.arrivalMinutes;
    const distance = offer.distanceKm ?? offer.driverDistanceKm;
    const busy = Boolean(busyId);
    const thisBusy = String(busyId) === offerId;

    return (
        <article
            className={`rx-slide-up overflow-hidden rounded-2xl border bg-white shadow-[0_4px_18px_rgba(17,17,17,0.06)] ${isBest ? "border-[#111111]" : "border-[#EEF0F2]"}`}
            aria-label={`Offer from ${name}, ${formatPKR(price)}`}
        >
            {remainingRatio != null && (
                <div className="h-1 bg-[#F1F2F4]" aria-hidden="true">
                    <div
                        className={`h-full transition-[width] duration-1000 ease-linear ${urgent ? "bg-[#E5484D]" : "bg-[#111111]"}`}
                        style={{ width: `${remainingRatio * 100}%` }}
                    />
                </div>
            )}

            <div className="p-4">
                <div className="flex items-start gap-3">
                    <span className="relative shrink-0" aria-hidden="true">
                        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[#111111] text-sm font-extrabold text-[#C1F11D]">
                            {getInitials(name)}
                        </span>
                        <span className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-[#C1F11D]">
                            <VehicleIcon size={12} />
                        </span>
                    </span>
                    <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                            <p className="truncate text-base font-bold">{name}</p>
                            {isBest && (
                                <span className="shrink-0 rounded-full bg-[#C1F11D] px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide">
                                    Best price
                                </span>
                            )}
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-[#6B7280]">
                            <span className="flex items-center gap-1 font-semibold text-[#111111]">
                                <Star size={12} className="fill-[#F5A524] text-[#F5A524]" aria-hidden="true" />
                                {driver.rating != null ? Number(driver.rating).toFixed(1) : "New"}
                            </span>
                            {driver.trips != null && <span>{driver.trips} trips</span>}
                            {driver.vehicleText && <span className="truncate">{driver.vehicleText}</span>}
                        </div>
                        {driver.plate && (
                            <span className="mt-1.5 inline-block rounded-md border border-[#E3E5E8] bg-[#F7F8F9] px-1.5 py-0.5 font-mono text-[11px] font-bold tracking-wider">
                                {driver.plate}
                            </span>
                        )}
                    </div>
                    <div className="shrink-0 text-right">
                        <p className="text-xl font-extrabold tabular-nums tracking-tight">{formatPKR(price)}</p>
                        {priceDiff !== 0 && Number.isFinite(priceDiff) && (
                            <p className={`text-[11px] font-bold ${priceDiff > 0 ? "text-amber-700" : "text-emerald-700"}`}>
                                {priceDiff > 0 ? `+${priceDiff}` : priceDiff} vs your fare
                            </p>
                        )}
                        {priceDiff === 0 && <p className="text-[11px] font-bold text-emerald-700">Your fare</p>}
                    </div>
                </div>

                {(eta != null || distance != null || remainingMs != null) && (
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs font-semibold">
                        {eta != null && (
                            <span className="flex items-center gap-1 rounded-full bg-[#F4F5F7] px-2.5 py-1">
                                <Clock size={12} aria-hidden="true" /> {eta} min away
                            </span>
                        )}
                        {distance != null && (
                            <span className="flex items-center gap-1 rounded-full bg-[#F4F5F7] px-2.5 py-1">
                                <Navigation size={12} aria-hidden="true" /> {Number(distance).toFixed(1)} km
                            </span>
                        )}
                        {remainingMs != null && (
                            <span className={`ml-auto tabular-nums ${urgent ? "text-[#E5484D]" : "text-[#6B7280]"}`} aria-live="off">
                                Expires in {formatClock(remainingMs)}
                            </span>
                        )}
                    </div>
                )}

                {driver.id && (
                    <div className="mt-3">
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

                <div className="mt-4 flex gap-2">
                    <button
                        type="button"
                        disabled={busy}
                        onClick={() => onReject(offerId)}
                        className="h-12 flex-1 rounded-xl bg-[#F4F5F7] text-sm font-bold text-[#374151] transition-colors hover:bg-[#E9EBEE] disabled:opacity-50"
                    >
                        Decline
                    </button>
                    <button
                        type="button"
                        disabled={busy}
                        onClick={() => onAccept(offerId)}
                        className="flex h-12 flex-[2] items-center justify-center gap-1.5 rounded-xl bg-[#C1F11D] text-sm font-extrabold text-[#111111] shadow-[0_6px_18px_rgba(140,180,0,0.3)] transition-all active:scale-[0.98] disabled:opacity-50"
                    >
                        {thisBusy ? "Please wait..." : <>Accept for {formatPKR(price)}</>}
                    </button>
                </div>
            </div>
        </article>
    );
}

function TripCompletedDialog({ rideId, ride, token, pickupLabel, destinationLabel, onFinish }) {
    const [step, setStep] = useState("summary");
    const vehicle = getVehicle(ride?.vehicleType);
    const VehicleIcon = vehicle?.Icon || Car;
    const driver = describeDriver(ride?.driverId);
    const fare = ride?.finalPrice ?? ride?.requestedPrice;
    const distanceKm = Number(ride?.distanceKm);
    const stopCount = Array.isArray(ride?.stops) ? ride.stops.length : 0;

    return (
        <div
            className="fixed inset-0 z-[90] flex items-end justify-center bg-[#111111]/60 px-3 pb-3 backdrop-blur-sm sm:items-center sm:py-8"
            role="dialog"
            aria-modal="true"
            aria-label={step === "summary" ? "Trip completed" : "Rate your driver"}
        >
            <div className="rx-sheet-in max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-[28px] bg-white p-5 shadow-2xl">
                {step === "summary" ? (
                    <>
                        <div className="text-center">
                            <span className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-[#C1F11D]">
                                <Check size={30} strokeWidth={3} className="text-[#111111]" aria-hidden="true" />
                            </span>
                            <h2 className="text-xl font-extrabold tracking-tight">You&apos;ve arrived!</h2>
                            <p className="mt-1 text-sm text-[#6B7280]">Thanks for riding with us.</p>
                        </div>

                        {fare != null && (
                            <div className="mt-5 rounded-2xl bg-[#111111] p-4 text-center text-white">
                                <p className="text-xs font-semibold text-white/60">Total fare · Cash</p>
                                <p className="mt-1 text-3xl font-extrabold tabular-nums text-[#C1F11D]">{formatPKR(fare)}</p>
                            </div>
                        )}

                        <div className="mt-4 rounded-2xl border border-[#EEF0F2] p-4">
                            <div className="flex gap-3">
                                <div className="flex flex-col items-center pt-1" aria-hidden="true">
                                    <span className="h-3 w-3 rounded-full border-[3px] border-[#111111]" />
                                    <span className="my-1 w-0.5 flex-1 rounded-full bg-[#D9DCE0]" />
                                    <span className="h-3 w-3 rounded-[3px] bg-[#E5484D]" />
                                </div>
                                <div className="min-w-0 flex-1 space-y-2.5">
                                    <p className="truncate text-sm font-semibold" title={pickupLabel}>{pickupLabel}</p>
                                    {stopCount > 0 && <p className="text-xs font-semibold text-[#6B7280]">{stopCount} stop{stopCount > 1 ? "s" : ""} on the way</p>}
                                    <p className="truncate text-sm font-semibold" title={destinationLabel}>{destinationLabel}</p>
                                </div>
                            </div>
                            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[#EEF0F2] pt-3 text-xs font-semibold text-[#374151]">
                                <span className="flex items-center gap-1.5 rounded-full bg-[#F4F5F7] px-2.5 py-1">
                                    <VehicleIcon size={13} aria-hidden="true" /> {vehicle?.name || "Ride"}
                                </span>
                                {Number.isFinite(distanceKm) && distanceKm > 0 && (
                                    <span className="flex items-center gap-1.5 rounded-full bg-[#F4F5F7] px-2.5 py-1">
                                        <RouteIcon size={13} aria-hidden="true" /> {distanceKm} km
                                    </span>
                                )}
                                {driver.name && (
                                    <span className="flex items-center gap-1.5 rounded-full bg-[#F4F5F7] px-2.5 py-1">
                                        <UserRound size={13} aria-hidden="true" /> {driver.name}
                                    </span>
                                )}
                            </div>
                        </div>

                        <button
                            type="button"
                            onClick={() => setStep("rate")}
                            className="mt-5 flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-[#C1F11D] text-base font-extrabold text-[#111111] transition-transform active:scale-[0.98]"
                        >
                            <Star size={18} aria-hidden="true" /> Rate your driver
                        </button>
                        <button
                            type="button"
                            onClick={() => onFinish({ rated: false })}
                            className="mt-2 w-full rounded-2xl bg-[#F4F5F7] py-3.5 font-bold text-[#374151] transition-colors hover:bg-[#E9EBEE]"
                        >
                            Done
                        </button>
                    </>
                ) : (
                    <>
                        <div className="mb-4 text-center">
                            <span className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-[#111111] text-sm font-extrabold text-[#C1F11D]" aria-hidden="true">
                                {getInitials(driver.name)}
                            </span>
                            <h2 className="text-xl font-extrabold tracking-tight">How was {driver.name || "your driver"}?</h2>
                            <p className="mt-1 text-sm text-[#6B7280]">Your review is optional and helps other passengers.</p>
                        </div>
                        <DriverRating rideId={rideId} token={token} onSuccess={() => onFinish({ rated: true })} />
                        <button
                            type="button"
                            onClick={() => onFinish({ rated: false })}
                            className="mt-3 w-full rounded-2xl bg-[#F4F5F7] py-3.5 font-bold text-[#374151] transition-colors hover:bg-[#E9EBEE]"
                        >
                            Skip for now
                        </button>
                    </>
                )}
            </div>
        </div>
    );
}
