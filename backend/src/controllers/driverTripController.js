const mongoose = require("mongoose");
const Ride = require("../models/Ride");
const Driver = require("../models/Driver");
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

        if (timestampField) update[timestampField] = new Date();

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
            { $set: update },
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