
const registerInternalEventsHandler = (io, socket) => {
    if (socket.user.role !== "SERVICE") return;

    const allowedEvents = [
        "ride:created",
        "ride:offer:new",
        "ride:driver:selected",
        "ride:cancelled",
        "ride:started",
        "ride:status:updated",
        "ride:completed",
    ];

    socket.on("internal:publish", (data, callback) => {
        const { event, room, payload } = data || {};

        if (
            !allowedEvents.includes(event) ||
            typeof room !== "string" ||
            !/^(ride|user|passenger|driver):[a-f0-9]{24}$/i.test(room)
        ) {
            return callback?.({
                success: false,
                message: "Invalid internal event",
            });
        }

        io.to(room).emit(event, payload);

        callback?.({ success: true });
    });
};

module.exports = { registerInternalEventsHandler };
