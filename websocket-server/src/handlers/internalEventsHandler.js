
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
        // Phase 4 — Buy & Deliver (PurchaseOrder) server->client events.
        "purchase:request:new",
        "purchase:offer:new",
        "purchase:offer:accepted",
        "purchase:offer:rejected",
        "purchase:status:updated",
        "purchase:approval:requested",
        "purchase:approval:decision",
        "purchase:disputed",
        // Phase 5 — Safar Rentals server->client events.
        "rental:request:new",
        "rental:booking:updated",
        "rental:payment:submitted",
        "rental:disputed",
        // Phase 6 — Order chat (Buy & Deliver + Rentals) events.
        "chat:message:new",
    ];

    socket.on("internal:publish", (data, callback) => {
        const { event, room, payload } = data || {};

        if (
            !allowedEvents.includes(event) ||
            typeof room !== "string" ||
            !/^(ride|user|passenger|driver|chat):[a-f0-9]{24}$/i.test(room)
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
