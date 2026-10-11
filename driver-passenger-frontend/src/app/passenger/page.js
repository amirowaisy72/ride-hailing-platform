"use client";
import { useEffect, useRef, useState } from "react";
import {
    MapPin, ArrowRight, Bell, CarFront, LocateFixed, Volume2, VolumeX, Maximize2, Minimize2
} from "lucide-react";
import AuthGuard from "@/components/AuthGuard";
import { useAuth } from "@/context/AuthContext";
import { getRealtimeSocket } from "@/lib/socket";
import { BRAND } from "@/config/brand";
import DriverRating from "@/components/DriverRating";
import DriverProfileCard from "@/components/DriverProfileCard";
import RideJourneyExperience from "@/components/RideJourneyExperience";
import Link from "next/link";
import { UserRound } from "lucide-react";
import { Geolocation } from "@capacitor/geolocation";
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
import {
    PickupLocationSearch,
    MapViewControl,
    SearchingDrivers,
} from "@/components/PassengerBookingExperience";
import RideStopsEditor from "@/components/RideStopsEditor";
export default function PassengerPage() {
    return (
        <AuthGuard role="PASSENGER">
            <PassengerDashboard />
        </AuthGuard>
    );
}
function PassengerDashboard() {
    const { user, token } = useAuth();
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
    const [completedRideId, setCompletedRideId] = useState(null);
    const [reviewSubmitted, setReviewSubmitted] = useState(false);
    const activeRideId = activeRide?._id?.toString();
    const { driverLocation, driverLocationUpdatedAt } = useLiveDriverLocation(activeRideId, token, Boolean(activeRide?.driverId || ["DRIVER_SELECTED", "DRIVER_EN_ROUTE", "DRIVER_ARRIVED", "TRIP_STARTED"].includes(activeRide?.status)));
    const searchingForDriver = Boolean(activeRide && ["REQUESTED", "SEARCHING", "BIDDING"].includes(activeRide.status));
    const nearbyDrivers = useNearbyDrivers(activeRideId, token, searchingForDriver);
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
        if (!rideId || !token || !["REQUESTED", "SEARCHING", "BIDDING"].includes(activeRide.status)) {
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
                    passengerCount: 1,
                    stops: stops.map(({ latitude, longitude, name }) => ({
                        latitude,
                        longitude,
                        name,
                    })),
                }),
            });
            setOffers([]);
            setActiveRide(data.ride);
            setNotification("Ride requested! Waiting for driver offers.");
        } catch (error) {
            setNotification(error.message);
        } finally {
            setBooking(false);
        }
    }
    const vehicles = [
        { id: "BIKE", name: "Motorcycle", icon: "🏍️" },
        { id: "RICKSHAW", name: "Rickshaw", icon: "🛺" },
        { id: "CAR_NON_AC", name: "Car Non-AC", icon: "🚗" },
        { id: "CAR_AC", name: "Car AC", icon: "🚘" },
    ];
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
            console.log("GPS Accuracy (meters):", position.coords.accuracy);
        } catch (error) {
            console.error("GPS Error:", error);
            setNotification(error.message || "Unable to detect location.");
        } finally {
            setLocating(false);
        }
    }
    const [notification, setNotification] = useState("");
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
    return (
        <main className="relative h-dvh w-full overflow-hidden bg-[#F8FAF9] text-[#111827]">
            <div className="absolute inset-0">
                <RideMap
                    userLocation={activeRide?.pickup || userLocation}
                    locateRequest={mapLocateRequest}
                    driverLocation={driverLocation}
                    nearbyDriverCells={searchingForDriver ? nearbyDrivers.cells : []}
                    navigationMode={Boolean(activeRide && ["DRIVER_SELECTED", "DRIVER_EN_ROUTE", "DRIVER_ARRIVED", "TRIP_STARTED"].includes(activeRide.status))}
                    followDriver={Boolean(driverLocation && activeRide?.status === "DRIVER_EN_ROUTE")}
                    destination={activeRide
                        ? (["DRIVER_SELECTED", "DRIVER_EN_ROUTE"].includes(activeRide.status) ? activeRide.pickup : activeRide.destination)
                        : destination}
                    stops={activeRide ? (activeRide.status === "TRIP_STARTED" ? (activeRide.stops || []).slice(activeRide.stopsCompleted || 0) : []) : stops}
                    onPickupChange={!activeRide ? (position) => {
                        setManualPickup(false);
                        setUserLocation(position);
                        setNotification("Pickup updated on the map.");
                    } : null}
                />
            </div>
            {searchingForDriver && (
                <div className="pointer-events-none absolute left-1/2 top-[95px] z-20 -translate-x-1/2 rounded-full bg-white/95 px-4 py-2 text-center text-xs font-semibold text-emerald-800 shadow-lg">
                    {nearbyDrivers.onlineDrivers} online nearby · approximate locations
                </div>
            )}
            <header className="absolute inset-x-0 top-0 z-10 flex items-center justify-between px-5 pb-4 pt-[max(20px,env(safe-area-inset-top))]">
                <div className="flex items-center gap-2 rounded-2xl bg-white/95 px-2 py-2 shadow-lg">
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#087F5B] font-bold text-white">
                        {BRAND.shortName}
                    </div>

                    <Link
                        href="/passenger/account"
                        aria-label="My Account"
                        className="ml-2 flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-50 text-[#087F5B]"
                    >
                        <UserRound size={20} />
                    </Link>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        aria-label={soundEnabled ? "Mute ride alerts" : "Enable ride alert sound"}
                        title={soundEnabled ? "Mute alerts" : "Enable alerts"}
                        onClick={toggleSound}
                        className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white shadow-lg"
                    >
                        {soundEnabled ? <Volume2 size={20} className="text-[#087F5B]" /> : <VolumeX size={20} />}
                    </button>
                    <button
                        type="button"
                        onClick={() => setNotification((message) => message ? "" : "No new notifications")}
                        aria-label="Notifications"
                        className="relative flex h-12 w-12 items-center justify-center rounded-2xl bg-white shadow-lg"
                    >
                        <Bell size={22} />
                        {notification && (
                            <span className="absolute right-3 top-3 h-2 w-2 rounded-full bg-[#087F5B]" />
                        )}
                    </button>
                </div>
            </header>
            <div className="absolute right-5 top-28 z-10">
                <button
                    type="button"
                    aria-label="Locate me"
                    onClick={locateMe}
                    disabled={locating}
                    className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white shadow-lg"
                >
                    <LocateFixed size={22} className="text-[#087F5B]" />
                </button>
            </div>
            {!activeRide && <div className={`absolute right-4 z-20 transition-all duration-300 ${fullScreenMap
                    ? "bottom-[calc(88px+env(safe-area-inset-bottom))]"
                    : "bottom-[calc(80dvh-68px+env(safe-area-inset-bottom))]"
                }`}>
                <button type="button" onClick={() => setFullScreenMap(v => !v)} aria-label={fullScreenMap ? "Restore booking panel" : "Expand map"} className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-emerald-700 shadow-lg">{fullScreenMap ? <Minimize2 size={20} /> : <Maximize2 size={20} />}</button>
            </div>}
            <section
                aria-hidden={fullScreenMap || Boolean(activeRide)}
                inert={fullScreenMap || Boolean(activeRide)}
                className={`absolute inset-x-0 bottom-[calc(68px+env(safe-area-inset-bottom))] z-10 max-h-[calc(76dvh-68px)] overflow-y-auto overscroll-contain rounded-t-[32px] bg-white px-4 pb-6 pt-5 shadow-[0_-12px_45px_rgba(0,0,0,0.12)] transition-transform duration-300 sm:px-6 ${(fullScreenMap || activeRide) ? "translate-y-[120%] pointer-events-none" : ""}`}
            >
                <div className="mx-auto mb-6 h-1.5 w-12 rounded-full bg-gray-200" />
                <div className="mb-5 flex items-center justify-between">
                    <div>
                        <p className="text-sm text-gray-500">
                            Hello, {user?.firstName || "Passenger"} 👋
                        </p>
                        <h1 className="mt-1 text-2xl font-extrabold">
                            {currentCity
                                ? `Where to in ${currentCity}?`
                                : "Where to today?"}
                        </h1>
                    </div>
                    <CarFront size={30} className="text-[#087F5B]" />
                </div>
                <div className="space-y-3 rounded-2xl border border-gray-100 bg-[#F8FAF9] p-4">
                    <PickupLocationSearch
                        token={token}
                        currentLocation={userLocation}
                        pickupAddress={
                            pickupAddress ||
                            (locating ? "Detecting location..." : "")
                        }
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
                    <div className="ml-2 h-5 border-l-2 border-dashed border-gray-300" />
                    <div className="flex items-center gap-3">
                        <MapPin size={19} className="shrink-0 text-red-500" />
                        <input
                            type="text"
                            value={destinationQuery}
                            onChange={(e) => {
                                setDestinationQuery(e.target.value);
                                setDestination(null);
                                setDestinationSelected(false);
                            }}
                            placeholder="Where do you want to go?"
                            className="min-w-0 flex-1 bg-transparent text-sm outline-none"
                        />
                    </div>
                    {searching && (
                        <p className="text-sm text-gray-500">Searching...</p>
                    )}
                    {searchResults.length > 0 && (
                        <div className="max-h-48 overflow-y-auto rounded-xl bg-white shadow-lg">
                            {searchResults.map((place, index) => (
                                <button
                                    key={place.place_id || index}
                                    type="button"
                                    onClick={() => {
                                        setDestination(place);
                                        setDestinationSelected(true);
                                        setDestinationQuery(place.name);
                                        setSearchResults([]);
                                    }}
                                    className="block w-full border-b p-3 text-left text-sm hover:bg-emerald-50"
                                >
                                    <span className="block truncate font-semibold">{place.name || "Selected location"}</span>
                                    {place.display_name && place.display_name !== place.name && (
                                        <span className="mt-0.5 block truncate text-xs text-slate-500" title={place.display_name}>
                                            {place.display_name.split(",").slice(1, 3).map((part) => part.trim()).filter(Boolean).join(", ")}
                                        </span>
                                    )}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
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
                {citySupported === false && (
                    <p className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
                        Service is currently unavailable at your pickup
                        location. Please select a pickup inside an active
                        service area.
                    </p>
                )}
                {route && (
                    <div className="mt-5 space-y-4">
                        <div className="flex justify-between text-sm">
                            <span>{route.distanceKm} km</span>
                            <span>{route.durationMinutes} min estimated</span>
                        </div>
                        <h3 className="font-bold">Choose your vehicle</h3>
                        <div className="grid grid-cols-2 gap-3">
                            {vehicles.map((vehicle) => (
                                <button
                                    key={vehicle.id}
                                    type="button"
                                    onClick={() => setVehicleType(vehicle.id)}
                                    className={`rounded-2xl border-2 p-4 text-left ${vehicleType === vehicle.id
                                        ? "border-[#087F5B] bg-emerald-50"
                                        : "border-gray-200 bg-white"
                                        }`}
                                >
                                    <span className="text-2xl">{vehicle.icon}</span>
                                    <p className="mt-2 text-sm font-semibold">{vehicle.name}</p>
                                </button>
                            ))}
                        </div>
                        <div className="rounded-2xl bg-emerald-50 p-4">
                            <p className="text-sm text-gray-600">Suggested Fare</p>
                            <p className="text-2xl font-extrabold text-[#087F5B]">
                                {fareLoading
                                    ? "Calculating..."
                                    : fare
                                        ? `PKR ${fare.suggestedFare}`
                                        : "Fare unavailable"}
                            </p>
                            {fare && (
                                <div className="mt-4">
                                    <label className="mb-2 block text-sm font-semibold">
                                        Your Offer (PKR)
                                    </label>
                                    <input
                                        type="number"
                                        min="1"
                                        step="1"
                                        value={proposedFare}
                                        onChange={(e) => setProposedFare(e.target.value)}
                                        className="h-12 w-full rounded-xl border border-emerald-200 bg-white px-4 text-lg font-bold outline-none focus:border-[#087F5B]"
                                    />
                                    <p className="mt-2 text-xs text-gray-500">
                                        Adjust your fare before requesting a ride.
                                    </p>
                                </div>
                            )}
                        </div>
                    </div>
                )}
                <button
                    type="button"
                    onClick={bookRide}
                    disabled={booking || rideRestoring || !route || !fare || fareLoading || routeLoading || !!activeRide}
                    className="mt-5 flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-[#087F5B] font-bold text-white shadow-lg shadow-emerald-900/15"
                >
                    {booking
                        ? "Requesting Ride..."
                        : activeRide
                            ? "Ride Requested"
                            : "Find a Ride"}
                    <ArrowRight size={20} />
                </button>
                {notification && (
                    <p role="status" className="mt-4 rounded-xl bg-emerald-50 p-3 text-sm text-[#065F46]">
                        {notification}
                    </p>
                )}
                <div className="mt-4">
                    <SearchingDrivers
                        ride={activeRide}
                        offerCount={validOffers.length}
                    />
                </div>
                {activeRide && (
                    <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                        <p className="font-bold text-[#065F46]">
                            {({
                                REQUESTED: "Finding Nearby Drivers",
                                SEARCHING: "Searching for Drivers",
                                BIDDING: "Waiting for Driver Offers",
                                DRIVER_SELECTED: "Driver Confirmed",
                                DRIVER_EN_ROUTE: "Driver Heading to Pickup",
                                DRIVER_ARRIVED: "Driver Has Arrived",
                                TRIP_STARTED: "Trip in Progress",
                                TRIP_COMPLETED: "Trip Completed",
                            })[activeRide.status] || "Ride in Progress"}
                        </p>
                        <p className="mt-1 text-sm text-gray-600">
                            Your offer: PKR {activeRide.requestedPrice}
                        </p>
                    </div>
                )}
                {activeRide &&
                    ["REQUESTED", "SEARCHING", "BIDDING"].includes(activeRide.status) && (
                        <button
                            type="button"
                            onClick={cancelRide}
                            disabled={cancelling}
                            className="mt-4 w-full rounded-2xl border border-red-200 bg-red-50 px-4 py-3 font-semibold text-red-600 disabled:opacity-50"
                        >
                            {cancelling ? "Cancelling..." : "Cancel Ride"}
                        </button>
                    )}

                {activeRide && ["REQUESTED", "SEARCHING", "BIDDING"].includes(activeRide.status) && validOffers.length > 0 && (
                    <div className="mt-5 space-y-3">
                        <h2 className="font-bold">Driver Offers</h2>
                        {validOffers.map((offer, index) => (
                            <div key={offer._id || offer.offerId || index} className="rounded-xl border p-4">
                                <p className="font-semibold">
                                    PKR {offer.price}
                                </p>
                                <p className="mt-1 text-sm font-semibold">
                                    {[
                                        offer.driverId?.userId?.firstName,
                                        offer.driverId?.userId?.lastName,
                                    ].filter(Boolean).join(" ") || "Driver"}
                                </p>
                                {offer.expiresAt && (
                                    <p className="mt-2 text-xs font-semibold text-amber-700" aria-live="off">
                                        Offer expires in {Math.floor(Math.max(0, new Date(offer.expiresAt).getTime() - offerClock) / 60000)}:{String(Math.floor(Math.max(0, new Date(offer.expiresAt).getTime() - offerClock) / 1000) % 60).padStart(2, "0")}
                                    </p>
                                )}
                                <p className="text-xs text-gray-500">
                                    {offer.driverId?.rating != null
                                        ? `⭐ ${offer.driverId.rating}`
                                        : "Rating unavailable"}
                                </p>
                                <>
                                    <DriverProfileCard
                                        driverId={
                                            typeof offer.driverId === "object"
                                                ? offer.driverId?._id
                                                : offer.driverId
                                        }
                                        token={token}
                                    />
                                    <div className="mt-3 grid grid-cols-2 gap-2">
                                        <button
                                            type="button"
                                            disabled={!!selectingOfferId}
                                            onClick={() => rejectOffer(offer._id || offer.offerId)}
                                            className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 font-semibold text-red-700 disabled:opacity-50"
                                        >
                                            Reject
                                        </button>
                                        <button
                                            type="button"
                                            disabled={!!selectingOfferId || activeRide?.status === "DRIVER_SELECTED"}
                                            onClick={() => acceptOffer(offer._id || offer.offerId)}
                                            className="mt-3 w-full rounded-xl bg-[#087F5B] px-4 py-3 font-semibold text-white disabled:opacity-50"
                                        >
                                            {selectingOfferId === offer.offerId
                                                ? "Selecting..."
                                                : "Accept Offer"}
                                        </button>
                                    </div>
                                </>
                            </div>
                        ))}
                    </div>
                )}
            </section>
            {activeRide && fullScreenMap && <button type="button" onClick={() => setFullScreenMap(false)} aria-label="Show ride details" className="absolute bottom-[calc(88px+env(safe-area-inset-bottom))] right-4 z-30 flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-emerald-700 shadow-lg"><Minimize2 size={20} /></button>}
            {activeRide && !fullScreenMap && <RideJourneyExperience
                ride={activeRide}
                offers={validOffers}
                busyId={selectingOfferId}
                onAccept={acceptOffer}
                onReject={rejectOffer}
                onCancel={cancelRide}
                cancelling={cancelling}
                onShowMap={() => setFullScreenMap(true)}
                notification={notification}
                chat={activeRide && ["DRIVER_SELECTED", "DRIVER_EN_ROUTE", "DRIVER_ARRIVED", "TRIP_STARTED"].includes(activeRide.status)
                    ? <RideChat rideId={activeRide._id} token={token} userId={user?._id || user?.id} /> : null}
                locationUpdatedAt={driverLocationUpdatedAt}
            />}
            {completedRideId && !reviewSubmitted && (
                <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/60 px-4 py-8 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Trip completed - optional rating">
                    <div className="w-full max-w-md rounded-[28px] bg-white p-5 shadow-2xl">
                        <div className="mb-4 text-center">
                            <span className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-full bg-emerald-100 text-2xl text-emerald-700">✓</span>
                            <h2 className="text-xl font-extrabold text-slate-900">Trip completed!</h2>
                            <p className="mt-1 text-sm text-slate-500">Your review is optional.</p>
                        </div>
                        <DriverRating rideId={completedRideId} token={token} onSuccess={() => {
                            setReviewSubmitted(true);
                            setCompletedRideId(null);
                            setNotification("Thank you for rating your driver!");
                        }} />
                        <button type="button" onClick={() => { setReviewSubmitted(true); setCompletedRideId(null); }}
                            className="mt-4 w-full rounded-2xl border border-slate-200 py-3 font-bold text-slate-600">
                            Skip for now
                        </button>
                    </div>
                </div>
            )}
            <MobileBottomNav role="PASSENGER" />
        </main>
    );
}
