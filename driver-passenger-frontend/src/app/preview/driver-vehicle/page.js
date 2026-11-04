"use client";
import { useEffect, useState } from "react";
import RideMap from "@/components/RideMap";

const ROUTE = [
    [74.3436, 31.5204], [74.3446, 31.5212], [74.3458, 31.5219], [74.3470, 31.5224],
    [74.3482, 31.5226], [74.3494, 31.5225], [74.3505, 31.5220], [74.3514, 31.5212],
];
const TYPES = [
    { id: "CAR", label: "Car", color: "Red" },
    { id: "BIKE", label: "Motorcycle", color: "Black" },
    { id: "RICKSHAW", label: "Rickshaw", color: "Green" },
];

export default function DriverVehiclePreview() {
    const [index, setIndex] = useState(0);
    const [type, setType] = useState(TYPES[0]);

    useEffect(() => {
        const timer = setInterval(() => setIndex((i) => (i + 1) % ROUTE.length), 1500);
        return () => clearInterval(timer);
    }, []);

    const [lng, lat] = ROUTE[index];

    return (
        <main className="relative h-dvh w-full">
            <RideMap
                center={ROUTE[0]}
                driverLocation={{ latitude: lat, longitude: lng }}
                vehicleType={type.id}
                vehicleColor={type.color}
                showNavigationControl={false}
            />
            <div className="absolute inset-x-4 top-4 z-10 flex gap-2" role="group" aria-label="Vehicle type">
                {TYPES.map((item) => (
                    <button
                        key={item.id}
                        type="button"
                        onClick={() => setType(item)}
                        aria-pressed={type.id === item.id}
                        className={`min-h-11 flex-1 rounded-full border px-3 text-sm font-semibold ${type.id === item.id ? "border-transparent bg-[#087F5B] text-[#FFFFFF]" : "border-[var(--pd-border)] bg-[var(--pd-surface)] text-[var(--pd-text)]"}`}
                    >
                        {item.label} · {item.color}
                    </button>
                ))}
            </div>
        </main>
    );
}
