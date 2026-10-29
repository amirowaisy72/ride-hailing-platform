const { Server } = require("socket.io");

const socketAuth = require("./middleware/socketAuth");
const { joinUserRooms } = require("./rooms/userRooms");

const {
    registerDriverLocationHandler,
} = require("./handlers/driverLocationHandler");

const {
    registerRideRoomHandler,
} = require("./handlers/rideRoomHandler");

const {
    registerRideEventsHandler,
} = require("./handlers/rideEventsHandler");

const {
    registerInternalEventsHandler,
} = require("./handlers/internalEventsHandler");

const {
    registerOrderChatRoomHandler,
} = require("./handlers/orderChatRoomHandler");

function initializeRealtime(httpServer) {
    const io = new Server(httpServer, {
        cors: {
            origin: process.env.FRONTEND_URL || "http://localhost:3000",
            methods: ["GET", "POST"],
        },
    });

    io.use(socketAuth);

    io.on("connection", (socket) => {
        console.log("Socket connected:", socket.id);

        joinUserRooms(socket);
        registerDriverLocationHandler(io, socket);
        registerRideRoomHandler(io, socket);
        registerRideEventsHandler(io, socket);
        registerInternalEventsHandler(io, socket);
        registerOrderChatRoomHandler(io, socket);

        socket.on("disconnect", () => {
            console.log("Socket disconnected:", socket.id);
        });
    });

    return io;
}

module.exports = { initializeRealtime };