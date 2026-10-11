require("dotenv").config();
const { io } = require("socket.io-client");

const passengerId = process.env.TEST_DRIVER_USER_ID;

if (!/^[a-f0-9]{24}$/i.test(passengerId || "")) {
    throw new Error("Valid TEST_PASSENGER_ID required");
}

const socket = io(
    process.env.WEBSOCKET_URL || "http://localhost:5001",
    {
        auth: { token: process.env.WEBSOCKET_SERVICE_TOKEN },
        transports: ["websocket"],
        reconnection: false,
        timeout: 10000,
    }
);

socket.on("connect", () => {
    socket.timeout(5000).emit(
        "internal:publish",
        {
            event: "ride:created",
            room: `driver:${passengerId}`,
            payload: {
                rideId: "TEST_ONLY",
                status: "TEST_NOTIFICATION",
            },
        },
        (error, response) => {
            console.log(error ? error.message : response);
            socket.disconnect();
        }
    );
});

socket.on("connect_error", (error) => {
    console.error(error.message);
    socket.disconnect();
});