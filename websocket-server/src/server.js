
require("dotenv").config();

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const mongoose = require("mongoose");
const socketAuth = require("./middleware/socketAuth");
const { joinUserRooms } = require("./rooms/userRooms");
const { registerDriverLocationHandler } = require("./handlers/driverLocationHandler");
const { registerRideRoomHandler } = require("./handlers/rideRoomHandler");
const { registerRideEventsHandler } = require("./handlers/rideEventsHandler");
const { registerInternalEventsHandler } = require("./handlers/internalEventsHandler");

const app = express();
const httpServer = http.createServer(app);

const io = new Server(httpServer, {
    cors: {
        origin: process.env.FRONTEND_URL || "http://localhost:3000",
        methods: ["GET", "POST"],
    },
});

app.get("/health", (req, res) => {
    res.json({
        success: true,
        message: "WebSocket server running",
    });
});

io.use(socketAuth);

io.on("connection", (socket) => {
    console.log("Authenticated user:", socket.user.id, socket.user.role);
    joinUserRooms(socket);
    registerDriverLocationHandler(io, socket);
    registerRideRoomHandler(io, socket);
    registerRideEventsHandler(io, socket);
    registerInternalEventsHandler(io, socket);
    console.log("Socket connected:", socket.id);

    socket.on("disconnect", () => {
        console.log("Socket disconnected:", socket.id);
    });
});

const PORT = process.env.PORT || 5001;

const startServer = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log("WebSocket MongoDB connected");

        httpServer.listen(PORT, () => {
            console.log(`WebSocket server running on port ${PORT}`);
        });
    } catch (error) {
        console.error("WebSocket startup failed:", error.message);
        process.exit(1);
    }
};

startServer();
