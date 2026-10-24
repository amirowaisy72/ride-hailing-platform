
const mongoose = require("mongoose");

const registerRideRoomHandler = (io, socket) => {
    socket.on("ride:join", async (data, callback) => {
        try {
            const { rideId } = data || {};

            if (!mongoose.isValidObjectId(rideId)) {
                return callback?.({
                    success: false,
                    message: "Invalid ride ID",
                });
            }

            const ride = await mongoose.connection.db
                .collection("rides")
                .findOne({
                    _id: new mongoose.Types.ObjectId(rideId),
                });

            if (!ride) {
                return callback?.({
                    success: false,
                    message: "Ride not found",
                });
            }

            const userId = socket.user.id;

            const isPassenger =
                socket.user.role === "PASSENGER" &&
                ride.passengerId.toString() === userId;

            let isDriver = false;

            if (socket.user.role === "DRIVER" && ride.driverId) {
                const driver = await mongoose.connection.db
                    .collection("drivers")
                    .findOne({
                        _id: ride.driverId,
                        userId: new mongoose.Types.ObjectId(userId),
                    });

                isDriver = Boolean(driver);
            }

            if (!isPassenger && !isDriver) {
                return callback?.({
                    success: false,
                    message: "Access denied",
                });
            }

            if (["CANCELLED", "EXPIRED", "TRIP_COMPLETED"].includes(ride.status)) {
                return callback?.({
                    success: false,
                    message: "Ride is no longer active",
                });
            }

            socket.join(`ride:${rideId}`);

            callback?.({
                success: true,
                message: "Joined ride room",
            });
        } catch (error) {
            console.error("Ride room error:", error.message);
            callback?.({
                success: false,
                message: "Unable to join ride",
            });
        }
    });
};

module.exports = { registerRideRoomHandler };
