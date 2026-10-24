
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

module.exports = {
    connectSocket,
    getSocket,
    publishEvent,
};
