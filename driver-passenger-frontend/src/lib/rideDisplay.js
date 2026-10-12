import { Bike, Car, CarFront, CarTaxiFront } from "lucide-react";

// Ids match the backend vehicleType enums. Only presentation data lives here.
export const VEHICLES = [
    { id: "BIKE", name: "Moto", description: "Quick and affordable", seats: 1, Icon: Bike },
    { id: "RICKSHAW", name: "Rickshaw", description: "Short city trips", seats: 3, Icon: CarTaxiFront },
    { id: "CAR_NON_AC", name: "Car", description: "Everyday rides", seats: 4, Icon: Car },
    { id: "CAR_AC", name: "Car AC", description: "Air-conditioned comfort", seats: 4, Icon: CarFront },
];

export function getVehicle(id) {
    return VEHICLES.find((vehicle) => vehicle.id === id) || null;
}

export function formatPKR(value) {
    const amount = Number(value);
    return `PKR ${Number.isFinite(amount) ? Math.round(amount).toLocaleString("en-PK") : "--"}`;
}

export function formatClock(ms) {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, "0")}`;
}

export function formatArrival(minutes, now = Date.now()) {
    const value = Number(minutes);
    if (!Number.isFinite(value)) return "";
    return new Date(now + value * 60000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function placeLabel(point, fallback) {
    return point?.name || point?.address || point?.displayName || point?.display_name || fallback;
}

export function shortPlace(label) {
    const text = String(label || "");
    return text.split(",")[0].trim() || text;
}

export function getInitials(name) {
    return String(name || "")
        .split(" ")
        .map((part) => part[0])
        .filter(Boolean)
        .slice(0, 2)
        .join("")
        .toUpperCase() || "D";
}

// Reads only fields the backend may already populate; every field is optional.
export function describeDriver(driver) {
    const details = driver && typeof driver === "object" ? driver : null;
    const user = details?.userId && typeof details.userId === "object" ? details.userId : null;
    const vehicle = details?.vehicle && typeof details.vehicle === "object" ? details.vehicle : {};
    return {
        id: details ? details._id || null : driver || null,
        name: [user?.firstName, user?.lastName].filter(Boolean).join(" "),
        rating: details?.rating ?? null,
        trips: details?.totalRides ?? details?.completedRides ?? details?.totalTrips ?? null,
        vehicleText: [
            vehicle.make || details?.vehicleMake,
            vehicle.model || details?.vehicleModel,
            vehicle.color || details?.vehicleColor,
        ].filter(Boolean).join(" "),
        plate: vehicle.plateNumber || details?.plateNumber || details?.vehicleNumber || null,
        phone: user?.phone || user?.phoneNumber || null,
        vehicleType: details?.vehicleType || vehicle.type || null,
    };
}
