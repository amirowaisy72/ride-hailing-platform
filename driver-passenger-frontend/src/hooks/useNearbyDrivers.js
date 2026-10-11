"use client";
import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api";
import { getRealtimeSocket } from "@/lib/socket";

export function useNearbyDrivers(rideId, token, enabled) {
    const [nearby, setNearby] = useState({ cells: [], onlineDrivers: 0, radiusKm: 15 });
    useEffect(() => {
        if (!rideId || !token || !enabled) { setNearby({ cells: [], onlineDrivers: 0, radiusKm: 15 }); return; }
        let cancelled = false;
        async function refresh() {
            try {
                const data = await apiRequest(`/rides/${rideId}/nearby-drivers`, { token });
                if (!cancelled) setNearby({ cells: data.cells || [], onlineDrivers: data.onlineDrivers || 0, radiusKm: data.radiusKm || 15 });
            } catch { if (!cancelled) setNearby({ cells: [], onlineDrivers: 0, radiusKm: 15 }); }
        }
        refresh();
        const timer = setInterval(() => { if (!document.hidden) refresh(); }, 15000);
        const socket = getRealtimeSocket();
        socket?.on("connect", refresh);
        return () => { cancelled = true; clearInterval(timer); socket?.off("connect", refresh); };
    }, [rideId, token, enabled]);
    return nearby;
}
