
require("dotenv").config();

const { io } = require("socket.io-client");

const token = process.env.TEST_ACCESS_TOKEN;

if (!token) {
    console.error("TEST_ACCESS_TOKEN missing");
    process.exit(1);
}

const socket = io("http://localhost:5001", {
    auth: { token },
    reconnection: false,
    timeout: 10000,
});

socket.on("connect", () => {
    console.log("Socket Connected:", socket.id);
});

socket.on("connect_error", (error) => {
    console.error("Connection Failed:", error.message);
    socket.disconnect();
    process.exitCode = 1;
});

socket.on("ride:created", (data) => {
    console.log("LIVE RIDE CREATED:", data);
});

socket.on("ride:offer:new", (data) => {
    console.log("LIVE DRIVER OFFER:", data);
});

socket.on("ride:driver:selected", (data) => {
    console.log("LIVE DRIVER SELECTED:", data);
});

socket.on("disconnect", () => {
    console.log("Socket Disconnected");
});
