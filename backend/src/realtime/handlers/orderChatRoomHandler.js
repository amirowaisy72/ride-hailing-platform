
const mongoose = require("mongoose");

const registerOrderChatRoomHandler = (io, socket) => {
    socket.on("chat:join", async (data, callback) => {
        try {
            const { conversationId } = data || {};

            if (!mongoose.isValidObjectId(conversationId)) {
                return callback?.({
                    success: false,
                    message: "Invalid conversation ID",
                });
            }

            const conversation = await mongoose.connection.db
                .collection("orderconversations")
                .findOne({
                    _id: new mongoose.Types.ObjectId(conversationId),
                });

            if (!conversation) {
                return callback?.({
                    success: false,
                    message: "Access denied",
                });
            }

            const userId = socket.user.id;

            const isParticipant =
                conversation.passengerId.toString() === userId ||
                conversation.partnerUserId.toString() === userId;

            if (!isParticipant) {
                return callback?.({
                    success: false,
                    message: "Access denied",
                });
            }

            socket.join(`chat:${conversationId}`);

            callback?.({
                success: true,
                message: "Joined chat room",
            });
        } catch (error) {
            console.error("Order chat room error:", error.message);
            callback?.({
                success: false,
                message: "Unable to join chat",
            });
        }
    });

    socket.on("chat:leave", async (data, callback) => {
        try {
            const { conversationId } = data || {};

            if (!mongoose.isValidObjectId(conversationId)) {
                return callback?.({
                    success: false,
                    message: "Invalid conversation ID",
                });
            }

            socket.leave(`chat:${conversationId}`);

            callback?.({
                success: true,
                message: "Left chat room",
            });
        } catch (error) {
            console.error("Order chat room error:", error.message);
            callback?.({
                success: false,
                message: "Unable to leave chat",
            });
        }
    });
};

module.exports = { registerOrderChatRoomHandler };
