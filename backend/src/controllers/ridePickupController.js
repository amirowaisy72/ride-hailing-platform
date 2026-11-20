// ---------------------------------------------------------------------------
// Passenger No-Show Fix (Safar To-Do #1), passenger + driver ride APIs.
// Mounted under /api/v1/rides (see routes/rideRoutes.js).
//
// (d) POST /rides/:rideId/confirm-pickup — the passenger confirms they
//     are ready at the pickup point before the driver starts driving
//     there. Allowed from DRIVER_SELECTED until the trip starts; the
//     driver gets a socket event + push. Idempotent: confirming twice
//     is still just confirmed.
// (b) GET /rides/:rideId/contact — the call/chat hookup for an assigned
//     ride. In-app chat already exists (GET/POST /rides/:rideId/messages).
//     There is NO in-app VoIP in this codebase, so the call path is the
//     other party's phone number (User.phone) for a tel: call. Only the
//     ride's own passenger and assigned driver may call this, and only
//     while the ride is assigned (DRIVER_SELECTED..TRIP_STARTED).
// ---------------------------------------------------------------------------

const mongoose = require("mongoose");
const Ride = require("../models/Ride");
const Driver = require("../models/Driver");
const User = require("../models/User");
const { publishEvent } = require("../services/socketService");
const { sendPushToUser } = require("../services/pushService");

const CONFIRMABLE = ["DRIVER_SELECTED", "DRIVER_EN_ROUTE", "DRIVER_ARRIVED"];
const CONTACTABLE = [
    "DRIVER_SELECTED",
    "DRIVER_EN_ROUTE",
    "DRIVER_ARRIVED",
    "TRIP_STARTED",
];

const confirmPickup = async (req, res) => {
    try {
        const { rideId } = req.params;

        if (!mongoose.isValidObjectId(rideId)) {
            return res.status(400).json({
                success: false,
                message: "Invalid ride ID",
            });
        }

        const ride = await Ride.findOneAndUpdate(
            {
                _id: rideId,
                passengerId: req.user._id,
                status: { $in: CONFIRMABLE },
            },
            {
                $set: {
                    pickupConfirmedByPassenger: true,
                    pickupConfirmedAt: new Date(),
                },
            },
            { returnDocument: "after" }
        );

        if (!ride) {
            return res.status(409).json({
                success: false,
                message: "Ride cannot be confirmed at this stage",
            });
        }

        const driver = await Driver.findById(ride.driverId).select("userId");

        if (driver) {
            publishEvent(
                "ride:pickup:confirmed",
                `driver:${driver.userId}`,
                {
                    rideId: String(ride._id),
                    pickupConfirmedAt: ride.pickupConfirmedAt,
                }
            );

            void sendPushToUser(
                driver.userId,
                "Passenger confirmed pickup",
                "The passenger confirmed they are ready at the pickup point. You can head there now.",
                { type: "RIDE_PICKUP_CONFIRMED", rideId: String(ride._id) }
            );
        }

        return res.json({
            success: true,
            message: "Pickup confirmed",
            ride,
        });
    } catch (error) {
        console.error("Confirm pickup error:", error.message);
        return res.status(500).json({
            success: false,
            message: "Failed to confirm pickup",
        });
    }
};

const getRideContact = async (req, res) => {
    try {
        const { rideId } = req.params;

        if (!mongoose.isValidObjectId(rideId)) {
            return res.status(400).json({
                success: false,
                message: "Invalid ride ID",
            });
        }

        const ride = await Ride.findOne({
            _id: rideId,
            status: { $in: CONTACTABLE },
        }).select("passengerId driverId status");

        if (!ride || !ride.driverId) {
            return res.status(404).json({
                success: false,
                message: "Ride contact unavailable",
            });
        }

        const driver = await Driver.findById(ride.driverId).select("userId");

        if (!driver) {
            return res.status(404).json({
                success: false,
                message: "Ride contact unavailable",
            });
        }

        const callerId = String(req.user._id);
        const isPassenger = callerId === String(ride.passengerId);
        const isDriver = callerId === String(driver.userId);

        if (!isPassenger && !isDriver) {
            return res.status(403).json({
                success: false,
                message: "Access denied",
            });
        }

        const otherUserId = isPassenger ? driver.userId : ride.passengerId;
        const other = await User.findById(otherUserId)
            .select("firstName lastName phone profileImage")
            .lean();

        if (!other) {
            return res.status(404).json({
                success: false,
                message: "Ride contact unavailable",
            });
        }

        const name = [other.firstName, other.lastName]
            .filter(Boolean)
            .join(" ")
            .trim();

        return res.json({
            success: true,
            contact: {
                role: isPassenger ? "DRIVER" : "PASSENGER",
                name: name || "Safar user",
                phone: other.phone || null,
                canCall: Boolean(other.phone),
                profileImage: other.profileImage || null,
            },
            // In-app chat for this ride (already exists):
            // GET/POST /api/v1/rides/:rideId/messages
            chat: { messagesUrl: `/api/v1/rides/${ride._id}/messages` },
        });
    } catch (error) {
        console.error("Ride contact error:", error.message);
        return res.status(500).json({
            success: false,
            message: "Failed to load ride contact",
        });
    }
};

module.exports = { confirmPickup, getRideContact };
