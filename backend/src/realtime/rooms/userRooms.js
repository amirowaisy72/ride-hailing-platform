const joinUserRooms = (socket) => {
    const { id, role } = socket.user;

    socket.join(`user:${id}`);

    if (role === "DRIVER") {
        socket.join(`driver:${id}`);
    }

    if (role === "PASSENGER") {
        socket.join(`passenger:${id}`);
    }

    console.log(`User ${id} joined ${role} rooms`);
};

module.exports = { joinUserRooms };