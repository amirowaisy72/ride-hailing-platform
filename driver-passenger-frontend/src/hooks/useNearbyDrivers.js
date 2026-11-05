"use client";
import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api";
import { getRealtimeSocket } from "@/lib/socket";

export function useNearbyDrivers(rideId, token, enabled, homeLocation) {
    const [nearby, setNearby] = useState({ cells: [], onlineDrivers: 0, radiusKm: 15 });
    // Rounded (~11 m) so GPS jitter does not refetch on every fix.
    const rawLat = Number(homeLocation?.latitude);
    const rawLng = Number(homeLocation?.longitude);
    const homeLat = Number.isFinite(rawLat) ? Number(rawLat.toFixed(4)) : rawLat;
    const homeLng = Number.isFinite(rawLng) ? Number(rawLng.toFixed(4)) : rawLng;
    useEffect(() => {
        // Ride mode (searching after booking) is unchanged. Home mode
        // covers the idle homepage, which has no ride: without it the
        // home screen never asked for nearby drivers at all, so it
        // always showed 0 and an empty map even with drivers online.
        const rideMode = Boolean(rideId && token && enabled);
        const homeMode = !rideId && Boolean(token) && Number.isFinite(homeLat) && Number.isFinite(homeLng);
        if (!rideMode && !homeMode) { setNearby({ cells: [], onlineDrivers: 0, radiusKm: 15 }); return; }
        let cancelled = false;
        async function refresh() {
            try {
                const data = rideMode
                    ? await apiRequest(`/rides/${rideId}/nearby-drivers`, { token })
                    : await apiRequest(`/drivers/nearby?latitude=${homeLat}&longitude=${homeLng}`, { token });
                if (!cancelled) setNearby({ cells: data.cells || [], onlineDrivers: data.onlineDrivers ?? data.count ?? 0, radiusKm: data.radiusKm || 15 });
            } catch { if (!cancelled) setNearby({ cells: [], onlineDrivers: 0, radiusKm: 15 }); }
        }
        refresh();
        const timer = setInterval(() => { if (!document.hidden) refresh(); }, 15000);
        const socket = getRealtimeSocket();
        socket?.on("connect", refresh);
        return () => { cancelled = true; clearInterval(timer); socket?.off("connect", refresh); };
    }, [rideId, token, enabled, homeLat, homeLng]);
    return nearby;
}
