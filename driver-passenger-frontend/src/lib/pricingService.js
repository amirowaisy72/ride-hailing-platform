import { apiRequest } from "@/lib/api";

export async function getVehiclePricing(token) {
    const data = await apiRequest("/vehicle-pricing", { token });
    return data.pricing;
}

export async function getSuggestedFare(vehicleType, distanceKm, token) {
    const data = await apiRequest("/vehicle-pricing/suggest", {
        method: "POST",
        token,
        body: JSON.stringify({ vehicleType, distanceKm }),
    });

    return data.fare;
}
