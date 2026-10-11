const registerRideEventsHandler = (io, socket) => {
    // Client can join authorized ride rooms through rideRoomHandler.
    // Ride status changes must always be performed by the backend API.

    socket.on("ride:leave", (data, callback) => {
        const { rideId } = data || {};

        if (
            typeof rideId !== "string" ||
            !/^[a-f0-9]{24}$/i.test(rideId)
        ) {
            return callback?.({
                success: false,
                message: "Invalid ride ID",
            });
        }

        socket.leave(`ride:${rideId}`);

        callback?.({ success: true });
    });
};

module.exports = { registerRideEventsHandler };