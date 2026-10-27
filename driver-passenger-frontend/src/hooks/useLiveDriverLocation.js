"use client";
import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api";
import { getRealtimeSocket } from "@/lib/socket";

// Never substitutes a simulated marker for a real driver's GPS.
// The last REAL fix is always returned: when it ages past the freshness
// window it stays on the map flagged stale (driverLocationStale + age)
// instead of vanishing — the same pattern Round 4 applied to parcel
// tracking. Freshness is a label, never a reason to blank the driver.
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
    const ageMs = updatedAt ? Math.max(0, now - new Date(updatedAt).getTime()) : null;
    const fresh = Boolean(location && ageMs !== null && ageMs < 120000);
    return {
        // Last known position, kept even when stale (see header note).
        driverLocation: location,
        driverLocationUpdatedAt: updatedAt,
        driverLocationFresh: fresh,
        driverLocationStale: Boolean(location && !fresh),
        driverLocationAgeMs: location ? ageMs : null,
    };
}
