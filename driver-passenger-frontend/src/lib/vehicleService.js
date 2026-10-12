import { apiRequest } from "@/lib/api";

export const getMyVehicles = (token) =>
    apiRequest("/drivers/me/vehicles", { token });

export const selectVehicle = (vehicleId, token) =>
    apiRequest("/drivers/me/vehicles/active", {
        method: "PATCH",
        token,
        body: JSON.stringify({ vehicleId }),
    });

export const updateOnlineStatus = (isOnline, token) =>
    apiRequest("/drivers/me/online-status", {
        method: "PATCH",
        token,
        body: JSON.stringify({ isOnline }),
    });

export const updateDriverLocation = (latitude, longitude, token) =>
    apiRequest("/drivers/me/location", {
        method: "PATCH",
        token,
        body: JSON.stringify({ latitude, longitude }),
    });
