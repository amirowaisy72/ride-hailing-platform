
const mongoose = require("mongoose");
const Ride = require("../models/Ride");
const RideOffer = require("../models/RideOffer");
const Driver = require("../models/Driver");
const Vehicle = require("../models/Vehicle");
const { publishEvent } = require("../services/socketService");
const { sendPushToUser } = require("../services/pushService");

const selectDriver = async (req, res) => {
    const { rideId } = req.params;
    const { offerId } = req.body || {};

    if (
        !mongoose.isValidObjectId(rideId) ||
        !mongoose.isValidObjectId(offerId)
    ) {
        return res.status(400).json({
            success: false,
            message: "Invalid ride or offer ID",
        });
    }

    try {
        const result = await mongoose.connection.transaction(
            async (session) => {
                const ride = await Ride.findOne({
                    _id: rideId,
                    passengerId: req.user._id,
                    status: { $in: ["REQUESTED", "SEARCHING", "BIDDING"] },
                    driverId: null,
                }).session(session);

                if (!ride) return { error: "Ride unavailable" };

                const offer = await RideOffer.findOne({
                    _id: offerId,
                    rideId,
                    status: "PENDING",
                    expiresAt: { $gt: new Date() },
                }).session(session);

                if (!offer) return { error: "Offer unavailable" };

                const driver = await Driver.findOneAndUpdate(
                    {
                        _id: offer.driverId,
                        verificationStatus: "APPROVED",
                        isOnline: true,
                        isAvailable: true,
                    },
                    { $set: { isAvailable: false } },
                    { session, returnDocument: "after" }
                );

                if (!driver) return { error: "Driver unavailable" };

                const validVehicle = await Vehicle.exists({
                    _id: driver.currentVehicleId,
                    driverId: driver._id,
                    vehicleType: ride.vehicleType,
                    verificationStatus: "APPROVED",
                    isActive: true,
                }).session(session);

                if (!validVehicle) {
                    throw new Error("DRIVER_VEHICLE_INVALID");
                }

                ride.driverId = driver._id;
                ride.finalPrice = offer.price;
                ride.status = "DRIVER_SELECTED";
                ride.acceptedAt = new Date();
                await ride.save({ session });

                offer.status = "ACCEPTED";
                await offer.save({ session });

                await RideOffer.updateMany(
                    {
                        rideId,
                        _id: { $ne: offer._id },
                        status: "PENDING",
                    },
                    { $set: { status: "REJECTED" } },
                    { session }
                );

                return {
                    rideId: ride._id,
                    driverId: driver._id,
                    driverUserId: driver.userId.toString(),
                };
            }
        );

        if (result.error) {
            return res.status(409).json({
                success: false,
                message: result.error,
            });
        }

        publishEvent(
            "ride:driver:selected",
            `driver:${result.driverUserId}`,
            {
                rideId: result.rideId.toString(),
                driverId: result.driverId.toString(),
            }
        );

        void sendPushToUser(
            result.driverUserId,
            "Ride Confirmed",
            "Passenger accepted your offer. Head to pickup.",
            {
                type: "RIDE_SELECTED",
                rideId: result.rideId.toString(),
            }
        );

        return res.json({
            success: true,
            message: "Driver selected successfully",
            ...result,
        });
    } catch (error) {
        if (error.message === "DRIVER_VEHICLE_INVALID") {
            return res.status(409).json({
                success: false,
                message: "Driver vehicle is unavailable or not approved",
            });
        }

        console.error("Driver selection error:", error.message);

        return res.status(500).json({
            success: false,
            message: "Driver selection failed",
        });
    }
};

module.exports = { selectDriver };
