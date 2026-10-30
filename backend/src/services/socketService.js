
let io = null;

const connectSocket = (socketServer) => {
    if (!socketServer) {
        throw new Error("Socket.IO server instance required");
    }

    io = socketServer;
    console.log("Backend connected to local Socket.IO server");

    return io;
};

const getSocket = () => io;

const publishEvent = (event, room, payload) => {
    if (!io) {
        console.warn("WebSocket unavailable:", event);
        return false;
    }

    io.to(room).emit(event, payload);
    return true;
};

// Presence (Amir-test fix round, T-17): a user counts as reachable
// in-app while at least one of their sockets sits in their personal
// `user:<id>` room (joined automatically on connect — see
// realtime/rooms/userRooms.js). The realtime server is in-process
// and single-instance, so the in-memory adapter is authoritative.
// Used to decide whether a chat message ALSO needs an FCM push:
// online recipients get the socket event + in-app alert (T-16);
// offline / app-closed recipients get the push.
const isUserConnected = (userId) => {
    if (!io || !userId) return false;

    try {
        const room = io.sockets.adapter.rooms.get(`user:${userId}`);
        return Boolean(room && room.size > 0);
    } catch {
        return false;
    }
};

module.exports = {
    connectSocket,
    getSocket,
    publishEvent,
    isUserConnected,
};
