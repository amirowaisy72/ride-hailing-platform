import { io } from "socket.io-client";

let socket = null;

export function connectRealtime(accessToken) {
    if (!accessToken) return null;

    if (socket) {
        socket.disconnect();
    }

    socket = io(
        process.env.NEXT_PUBLIC_WEBSOCKET_URL || "http://localhost:5001",
        {
            auth: { token: accessToken },
            transports: ["websocket"],
            reconnection: true,
            reconnectionDelay: 1000,
            reconnectionDelayMax: 5000,
            timeout: 15000,
            autoConnect: true,
        }
    );

    socket.on("connect_error", (error) => {
        console.error("Realtime connection error:", error.message);
    });

    return socket;
}

export function getRealtimeSocket() {
    return socket;
}

export function disconnectRealtime() {
    if (socket) {
        socket.disconnect();
        socket = null;
    }
}


export function updateRealtimeToken(accessToken) {
    if (!socket || !accessToken) return;

    socket.auth = { token: accessToken };

    if (socket.connected) {
        socket.disconnect();
    }

    socket.connect();
}

export function pauseRealtime() {
    if (socket) {
        socket.disconnect();
    }
}

export function resumeRealtime() {
    if (socket && !socket.connected) {
        socket.connect();
    }
}
