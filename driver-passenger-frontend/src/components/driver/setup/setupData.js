import { apiRequest } from "@/lib/api";

export const DRIVER_STATUS_CACHE_KEY = "safar-driver-status";
export const DRIVER_SETUP_DETAILS_CACHE_KEY = "safar-driver-setup-details";

export const getDriverStatusKey = (token) =>
    token ? [DRIVER_STATUS_CACHE_KEY, token] : null;

export const getDriverSetupDetailsKey = (token) =>
    token ? [DRIVER_SETUP_DETAILS_CACHE_KEY, token] : null;

export const fetchDriverStatus = ([, token]) =>
    apiRequest("/drivers/me/status", { token });

export const fetchDriverSetupDetails = async ([, token]) => {
    const [vehicleData, serviceData] = await Promise.all([
        apiRequest("/drivers/me/vehicles", { token }),
        apiRequest("/drivers/me/services", { token }),
    ]);

    return { vehicleData, serviceData };
};
