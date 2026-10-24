
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");

const socketAuth = async (socket, next) => {
    try {
        const token = socket.handshake.auth?.token;

        const serviceToken = process.env.WEBSOCKET_SERVICE_TOKEN;

        if (
            serviceToken &&
            typeof token === "string" &&
            token.length === serviceToken.length &&
            require("crypto").timingSafeEqual(
                Buffer.from(token),
                Buffer.from(serviceToken)
            )
        ) {
            socket.user = {
                id: "backend-service",
                role: "SERVICE",
            };
            return next();
        }

        if (!token) {
            return next(new Error("Authentication required"));
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET, {
            algorithms: ["HS256"],
        });

        if (!mongoose.isValidObjectId(decoded.userId)) {
            return next(new Error("Invalid user"));
        }

        const user = await mongoose.connection.db
            .collection("users")
            .findOne({
                _id: new mongoose.Types.ObjectId(decoded.userId),
                emailVerified: true,
                status: "ACTIVE",
            });

        if (!user) {
            return next(new Error("Unauthorized account"));
        }

        socket.user = {
            id: user._id.toString(),
            role: user.role,
        };

        next();
    } catch (error) {
        next(new Error("Invalid or expired token"));
    }
};

module.exports = socketAuth;
