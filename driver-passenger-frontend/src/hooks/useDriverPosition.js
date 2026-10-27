"use client";

import { useEffect, useState } from "react";
import { Geolocation } from "@capacitor/geolocation";
import { updateDriverLocation } from "@/lib/vehicleService";

// Shared live driver position for driver-side tracking screens.
//
// Why this exists: the driver parcel page used to run its own GPS watch
// and discarded every fix worse than 100 m BEFORE it reached state, so
// in poor-signal spots (indoors at a pickup, urban canyons, battery
// saving) the map sat on its default centre with no marker, no route and
// a permanent "Waiting for accurate GPS..." pill — drivers had to visit
// the home page to "fix" it. The driver home page never had that bug:
// its rule is "map shows any fix; backend only receives fixes within
// 100 m accuracy" (see src/app/driver/page.js). This hook is that exact
// pattern, shared by every screen that needs the driver's position:
//
//   - position state updates on EVERY valid fix, whatever its accuracy;
//   - the last known fix is cached at module level, so a screen renders
//     the driver on the map instantly and refines as accuracy improves
//     (never a blank map waiting for a perfect fix);
//   - one Capacitor watch is shared by all mounted consumers and is
//     cleared when the last one unmounts;
//   - optional backend sync (pass `token`): accurate fixes (<= 100 m)
//     are sent to the same endpoint the home page uses, throttled to
//     one send per 10 s, so passenger tracking keeps updating while the
//     driver stays on this screen.

const ACCURATE_ENOUGH_M = 100;
const SYNC_INTERVAL_MS = 10000;
const WATCH_OPTIONS = {
    enableHighAccuracy: true,
    timeout: 15000,
    maximumAge: 5000,
};

let cachedFix = null; // { latitude, longitude, accuracy } — last valid fix
const listeners = new Set();
let watchPromise = null;
let syncToken = null;
let lastSyncAt = 0;

function isValidFix(latitude, longitude) {
    return Number.isFinite(latitude) && Number.isFinite(longitude) &&
        Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180;
}

function emit() {
    listeners.forEach((listener) => listener(cachedFix));
}

async function maybeSync() {
    if (!syncToken || !cachedFix) return;
    if (!Number.isFinite(cachedFix.accuracy) || cachedFix.accuracy > ACCURATE_ENOUGH_M) return;

    const now = Date.now();
    if (now - lastSyncAt < SYNC_INTERVAL_MS) return;
    lastSyncAt = now;

    try {
        await updateDriverLocation(cachedFix.latitude, cachedFix.longitude, syncToken);
    } catch (error) {
        console.warn("Driver position sync:", error.message);
    }
}

function handlePosition(position) {
    const coords = position?.coords;
    if (!coords) return;

    const { latitude, longitude, accuracy } = coords;
    if (!isValidFix(latitude, longitude)) return;

    cachedFix = {
        latitude,
        longitude,
        accuracy: Number.isFinite(accuracy) ? accuracy : null,
    };
    emit();
    void maybeSync();
}

function ensureWatch() {
    if (watchPromise) return;

    watchPromise = (async () => {
        // Fast first fix (usually the system's cached position), then the
        // continuous watch takes over. Both feed the same handler.
        try {
            const position = await Geolocation.getCurrentPosition(WATCH_OPTIONS);
            handlePosition(position);
        } catch {
            // The watch below still delivers fixes; a failed one-shot is
            // not fatal and must not block the map.
        }

        let watchId = null;
        try {
            watchId = await Geolocation.watchPosition(
                WATCH_OPTIONS,
                (position, error) => {
                    if (!error && position) handlePosition(position);
                }
            );
        } catch (error) {
            console.warn("Driver position watch:", error.message);
        }

        // Every consumer left while the watch was starting: release it.
        if (listeners.size === 0 && watchId != null) {
            watchPromise = null;
            await Geolocation.clearWatch({ id: watchId });
        }

        // The watch failed to start (e.g. permission not yet granted):
        // let the next mount retry instead of caching the failure.
        if (watchId == null) watchPromise = null;

        return watchId;
    })();
}

async function releaseWatchIfIdle() {
    if (listeners.size > 0 || !watchPromise) return;

    const pending = watchPromise;
    watchPromise = null;

    try {
        const watchId = await pending;
        if (watchId != null) {
            await Geolocation.clearWatch({ id: watchId });
        }
    } catch {
        // Watch already gone; nothing to release.
    }
}

/**
 * @param {{ token?: string }} [options] Pass the auth token to also sync
 * accurate fixes to the backend while mounted (driver tracking screens).
 */
export function useDriverPosition({ token = null } = {}) {
    const [fix, setFix] = useState(cachedFix);

    useEffect(() => {
        const listener = (next) => setFix(next);
        listeners.add(listener);
        if (token) syncToken = token;
        setFix(cachedFix);
        ensureWatch();

        return () => {
            listeners.delete(listener);
            if (token && syncToken === token) syncToken = null;
            void releaseWatchIfIdle();
        };
    }, [token]);

    const hasFix = Boolean(fix);
    const gpsOk = hasFix && Number.isFinite(fix.accuracy) && fix.accuracy <= ACCURATE_ENOUGH_M;
    const message = !hasFix
        ? "Waiting for GPS..."
        : gpsOk
            ? `GPS ±${Math.round(fix.accuracy)} m`
            : "Approximate location — waiting for accurate GPS";

    return {
        position: hasFix ? { latitude: fix.latitude, longitude: fix.longitude } : null,
        accuracy: hasFix ? fix.accuracy : null,
        hasFix,
        gpsOk,
        message,
    };
}
