const mongoose = require("mongoose");
const Ride = require("../models/Ride");
const RideOffer = require("../models/RideOffer");
const { sendPushToUser } = require("./pushService");

// Rides with no driver selected that stay in REQUESTED / SEARCHING /
// BIDDING longer than this are abandoned (passenger closed the app
// without cancelling, or simply never picked a driver). The backend
// cannot see a closed passenger app directly, so "no driver selected
// within this window" is the rule. 15 minutes: driver offers themselves
// expire after 5 minutes, so 15 minutes is three full offer cycles.
const RIDE_EXPIRY_MS = 15 * 60 * 1000;
const CHECK_INTERVAL_MS = 5 * 60 * 1000;

let expiryTimer = null;
let expiring = false;

async function expireStaleRides() {
    if (expiring) return;
    expiring = true;
    try {
        const cutoff = new Date(Date.now() - RIDE_EXPIRY_MS);
        const stale = await Ride.find({
            status: { $in: ["REQUESTED", "SEARCHING", "BIDDING"] },
            driverId: null,
            createdAt: { $lt: cutoff },
        })
            .select("_id passengerId")
            .lean();

        if (!stale.length) return;

        const rideIds = stale.map((ride) => ride._id);
        await Ride.updateMany(
            { _id: { $in: rideIds } },
            {
                $set: {
                    status: "EXPIRED",
                    cancelledAt: new Date(),
                    cancellationReason: "AUTO_EXPIRED_NO_DRIVER_SELECTED",
                },
            }
        );
        // Pending offers on an expired ride are dead too.
        await RideOffer.updateMany(
            { rideId: { $in: rideIds }, status: "PENDING" },
            { $set: { status: "EXPIRED" } }
        );

        // Best effort: tell the passenger their request expired. A
        // failed push must never roll the expiry back.
        for (const ride of stale) {
            try {
                await sendPushToUser(
                    ride.passengerId,
                    "Ride request expired",
                    "Your ride request expired because no driver was selected. Please request again when you are ready.",
                    { type: "RIDE_EXPIRED", rideId: String(ride._id) }
                );
            } catch {
                /* Push failure does not undo the expiry. */
            }
        }
        console.log(`Ride expiry: expired ${stale.length} stale ride(s).`);
    } catch (error) {
        console.error("Ride expiry error:", error.message);
    } finally {
        expiring = false;
    }
}

function startRideExpiry() {
    if (expiryTimer) return;
    expiryTimer = setInterval(expireStaleRides, CHECK_INTERVAL_MS);
    // Run once shortly after startup so stale rides left by a restart
    // do not wait a full interval.
    setTimeout(expireStaleRides, 30 * 1000);
}

module.exports = {
    RIDE_EXPIRY_MS,
    expireStaleRides,
    startRideExpiry,
};
