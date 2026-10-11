
const { io } = require("socket.io-client");

let socket = null;

const connectSocket = () => {
    if (socket) return socket;

    socket = io(process.env.WEBSOCKET_URL || "http://localhost:5001", {
        autoConnect: false,
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        transports: ["websocket"],
        auth: {
            token: process.env.WEBSOCKET_SERVICE_TOKEN,
        },
    });

    socket.on("connect", () => {
        console.log("Backend connected to WebSocket server");
    });

    socket.on("connect_error", (error) => {
        console.error("WebSocket connection error:", error.message);
    });

    socket.on("disconnect", (reason) => {
        console.warn("WebSocket disconnected:", reason);
    });

    socket.connect();
    return socket;
};

const getSocket = () => socket;

const publishEvent = (event, room, payload) => {
    if (!socket?.connected) {
        console.warn("WebSocket unavailable:", event);
        return false;
    }

    socket.timeout(5000).emit(
        "internal:publish",
        { event, room, payload },
        (error, response) => {
            if (error || !response?.success) {
                console.error("Event publishing failed:", event);
            }
        }
    );

    return true;
};

module.exports = {
    connectSocket,
    getSocket,
    publishEvent,
};
