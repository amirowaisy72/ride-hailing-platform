"use client";
import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api";
import { getRealtimeSocket } from "@/lib/socket";

// Never substitutes a simulated marker for a real driver's GPS.
export function useLiveDriverLocation(rideId, token, enabled = true) {
    const [location, setLocation] = useState(null);
    const [updatedAt, setUpdatedAt] = useState(null);
    const [now, setNow] = useState(Date.now());
    useEffect(() => {
        if (!rideId || !token || !enabled) { setLocation(null); setUpdatedAt(null); return; }
        let gone = false;
        const load = async () => {
            try {
                const data = await apiRequest(`/rides/${rideId}/driver-location`, { token });
                if (!gone) { setLocation(data.location || null); setUpdatedAt(data.updatedAt || null); }
            } catch (e) { console.warn("Driver location unavailable", e.message); }
        };
        const onLocation = (payload) => {
            if (String(payload?.rideId) !== String(rideId)) return;
            const { latitude, longitude } = payload.location || {};
            if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
            setLocation({ latitude, longitude }); setUpdatedAt(payload.updatedAt || new Date().toISOString());
        };
        const socket = getRealtimeSocket();
        load();
        socket?.on("ride:driver:location", onLocation);
        socket?.on("connect", load);
        const timer = setInterval(() => { setNow(Date.now()); if (!document.hidden) load(); }, 15000);
        return () => { gone = true; clearInterval(timer); socket?.off("ride:driver:location", onLocation); socket?.off("connect", load); };
    }, [rideId, token, enabled]);
    // Never show stale GPS as a live driver position.
    const fresh = updatedAt && now - new Date(updatedAt).getTime() < 120000;
    return {
        driverLocation: fresh ? location : null, driverLocationUpdatedAt: updatedAt,
        driverLocationFresh: Boolean(fresh && location)
    };
}
