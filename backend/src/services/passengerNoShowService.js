// ---------------------------------------------------------------------------
// Passenger No-Show Fix (Safar To-Do #1) — shared constants + the
// passenger-record bookkeeping. No endpoint lives here; the ride
// controllers call these helpers.
//
// (a) Arrival notification: the driver marking DRIVER_ARRIVED already
//     pushes the passenger; the push text now says the driver has
//     arrived and the 5-minute wait is running (see
//     driverTripController.js).
// (b) Call/chat: ride chat already exists (rideChatController.js,
//     GET/POST /rides/:rideId/messages, with push to offline
//     recipients). There is NO in-app VoIP in this codebase, so the
//     call path is the phone number: ridePickupController exposes
//     GET /rides/:rideId/contact (other party's name + phone, only to
//     the two parties of an assigned ride) for a tel: call. That gap
//     — no in-app voice call — is flagged, not papered over.
// (c) 5-minute wait timer after arrival; no-penalty no-show cancel
//     only once it has expired (see rideCancellationController.js).
// (d) Pre-departure passenger confirmation: POST
//     /rides/:rideId/confirm-pickup records it and notifies the
//     driver. Enforcement of the DRIVER_EN_ROUTE gate is OFF by
//     default (PICKUP_CONFIRMATION_ENFORCED = false): the live 1.0.7
//     passenger app has no confirm button, so enforcing it now would
//     strand every live driver at DRIVER_SELECTED. Flip the constant
//     to true once the app version carrying the confirm button is
//     live; the gate then returns 409 PICKUP_NOT_CONFIRMED.
// (e) Repeat no-show warning/counter on the passenger record
//     (User.rideNoShowCount / rideNoShowWarningAt, recorded here).
// ---------------------------------------------------------------------------

const User = require("../models/User");
const { sendPushToUser } = require("./pushService");

// (c) Wait timer after the driver arrives at pickup.
const NO_SHOW_WAIT_MS = 5 * 60 * 1000;
const NO_SHOW_WAIT_MINUTES = 5;

// (d) Flip to true only once the live app ships the confirm button.
const PICKUP_CONFIRMATION_ENFORCED = false;

// (e) Warn the passenger on every no-show from this count on.
const NO_SHOW_WARNING_THRESHOLD = 3;

const noShowWaitExpiresAt = (arrivedAt) =>
    new Date(new Date(arrivedAt).getTime() + NO_SHOW_WAIT_MS);

const waitSecondsRemaining = (ride, now = new Date()) => {
    if (!ride.noShowWaitExpiresAt) return 0;
    return Math.max(
        0,
        Math.ceil(
            (new Date(ride.noShowWaitExpiresAt).getTime() - now.getTime()) /
                1000
        )
    );
};

const canCancelAsNoShow = (ride, now = new Date()) =>
    ride.status === "DRIVER_ARRIVED" &&
    ride.noShowWaitExpiresAt &&
    now.getTime() >= new Date(ride.noShowWaitExpiresAt).getTime();

// (e) Record a no-show against the passenger: increment the counter,
// stamp a warning once the threshold is reached, and push the
// passenger. Never throws — bookkeeping must not fail the cancel.
async function recordPassengerNoShow(ride) {
    try {
        const before = await User.findById(ride.passengerId)
            .select("rideNoShowCount")
            .lean();
        const count = (before?.rideNoShowCount || 0) + 1;

        await User.updateOne(
            { _id: ride.passengerId },
            {
                $inc: { rideNoShowCount: 1 },
                ...(count >= NO_SHOW_WARNING_THRESHOLD
                    ? { $set: { rideNoShowWarningAt: new Date() } }
                    : {}),
            }
        );
        if (count >= NO_SHOW_WARNING_THRESHOLD) {
            void sendPushToUser(
                ride.passengerId,
                "Repeated no-show warning",
                `You were not at the pickup point ${count} times. Please be ready when your driver arrives, or your account may be restricted.`,
                { type: "PASSENGER_NO_SHOW_WARNING", rideId: String(ride._id) }
            );
        } else {
            void sendPushToUser(
                ride.passengerId,
                "Ride cancelled — driver waited 5 minutes",
                "Your driver waited 5 minutes at your pickup point but could not reach you, so the ride was cancelled.",
                { type: "PASSENGER_NO_SHOW", rideId: String(ride._id) }
            );
        }

        return count;
    } catch (error) {
        console.error("Record passenger no-show failed:", error.message);
        return null;
    }
}

module.exports = {
    NO_SHOW_WAIT_MS,
    NO_SHOW_WAIT_MINUTES,
    PICKUP_CONFIRMATION_ENFORCED,
    NO_SHOW_WARNING_THRESHOLD,
    noShowWaitExpiresAt,
    waitSecondsRemaining,
    canCancelAsNoShow,
    recordPassengerNoShow,
};
