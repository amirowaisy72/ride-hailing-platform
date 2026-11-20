// ---------------------------------------------------------------------------
// Missed Ride Auto-Retry Notification (Safar To-Do #7).
//
// recordMissedRide(ride): called when a ride ends with NO driver
// available — the stale-ride expiry job (rideExpiryService) and a
// passenger cancel before any driver was selected
// (rideCancellationController). One record per ride; a ride that HAD a
// driver is never recorded (its passenger does not need a retry nudge).
//
// notifyAwaitingPassengers(driver): called when a driver comes online
// (driverController.updateOnlineStatus, only on the false -> true
// transition). Finds awaiting passengers whose pickup is within the
// driver's matching range and whose vehicle type this driver can serve,
// pushes each of them once, and marks their record NOTIFIED. Best
// effort: a push failure never blocks the driver going online.
// ---------------------------------------------------------------------------

const MissedRideRetry = require("../models/MissedRideRetry");
const Vehicle = require("../models/Vehicle");
const { sendPushToUser } = require("./pushService");
const { servableRideTypes } = require("./driverMatchingService");

// Same 15 km matching radius the offer gate and the available-rides
// feed use, so "in their range" means the same thing everywhere.
const RETRY_NOTIFY_RADIUS_METERS = 15000;

// A retry nudge is only useful while the passenger is plausibly still
// waiting / still wants a ride. Older records are ignored (and never
// notified late).
const MISSED_RIDE_RETRY_WINDOW_MS = 24 * 60 * 60 * 1000;

async function recordMissedRide(ride) {
    try {
        if (!ride || ride.driverId) return null;
        if (!Array.isArray(ride.pickup?.coordinates)) return null;

        return await MissedRideRetry.updateOne(
            { rideId: ride._id },
            {
                $setOnInsert: {
                    passengerId: ride.passengerId,
                    rideId: ride._id,
                    pickup: ride.pickup,
                    vehicleType: ride.vehicleType,
                    status: "PENDING",
                },
            },
            { upsert: true }
        );
    } catch (error) {
        console.error("Record missed ride retry failed:", error.message);
        return null;
    }
}

async function notifyAwaitingPassengers(driver) {
    try {
        if (
            !driver ||
            !Array.isArray(driver.currentLocation?.coordinates) ||
            driver.currentLocation.coordinates.length !== 2 ||
            driver.currentLocation.coordinates.every((v) => v === 0)
        ) {
            return 0;
        }

        const vehicle = await Vehicle.findOne({
            _id: driver.currentVehicleId,
            driverId: driver._id,
            verificationStatus: "APPROVED",
            isActive: true,
        })
            .select("vehicleType")
            .lean();

        if (!vehicle) return 0;

        const awaiting = await MissedRideRetry.find({
            status: "PENDING",
            vehicleType: { $in: servableRideTypes(vehicle.vehicleType) },
            createdAt: {
                $gte: new Date(Date.now() - MISSED_RIDE_RETRY_WINDOW_MS),
            },
            pickup: {
                $near: {
                    $geometry: driver.currentLocation,
                    $maxDistance: RETRY_NOTIFY_RADIUS_METERS,
                },
            },
        })
            .select("_id passengerId rideId")
            .lean();

        if (!awaiting.length) return 0;

        let notified = 0;

        for (const record of awaiting) {
            // Claim first (atomic): two drivers coming online at once
            // must not double-notify the same passenger.
            const claimed = await MissedRideRetry.findOneAndUpdate(
                { _id: record._id, status: "PENDING" },
                { $set: { status: "NOTIFIED", notifiedAt: new Date() } },
                { returnDocument: "after" }
            );

            if (!claimed) continue;

            try {
                await sendPushToUser(
                    record.passengerId,
                    "Drivers Online Hain!",
                    "A driver is now online near your pickup point. Open Safar and book your ride again.",
                    {
                        type: "MISSED_RIDE_RETRY",
                        rideId: String(record.rideId),
                    }
                );
                notified += 1;
            } catch (error) {
                console.error(
                    "Missed-ride retry push failed:",
                    error.message
                );
            }
        }

        return notified;
    } catch (error) {
        console.error("Missed-ride retry notify failed:", error.message);
        return 0;
    }
}

module.exports = {
    RETRY_NOTIFY_RADIUS_METERS,
    MISSED_RIDE_RETRY_WINDOW_MS,
    recordMissedRide,
    notifyAwaitingPassengers,
};
