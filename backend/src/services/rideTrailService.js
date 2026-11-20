const RideLocationTrail = require("../models/RideLocationTrail");

// ---------------------------------------------------------------------
// Safety — GPS trail recorder (Safar To-Do #5, Phase 1, item d).
//
// Both driver-location paths (REST updateDriverLocation and the
// realtime driver:location socket handler) call recordTrailPoint after
// they have stored the live fix. Sampling is throttled in memory to at
// most one trail point per ride every TRAIL_INTERVAL_MS so a ride does
// not flood the collection; the throttle is only a sampling guard, so
// losing it (restart) loses nothing but a few extra points. Failures
// are swallowed — a trail write must never break a location update.
// ---------------------------------------------------------------------

const TRAIL_INTERVAL_MS = 15 * 1000;

// rideId (string) -> timestamp of the last recorded trail point.
const lastRecordedByRide = new Map();

async function recordTrailPoint(rideId, driverId, latitude, longitude) {
    try {
        if (!rideId || !driverId) return;
        if (
            typeof latitude !== "number" ||
            typeof longitude !== "number" ||
            !Number.isFinite(latitude) ||
            !Number.isFinite(longitude)
        ) {
            return;
        }

        const key = String(rideId);
        const now = Date.now();
        const last = lastRecordedByRide.get(key) || 0;

        if (now - last < TRAIL_INTERVAL_MS) return;

        lastRecordedByRide.set(key, now);

        await RideLocationTrail.create({
            ride: rideId,
            driver: driverId,
            location: {
                type: "Point",
                coordinates: [longitude, latitude],
            },
            recordedAt: new Date(now),
        });
    } catch (error) {
        // Best-effort only: never fail the caller's location update.
        console.error("Ride trail record failed:", error.message);
    }
}

module.exports = { recordTrailPoint, TRAIL_INTERVAL_MS };
