"use client";

import useSWR from "swr";
import { usePathname } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { apiRequest } from "@/lib/api";
import RideReturnBanner from "@/components/driver/ride/RideReturnBanner";
import { placeText } from "@/components/driver/DriverRequestCard";
import { passengerNameOf } from "@/components/driver/ride/RideRequestCard";

const ACTIVE_TEXT = {
    DRIVER_SELECTED: "Next: start driving to pickup",
    DRIVER_EN_ROUTE: "Next: drive to the pickup point",
    DRIVER_ARRIVED: "Next: start the trip",
    TRIP_STARTED: "Next: drive to the destination",
};

/**
 * Mounted once in the driver layout. On every driver screen except home
 * (home shows the ride itself) it keeps a one-tap way back to the current
 * ride, or to rides waiting for an answer. Uses the same two read APIs as
 * the home screen.
 */
export default function DriverRideDock() {
    const { token } = useAuth();
    const pathname = usePathname();
    const enabled = Boolean(token) && pathname !== "/driver";
    const options = { refreshInterval: 8000, revalidateOnFocus: true, shouldRetryOnError: false };
    const { data: active } = useSWR(enabled ? ["driver-active-ride", token] : null,
        () => apiRequest("/drivers/me/active-ride", { token }), options);
    const activeRide = active?.ride || null;
    const { data: available } = useSWR(enabled && !activeRide ? ["driver-available-rides", token] : null,
        () => apiRequest("/drivers/me/available-rides", { token }), options);
    const waiting = available?.rides || [];

    if (!enabled) return null;
    let banner = null;
    if (activeRide) {
        banner = (
            <RideReturnBanner kind="active" href="/driver" title="Your current ride"
                subtitle={`${passengerNameOf(activeRide)} · ${ACTIVE_TEXT[activeRide.status] || "Tap to continue"}`} />
        );
    } else if (waiting.length > 0) {
        banner = (
            <RideReturnBanner kind="available" href="/driver"
                title={waiting.length === 1 ? "1 ride is waiting" : `${waiting.length} rides are waiting`}
                subtitle={`From ${placeText(waiting[0].pickup)}`} />
        );
    }
    if (!banner) return null;
    return (
        <div className="pointer-events-none fixed inset-x-0 bottom-[calc(76px+env(safe-area-inset-bottom))] z-[125] mx-auto w-full max-w-xl px-3">
            {banner}
        </div>
    );
}
