"use client";

import "../../driver/driver-experience.css";
import { useState } from "react";
import RideRequestCard from "@/components/driver/ride/RideRequestCard";
import TripStepPanel, { RideEndedPanel } from "@/components/driver/ride/TripStepPanel";
import RideReturnBanner from "@/components/driver/ride/RideReturnBanner";

const RIDE = {
    rideId: "demo-1",
    passengerName: "Ayesha Khan",
    vehicleType: "CAR",
    tripType: "ONE_WAY",
    requestedPrice: 450,
    distance: 5.2,
    pickup: { address: "Gulberg III, Main Boulevard, Lahore", coordinates: [74.34, 31.52] },
    destination: { address: "Lahore Airport, Departures Gate", coordinates: [74.4, 31.52] },
    stops: [],
};
const ORDER = ["DRIVER_SELECTED", "DRIVER_EN_ROUTE", "DRIVER_ARRIVED", "TRIP_STARTED", "TRIP_COMPLETED"];

export default function RideFlowDemo() {
    const [screen, setScreen] = useState("request");
    const [price, setPrice] = useState();
    const [submitted, setSubmitted] = useState(false);
    const [status, setStatus] = useState("DRIVER_SELECTED");
    const toPickup = status !== "TRIP_STARTED";

    function advance() {
        const next = ORDER[ORDER.indexOf(status) + 1];
        setStatus(next);
    }

    return (
        <main className="driver-experience relative min-h-dvh overflow-hidden bg-pd-surface-3 text-pd-text">
            <div className="absolute inset-0 flex items-center justify-center text-sm font-bold text-pd-muted" aria-hidden>
                Map area (demo)
            </div>

            {screen === "away" && (
                <div className="relative flex min-h-dvh flex-col gap-3 p-4">
                    <h1 className="text-2xl font-black">Earnings (another screen)</h1>
                    <button type="button" onClick={() => setScreen("trip")} className="sr-only">Hidden</button>
                    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(76px+env(safe-area-inset-bottom))] z-[125] mx-auto w-full max-w-xl px-3">
                        <RideReturnBanner kind="active" title="Your current ride"
                            subtitle="Ayesha Khan · Next: drive to the pickup point"
                            onClick={() => setScreen("trip")} />
                    </div>
                </div>
            )}

            {screen === "home" && (
                <div className="relative p-4">
                    <h1 className="mb-3 text-2xl font-black">Home (online)</h1>
                    <RideReturnBanner kind={submitted ? "offer" : "available"}
                        title={submitted ? "Offer sent, waiting for passenger" : "1 ride is waiting for you"}
                        subtitle="From Gulberg III, Main Boulevard, Lahore"
                        onClick={() => setScreen("request")} />
                    {submitted && (
                        <button type="button" onClick={() => { setStatus("DRIVER_SELECTED"); setScreen("trip"); }}
                            className="mt-4 min-h-12 rounded-xl bg-pd-ink px-4 font-bold text-pd-ink-text">
                            Demo: passenger chose me
                        </button>
                    )}
                </div>
            )}

            {screen === "request" && (
                <RideRequestCard
                    ride={RIDE}
                    passengerName={RIDE.passengerName}
                    pickupDistanceText="1.2 km"
                    secondsLeft={32}
                    totalSeconds={45}
                    price={price}
                    onPriceChange={setPrice}
                    onAccept={() => setSubmitted(true)}
                    onDecline={() => setScreen("home")}
                    onClose={() => setScreen("home")}
                    busy={false}
                    submitted={submitted}
                    cooldownSeconds={0}
                />
            )}

            {screen === "trip" && status !== "TRIP_COMPLETED" && (
                <>
                    <button type="button" onClick={() => setScreen("away")}
                        className="absolute left-4 top-4 z-30 min-h-12 rounded-xl bg-pd-surface px-4 font-bold shadow-pd-lg">
                        Leave this screen
                    </button>
                    <TripStepPanel
                        key={status}
                        status={status}
                        passengerName={RIDE.passengerName}
                        tripType="ONE_WAY"
                        stopsDone={0}
                        stopsTotal={0}
                        pendingStop={false}
                        stopWaiting={false}
                        targetPoint={toPickup ? RIDE.pickup : RIDE.destination}
                        targetPlace={toPickup ? RIDE.pickup.address : RIDE.destination.address}
                        navigationInfo={status === "DRIVER_EN_ROUTE" || status === "TRIP_STARTED" ? { distanceKm: 2.4, durationMinutes: 6 } : null}
                        waitingTime="01:12"
                        completeBlocked={false}
                        busy={false}
                        unread={status === "DRIVER_ARRIVED" ? 2 : 0}
                        onAdvance={advance}
                        onStopAction={() => {}}
                        onChat={() => {}}
                    />
                </>
            )}

            {screen === "trip" && status === "TRIP_COMPLETED" && (
                <RideEndedPanel status="TRIP_COMPLETED" firstName="Usman" finalPrice={450}
                    onDone={() => { setStatus("DRIVER_SELECTED"); setSubmitted(false); setScreen("home"); }} />
            )}
        </main>
    );
}
