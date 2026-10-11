import { apiRequest } from "@/lib/api";

export async function submitDriverOffer(rideId, price, token) {
    return apiRequest(`/rides/${rideId}/offers`, {
        method: "POST",
        token,
        body: JSON.stringify({ price }),
    });
}