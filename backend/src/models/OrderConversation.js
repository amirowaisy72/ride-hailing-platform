const mongoose = require("mongoose");

// Phase 6 — one chat thread per (order, partner). A PurchaseOrder can
// have several threads (one per bidding / assigned driver); a
// RentalBooking has exactly one (its partner). The passenger is always
// one side; `partnerUserId` is the OTHER side as a User id (a Driver's
// user for PURCHASE, the RentalPartner's user for RENTAL), and
// `partnerRefId` is that partner's domain record id (Driver id for
// PURCHASE, RentalPartner id for RENTAL).
//
// `status` is the STORED status. The EFFECTIVE status can also be
// CLOSED by computation (losing bidder after assignment, terminal
// order) — see services/orderChatService.computeConversationClosed,
// which the controller applies lazily on every read/write.
const orderConversationSchema = new mongoose.Schema(
    {
        orderType: {
            type: String,
            enum: ["PURCHASE", "RENTAL"],
            required: true,
            index: true,
        },
        orderId: {
            type: mongoose.Schema.Types.ObjectId,
            required: true,
            index: true,
        },
        passengerId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
            index: true,
        },
        partnerUserId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
            index: true,
        },
        partnerRefId: {
            type: mongoose.Schema.Types.ObjectId,
            required: true,
        },
        status: {
            type: String,
            enum: ["ACTIVE", "CLOSED"],
            default: "ACTIVE",
        },
        lastMessageAt: { type: Date, default: null },
    },
    { timestamps: true }
);

orderConversationSchema.index(
    { orderType: 1, orderId: 1, partnerUserId: 1 },
    { unique: true }
);

module.exports = mongoose.model("OrderConversation", orderConversationSchema);
