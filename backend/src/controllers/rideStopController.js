const mongoose = require("mongoose");
const Ride = require("../models/Ride");
const Driver = require("../models/Driver");
const CommissionSettings = require("../models/CommissionSettings");
const { publishEvent } = require("../services/socketService");

async function updateRideStop(req, res) {
    const { rideId } = req.params;
    const { action } = req.body || {};

    if (
        !mongoose.isValidObjectId(rideId) ||
        !["ARRIVE", "CONTINUE"].includes(action)
    ) {
        return res.status(400).json({
            success: false,
            message: "Invalid stop request",
        });
    }

    try {
        const driver = await Driver.findOne({
            userId: req.user._id,
        }).select("_id");

        if (!driver) {
            return res.status(403).json({
                success: false,
                message: "Driver profile required",
            });
        }

        const ride = await Ride.findOne({
            _id: rideId,
            driverId: driver._id,
            status: "TRIP_STARTED",
        });

        if (!ride) {
            return res.status(409).json({
                success: false,
                message: "Active trip unavailable",
            });
        }

        const stops = ride.stops || [];
        const completed = ride.stopsCompleted || 0;

        if (completed >= stops.length) {
            return res.status(409).json({
                success: false,
                message: "All intermediate stops completed",
            });
        }

        const now = new Date();
        let updated;

        if (action === "ARRIVE") {
            updated = await Ride.findOneAndUpdate(
                {
                    _id: ride._id,
                    status: "TRIP_STARTED",
                    stopsCompleted: completed,
                    stopWaitingSince: null,
                },
                {
                    $set: { stopWaitingSince: now },
                },
                {
                    returnDocument: "after",
                    runValidators: true,
                }
            );
        } else {
            if (!ride.stopWaitingSince) {
                return res.status(409).json({
                    success: false,
                    message: "Mark stop arrival first",
                });
            }

            const seconds = Math.max(
                0,
                Math.floor(
                    (now.getTime() -
                        new Date(ride.stopWaitingSince).getTime()) / 1000
                )
            );

            const settings = await CommissionSettings.findOne({
                key: "GLOBAL",
            }).lean();

            const freeMinutes = settings?.freeWaitingMinutes ?? 5;
            const chargePerMinute = settings?.waitingChargePerMinute ?? 0;
            const billableMinutes = Math.max(
                0,
                Math.ceil(seconds / 60) - freeMinutes
            );
            const charge = Math.round(
                billableMinutes * chargePerMinute * 100
            ) / 100;

            const waitingSession = {
                locationType:
                    ride.tripType === "ROUND_TRIP" &&
                        completed === stops.length - 1
                        ? "OUTBOUND_DESTINATION"
                        : "STOP",
                locationIndex: completed,
                startedAt: ride.stopWaitingSince,
                endedAt: now,
                durationSeconds: seconds,
                freeMinutes,
                chargePerMinute,
                chargedAmount: charge,
            };

            updated = await Ride.findOneAndUpdate(
                {
                    _id: ride._id,
                    status: "TRIP_STARTED",
                    stopsCompleted: completed,
                    stopWaitingSince: ride.stopWaitingSince,
                },
                {
                    $inc: {
                        stopsCompleted: 1,
                        totalStopWaitingSeconds: seconds,
                        waitingCharge: charge,
                    },
                    $set: { stopWaitingSince: null },
                    $push: { waitingSessions: waitingSession },
                },
                {
                    returnDocument: "after",
                    runValidators: true,
                }
            );
        }

        if (!updated) {
            return res.status(409).json({
                success: false,
                message: "Stop state changed; refresh trip",
            });
        }

        const payload = {
            rideId: String(updated._id),
            action,
            stopsCompleted: updated.stopsCompleted,
            stopWaitingSince: updated.stopWaitingSince,
            totalStopWaitingSeconds: updated.totalStopWaitingSeconds,
            waitingCharge: updated.waitingCharge || 0,
            waitingSessions: updated.waitingSessions || [],
            waitingCharge: updated.waitingCharge || 0,
            waitingSessions: updated.waitingSessions || [],
        };

        publishEvent(
            "ride:stop:updated",
            `passenger:${updated.passengerId}`,
            payload
        );

        publishEvent(
            "ride:stop:updated",
            `driver:${req.user._id}`,
            payload
        );

        return res.json({
            success: true,
            ride: updated,
        });
    } catch (error) {
        console.error("Stop update:", error.message);

        return res.status(500).json({
            success: false,
            message: "Stop update failed",
        });
    }
}

module.exports = { updateRideStop };