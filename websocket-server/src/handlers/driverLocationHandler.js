
const mongoose = require("mongoose");

const registerDriverLocationHandler = (io, socket) => {
    if (socket.user.role !== "DRIVER") return;

    socket.on("driver:location", async (data, callback) => {
        try {
            const { latitude, longitude } = data || {};

            if (
                typeof latitude !== "number" ||
                typeof longitude !== "number" ||
                !Number.isFinite(latitude) ||
                !Number.isFinite(longitude) ||
                Math.abs(latitude) > 90 ||
                Math.abs(longitude) > 180
            ) {
                return callback?.({ success: false, message: "Invalid coordinates" });
            }

            const driver = await mongoose.connection.db
                .collection("drivers")
                .findOne({
                    userId: new mongoose.Types.ObjectId(socket.user.id),
                    verificationStatus: "APPROVED",
                    isOnline: true,
                });

            if (!driver) {
                return callback?.({
                    success: false,
                    message: "Approved online driver required",
                });
            }

            // Temporary location update.
            // Redis-based live location storage will be added later.
            const updateResult = await mongoose.connection.db.collection("drivers").updateOne(
                { _id: driver._id, isOnline: true },
                {
                    $set: {
                        currentLocation: {
                            type: "Point",
                            coordinates: [longitude, latitude],
                        },
                        lastLocationAt: new Date(),
                    },
                }
            );

            if (updateResult.matchedCount !== 1) {
                return callback?.({
                    success: false,
                    message: "Driver is no longer online",
                });
            }

            const activeRide = await mongoose.connection.db
                .collection("rides")
                .findOne({
                    driverId: driver._id,
                    status: {
                        $in: [
                            "DRIVER_SELECTED",
                            "DRIVER_EN_ROUTE",
                            "DRIVER_ARRIVED",
                            "TRIP_STARTED",
                        ],
                    },
                });

            if (activeRide) {
                const passengerRoom = `passenger:${activeRide.passengerId}`;

                io.to(passengerRoom).emit("ride:driver:location", {
                    rideId: activeRide._id.toString(),
                    driverId: driver._id.toString(),
                    latitude,
                    longitude,
                    updatedAt: new Date().toISOString(),
                });
            }


            callback?.({ success: true });
        } catch (error) {
            console.error("Driver location socket error:", error.message);
            callback?.({ success: false, message: "Location update failed" });
        }
    });
};

module.exports = { registerDriverLocationHandler };
