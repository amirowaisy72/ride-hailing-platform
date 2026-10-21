const mongoose = require("mongoose");
const Ride = require("../models/Ride");
const Driver = require("../models/Driver");
const CommissionSettings = require("../models/CommissionSettings");
const { publishEvent } = require("../services/socketService");

const transitions = {
    DRIVER_SELECTED: ["DRIVER_EN_ROUTE"],
    DRIVER_EN_ROUTE: ["DRIVER_ARRIVED"],
    DRIVER_ARRIVED: ["TRIP_STARTED"],
    TRIP_STARTED: ["TRIP_COMPLETED"],
};

const updateTripStatus = async (req, res) => {
    const { rideId } = req.params;
    const { status } = req.body || {};

    if (!mongoose.isValidObjectId(rideId)) {
        return res.status(400).json({
            success: false,
            message: "Invalid ride ID",
        });
    }

    const previousStatus = Object.keys(transitions).find(
        (key) => transitions[key].includes(status)
    );

    if (!previousStatus) {
        return res.status(400).json({
            success: false,
            message: "Invalid trip transition",
        });
    }

    try {
        const driver = await Driver.findOne({
            userId: req.user._id,
        });

        if (!driver) {
            return res.status(403).json({
                success: false,
                message: "Driver profile required",
            });
        }

        const timestampField = {
            DRIVER_ARRIVED: "driverArrivedAt",
            TRIP_STARTED: "startedAt",
            TRIP_COMPLETED: "completedAt",
        }[status];

        const update = { status };
        const now = new Date();

        if (timestampField) update[timestampField] = now;

        if (status === "DRIVER_ARRIVED") {
            update.pickupWaitingSince = now;
            update.driverArrivedAt = now;
        }

        if (status === "TRIP_STARTED") {
            const currentRide = await Ride.findOne({
                _id: rideId,
                driverId: driver._id,
                status: "DRIVER_ARRIVED",
            });

            if (!currentRide) {
                return res.status(409).json({
                    success: false,
                    message: "Ride unavailable",
                });
            }

            const settings = await CommissionSettings.findOne({
                key: "GLOBAL",
            }).lean();

            const seconds = currentRide.pickupWaitingSince
                ? Math.max(0, Math.floor(
                    (now - new Date(currentRide.pickupWaitingSince)) / 1000
                ))
                : 0;

            const freeMinutes = settings?.freeWaitingMinutes ?? 5;
            const chargePerMinute = settings?.waitingChargePerMinute ?? 0;
            const billableMinutes = Math.max(
                0, Math.ceil(seconds / 60) - freeMinutes
            );
            const charge = Math.round(
                billableMinutes * chargePerMinute * 100
            ) / 100;

            update.pickupWaitingSince = null;
            update.pickupWaitingSeconds = seconds;
            update.waitingCharge = (currentRide.waitingCharge || 0) + charge;
            update.$pickupSession = {
                locationType: "PICKUP",
                locationIndex: 0,
                startedAt: currentRide.pickupWaitingSince || now,
                endedAt: now,
                durationSeconds: seconds,
                freeMinutes,
                chargePerMinute,
                chargedAmount: charge,
            };
        }

        const pickupSession = update.$pickupSession;
        delete update.$pickupSession;

        if (status === "TRIP_COMPLETED") {
            const completionRide = await Ride.findOne({
                _id: rideId,
                driverId: driver._id,
                status: "TRIP_STARTED",
            }).select("finalPrice waitingCharge");

            if (!completionRide || !Number.isFinite(completionRide.finalPrice)) {
                return res.status(409).json({
                    success: false,
                    message: "Agreed fare unavailable",
                });
            }

            update.finalPrice = Math.round(
                completionRide.finalPrice +
                Number(completionRide.waitingCharge || 0)
            );
        }

        const ride = await Ride.findOneAndUpdate(
            {
                _id: rideId,
                driverId: driver._id,
                status: previousStatus,
                ...(status === "TRIP_COMPLETED"
                    ? {
                        stopWaitingSince: null,
                        $expr: {
                            $gte: [
                                { $ifNull: ["$stopsCompleted", 0] },
                                { $size: { $ifNull: ["$stops", []] } },
                            ],
                        },
                    }
                    : {}),
            },
            {
                $set: update,
                ...(pickupSession
                    ? { $push: { waitingSessions: pickupSession } }
                    : {}),
            },
            { returnDocument: "after", runValidators: true }
        );

        if (!ride) {
            return res.status(409).json({
                success: false,
                message: "Trip state changed or unavailable",
            });
        }

        if (status === "TRIP_COMPLETED") {
            await Ride.updateOne(
                {
                    _id: ride._id,
                    status: "TRIP_COMPLETED",
                    settlementStatus: { $ne: "SETTLED" },
                },
                {
                    $set: {
                        settlementStatus: "PENDING",
                    },
                }
            );
            await Driver.updateOne(
                { _id: driver._id },
                { $set: { isAvailable: driver.isOnline } }
            );
        }

        const event =
            status === "TRIP_STARTED"
                ? "ride:started"
                : status === "TRIP_COMPLETED"
                    ? "ride:completed"
                    : "ride:status:updated";

        publishEvent(
            event,
            `passenger:${ride.passengerId.toString()}`,
            {
                rideId: ride._id.toString(),
                status: ride.status,
                driverId: driver._id.toString(),
                waitingCharge: ride.waitingCharge || 0,
                finalPrice: ride.finalPrice,
                pickupWaitingSince: ride.pickupWaitingSince || null,
                driverArrivedAt: ride.driverArrivedAt || null,
                stopWaitingSince: ride.stopWaitingSince || null,
            }
        );

        return res.json({ success: true, ride });
    } catch (error) {
        console.error("Trip update error:", error.message);
        return res.status(500).json({
            success: false,
            message: "Trip update failed",
        });
    }
};

module.exports = { updateTripStatus };