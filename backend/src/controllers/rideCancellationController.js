const mongoose = require("mongoose");
const Ride = require("../models/Ride");
const Driver = require("../models/Driver");
const { publishEvent } = require("../services/socketService");
const { sendPushToUser } = require("../services/pushService");
const RideOffer = require("../models/RideOffer");
const { findDriversWithExpandedRadius } = require("../services/driverMatchingService");

// Ride states before a driver is chosen, and the assigned-but-not-yet-
// started states. TRIP_STARTED and beyond can be cancelled by nobody:
// the trip is underway and must run to TRIP_COMPLETED.
const PRE_SELECTION = ["REQUESTED", "SEARCHING", "BIDDING"];
const ASSIGNED = ["DRIVER_SELECTED", "DRIVER_EN_ROUTE", "DRIVER_ARRIVED"];

// Passenger cancellation. Works both before selection (the original
// behaviour: open ride, no driver) and AFTER a driver has been
// selected, up to — but not including — TRIP_STARTED. Cancelling an
// assigned ride frees the driver (availability restored per the
// trip-completion pattern: isAvailable follows isOnline) and closes
// the accepted offer, so the passenger's active-ride guard no longer
// sees the ride and they can book again immediately.
const cancelRideAsPassenger = async (req, res) => {
    try {
        const ride = await Ride.findOneAndUpdate(
            {
                _id: req.params.rideId,
                passengerId: req.user._id,
                status: { $in: [...PRE_SELECTION, ...ASSIGNED] },
            },
            {
                $set: {
                    status: "CANCELLED",
                    cancelledAt: new Date(),
                    cancellationReason: "Cancelled by passenger",
                },
            },
            { new: true }
        );

        if (!ride) {
            return res.status(409).json({
                success: false,
                message: "Ride cannot be cancelled at this stage",
            });
        }

        // Free the assigned driver, if any. The cancelled ride keeps
        // its driverId for the record; the driver's active-ride state
        // is the isAvailable flag claimed at selection time.
        let assignedDriverUserId = null;

        if (ride.driverId) {
            const assignedDriver = await Driver.findById(ride.driverId)
                .select("userId isOnline");

            if (assignedDriver) {
                assignedDriverUserId = assignedDriver.userId;

                await Driver.updateOne(
                    { _id: assignedDriver._id },
                    { $set: { isAvailable: assignedDriver.isOnline } }
                );
            }
        }

        publishEvent(
            "ride:cancelled",
            `passenger:${req.user._id}`,
            { rideId: ride._id.toString() }
        );

        try {
            await RideOffer.updateMany(
                { rideId: ride._id, status: { $in: ["PENDING", "ACCEPTED"] } },
                { $set: { status: "REJECTED" } }
            );

            if (assignedDriverUserId) {
                publishEvent(
                    "ride:cancelled",
                    `driver:${assignedDriverUserId}`,
                    { rideId: ride._id.toString() }
                );

                void sendPushToUser(
                    assignedDriverUserId,
                    "Ride Cancelled",
                    "The passenger cancelled this ride.",
                    { type: "RIDE_CANCELLED", rideId: ride._id.toString() }
                );
            } else {
                const [longitude, latitude] = ride.pickup.coordinates;
                const { drivers } = await findDriversWithExpandedRadius(
                    longitude, latitude
                );

                for (const driver of drivers) {
                    publishEvent(
                        "ride:cancelled",
                        `driver:${driver.userId}`,
                        { rideId: ride._id.toString() }
                    );
                }
            }
        } catch (error) {
            console.error("Cancellation notification failed:", error.message);
        }

        return res.json({
            success: true,
            message: "Ride cancelled successfully",
            ride,
        });
    } catch (error) {
        console.error("Cancel ride error:", error.message);
        return res.status(500).json({
            success: false,
            message: "Failed to cancel ride",
        });
    }
};

// Driver cancellation of an ASSIGNED ride (same pre-start states).
// The ride is NOT cancelled outright: the codebase's re-searchable
// state is REQUESTED with driverId null — that is the state new rides
// are created in and the only pre-selection state the offer gate
// (submitOffer) and the available-rides feed accept (REASSIGNING
// exists in the enum but no code path reads or writes it, so it would
// strand the ride). The driver's accepted offer is withdrawn (he may
// re-offer later through the normal rebid flow), his availability is
// restored, the agreed price/selection timestamps are cleared, the
// passenger is notified, and the ride is fanned out to nearby drivers
// again exactly as at creation.
const cancelRideAsDriver = async (req, res, driver) => {
    try {
        const ride = await Ride.findOneAndUpdate(
            {
                _id: req.params.rideId,
                driverId: driver._id,
                status: { $in: ASSIGNED },
            },
            {
                $set: {
                    status: "REQUESTED",
                    driverId: null,
                    finalPrice: null,
                    acceptedAt: null,
                    driverArrivedAt: null,
                    pickupWaitingSince: null,
                },
            },
            { new: true }
        );

        if (!ride) {
            return res.status(409).json({
                success: false,
                message: "Ride cannot be cancelled at this stage",
            });
        }

        await Driver.updateOne(
            { _id: driver._id },
            { $set: { isAvailable: driver.isOnline } }
        );

        try {
            await RideOffer.updateOne(
                { rideId: ride._id, driverId: driver._id, status: "ACCEPTED" },
                { $set: { status: "WITHDRAWN" } }
            );
        } catch (error) {
            console.error("Driver-cancel offer withdrawal failed:", error.message);
        }

        publishEvent(
            "ride:driver:cancelled",
            `passenger:${ride.passengerId}`,
            {
                rideId: ride._id.toString(),
                status: ride.status,
            }
        );

        void sendPushToUser(
            ride.passengerId,
            "Driver Cancelled",
            "Your driver cancelled the ride. We are searching for another driver.",
            { type: "RIDE_DRIVER_CANCELLED", rideId: ride._id.toString() }
        );

        try {
            const [longitude, latitude] = ride.pickup.coordinates;
            const { drivers } = await findDriversWithExpandedRadius(
                longitude, latitude, ride.vehicleType
            );

            for (const nearbyDriver of drivers) {
                if (String(nearbyDriver._id) === String(driver._id)) {
                    continue;
                }

                publishEvent(
                    "ride:created",
                    `driver:${nearbyDriver.userId}`,
                    { rideId: ride._id.toString() }
                );
            }
        } catch (error) {
            console.error("Driver-cancel re-search notification failed:", error.message);
        }

        return res.json({
            success: true,
            message: "Ride released successfully",
            ride,
        });
    } catch (error) {
        console.error("Driver cancel ride error:", error.message);
        return res.status(500).json({
            success: false,
            message: "Failed to cancel ride",
        });
    }
};

// POST /rides/:rideId/cancel — either party to the ride may call it
// (route admits PASSENGER and DRIVER); who is calling is resolved
// here from the ride itself: its passenger takes the passenger path,
// its assigned driver takes the driver path, anyone else is refused.
const cancelRide = async (req, res) => {
    const { rideId } = req.params;

    if (!mongoose.isValidObjectId(rideId)) {
        return res.status(400).json({
            success: false,
            message: "Invalid ride ID",
        });
    }

    try {
        const ride = await Ride.findById(rideId)
            .select("passengerId driverId")
            .lean();

        if (!ride) {
            return res.status(409).json({
                success: false,
                message: "Ride cannot be cancelled at this stage",
            });
        }

        if (String(ride.passengerId) === String(req.user._id)) {
            return cancelRideAsPassenger(req, res);
        }

        const driver = await Driver.findOne({
            userId: req.user._id,
        }).select("_id isOnline");

        if (
            driver &&
            ride.driverId &&
            String(ride.driverId) === String(driver._id)
        ) {
            return cancelRideAsDriver(req, res, driver);
        }

        return res.status(403).json({
            success: false,
            message: "Access denied",
        });
    } catch (error) {
        console.error("Cancel ride error:", error.message);
        return res.status(500).json({
            success: false,
            message: "Failed to cancel ride",
        });
    }
};

module.exports = { cancelRide };
