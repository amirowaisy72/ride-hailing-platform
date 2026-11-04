"use client";

import "../../driver/driver-experience.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DriverMap from "@/components/driver/map/DriverMap";
import NavigationBanner from "@/components/driver/map/NavigationBanner";
import RideRequestCard from "@/components/driver/ride/RideRequestCard";
import TripStepPanel, { TRIP_PANEL_HEIGHT } from "@/components/driver/ride/TripStepPanel";
import RideReturnBanner from "@/components/driver/ride/RideReturnBanner";
import { distanceMeters, fetchOsrmRoute } from "@/components/driver/map/navMath";

const START = [74.3392, 31.5105];
const PICKUP = { address: "Gulberg III, Main Boulevard, Lahore", coordinates: [74.3445, 31.5188] };
const DROPOFF = { address: "Lahore Airport, Departures Gate", coordinates: [74.4055, 31.5204] };

const RIDES = [
    { rideId: "r1", passengerName: "Ayesha Khan", vehicleType: "CAR", tripType: "ONE_WAY", requestedPrice: 450, distance: 5.2, pickup: PICKUP, destination: DROPOFF, stops: [] },
    { rideId: "r2", passengerName: "Bilal Ahmed", vehicleType: "CAR", tripType: "ONE_WAY", requestedPrice: 320, distance: 3.4, pickup: { address: "Model Town Park", coordinates: [74.3275, 31.4825] }, destination: DROPOFF, stops: [] },
    { rideId: "r3", passengerName: "Sana Malik", vehicleType: "CAR", tripType: "ONE_WAY", requestedPrice: 780, distance: 9.1, pickup: { address: "Liberty Market", coordinates: [74.3512, 31.5098] }, destination: DROPOFF, stops: [] },
];

const MODES = [
    { id: "idle", label: "Rides nearby" },
    { id: "pickup", label: "To pickup" },
    { id: "trip", label: "To drop-off" },
];
const VEHICLES = ["CAR", "BIKE", "RICKSHAW"];

// Used only when the public routing service cannot be reached from the preview.
function syntheticRoute(from, to) {
    const corner = [to[0], from[1]];
    const coords = [from, corner, to];
    const a = distanceMeters(from, corner);
    const b = distanceMeters(corner, to);
    return {
        geometry: { coordinates: coords },
        distance: a + b,
        duration: (a + b) / 9,
        legs: [{
            steps: [
                { distance: a, name: "Main Boulevard", maneuver: { type: "depart", modifier: "straight" } },
                { distance: b, name: "Airport Road", maneuver: { type: "turn", modifier: "left" } },
                { distance: 0, name: "", maneuver: { type: "arrive" } },
            ],
        }],
    };
}

function pointAlong(coords, meters) {
    let left = meters;
    for (let i = 1; i < coords.length; i += 1) {
        const seg = distanceMeters(coords[i - 1], coords[i]);
        if (left <= seg) {
            const t = seg === 0 ? 0 : left / seg;
            return [coords[i - 1][0] + (coords[i][0] - coords[i - 1][0]) * t, coords[i - 1][1] + (coords[i][1] - coords[i - 1][1]) * t];
        }
        left -= seg;
    }
    return coords[coords.length - 1];
}

export default function MapDemo() {
    const [mode, setMode] = useState("idle");
    const [vehicle, setVehicle] = useState("CAR");
    const [driver, setDriver] = useState({ longitude: START[0], latitude: START[1] });
    const [info, setInfo] = useState(null);
    const [selected, setSelected] = useState(null);
    const [viewportH, setViewportH] = useState(800);
    const routeCoordsRef = useRef(null);
    const travelledRef = useRef(0);

    useEffect(() => {
        const update = () => setViewportH(window.innerHeight || 800);
        update();
        window.addEventListener("resize", update);
        return () => window.removeEventListener("resize", update);
    }, []);

    const target = mode === "pickup" ? PICKUP : mode === "trip" ? DROPOFF : null;
    const routeProvider = useCallback(async (from, to, signal) => {
        let route;
        try {
            route = await fetchOsrmRoute(from, to, signal);
        } catch (error) {
            if (error?.name === "AbortError") throw error;
            route = syntheticRoute(from, to);
        }
        routeCoordsRef.current = route.geometry.coordinates;
        travelledRef.current = 0;
        return route;
    }, []);

    function chooseMode(next) {
        setMode(next);
        setSelected(null);
        setInfo(null);
        routeCoordsRef.current = null;
        const from = next === "trip" ? PICKUP.coordinates : START;
        setDriver({ longitude: from[0], latitude: from[1] });
    }

    useEffect(() => {
        if (mode === "idle") return undefined;
        const timer = window.setInterval(() => {
            const coords = routeCoordsRef.current;
            if (!coords) return;
            travelledRef.current += 55;
            const [longitude, latitude] = pointAlong(coords, travelledRef.current);
            setDriver({ longitude, latitude });
        }, 1000);
        return () => window.clearInterval(timer);
    }, [mode]);

    const rideRequests = useMemo(() => (mode === "idle" ? RIDES.map((ride) => ({
        id: ride.rideId,
        point: ride.pickup,
        fare: `Rs ${ride.requestedPrice}`,
        label: ride.pickup.address,
    })) : []), [mode]);
    const selectedRide = RIDES.find((ride) => ride.rideId === selected);
    const navigating = mode !== "idle";
    const status = mode === "trip" ? "TRIP_STARTED" : "DRIVER_EN_ROUTE";

    return (
        <main className="driver-experience relative h-dvh w-full overflow-hidden bg-pd-surface-3 text-pd-text">
            <div className="absolute inset-0">
                <DriverMap
                    driverLocation={driver}
                    vehicleType={vehicle}
                    vehicleColor="blue"
                    destination={target}
                    targetKind={mode === "trip" ? "destination" : "pickup"}
                    navigationMode={navigating}
                    rideRequests={rideRequests}
                    selectedRideId={selected}
                    onRideSelect={setSelected}
                    onRouteUpdate={setInfo}
                    sheetRatio={navigating ? TRIP_PANEL_HEIGHT / viewportH : 0.2}
                    routeProvider={routeProvider}
                />
            </div>

            {navigating && (
                <NavigationBanner
                    info={info}
                    targetKind={mode === "trip" ? "destination" : "pickup"}
                    className="pointer-events-none absolute left-[76px] right-3 top-4 z-20"
                />
            )}

            <div className="absolute left-3 top-4 z-30 flex flex-col gap-2" role="group" aria-label="Demo controls">
                {MODES.map((item) => (
                    <button key={item.id} type="button" onClick={() => chooseMode(item.id)} aria-pressed={mode === item.id}
                        className={`min-h-11 rounded-xl px-3 text-sm font-bold shadow-md ${mode === item.id ? "bg-pd-accent text-pd-accent-ink" : "bg-pd-surface text-pd-text"}`}>
                        {item.label}
                    </button>
                ))}
                <button type="button" onClick={() => setVehicle(VEHICLES[(VEHICLES.indexOf(vehicle) + 1) % VEHICLES.length])}
                    className="min-h-11 rounded-xl bg-pd-surface px-3 text-sm font-bold text-pd-text shadow-md">
                    Vehicle: {vehicle.toLowerCase()}
                </button>
            </div>

            {mode === "idle" && !selectedRide && (
                <div className="absolute inset-x-3 bottom-4 z-20 mx-auto max-w-xl">
                    <RideReturnBanner kind="available" title={`${RIDES.length} rides are waiting`}
                        subtitle="Tap a fare on the map to see the ride" onClick={() => setSelected(RIDES[0].rideId)} />
                </div>
            )}

            {selectedRide && (
                <RideRequestCard
                    ride={selectedRide}
                    passengerName={selectedRide.passengerName}
                    pickupDistanceText="1.2 km"
                    secondsLeft={32}
                    totalSeconds={45}
                    onPriceChange={() => {}}
                    onAccept={() => chooseMode("pickup")}
                    onDecline={() => setSelected(null)}
                    onClose={() => setSelected(null)}
                    busy={false}
                    submitted={false}
                    cooldownSeconds={0}
                />
            )}

            {navigating && (
                <TripStepPanel
                    key={status}
                    status={status}
                    passengerName="Ayesha Khan"
                    tripType="ONE_WAY"
                    stopsDone={0}
                    stopsTotal={0}
                    pendingStop={false}
                    stopWaiting={false}
                    targetPoint={target}
                    targetPlace={target.address}
                    navigationInfo={info?.distanceKm != null ? info : null}
                    waitingTime="00:00"
                    completeBlocked={false}
                    busy={false}
                    unread={0}
                    onAdvance={() => chooseMode(mode === "pickup" ? "trip" : "idle")}
                    onStopAction={() => {}}
                    onChat={() => {}}
                />
            )}
        </main>
    );
}
