const mongoose = require("mongoose");

// Phase 6 — a single message in an OrderConversation.
//
// kind TEXT / IMAGE are written by participants through the REST API.
// kind EVENT messages are NEVER written by clients: they are
// materialized by the server from the order's own validated events[]
// log and from PurchaseOffer records (see
// controllers/orderChatController sync logic) — chat can display
// amounts but can never create or change them. `eventKey` is the
// idempotency key that makes that sync safe to re-run on every fetch.
//
// `clientMessageId` is the client-generated idempotency key for
// participant messages: the unique partial index below guarantees a
// retried send returns the original message instead of a duplicate.
const orderMessageSchema = new mongoose.Schema(
    {
        conversationId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "OrderConversation",
            required: true,
            index: true,
        },
        senderId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            default: null,
        },
        senderRole: {
            type: String,
            enum: ["PASSENGER", "DRIVER", "PARTNER", "SYSTEM"],
            required: true,
        },
        kind: {
            type: String,
            enum: ["TEXT", "IMAGE", "EVENT"],
            required: true,
        },
        body: { type: String, default: "", maxlength: 1000 },
        imageUrl: { type: String, default: "", maxlength: 1000 },
        // Structured card type for EVENT messages (OFFER, ESTIMATE,
        // APPROVAL, ...); null for participant messages.
        eventType: { type: String, default: null },
        // Snapshot of the source event:
        // {type, amount, note, fromStatus, toStatus, actorRole,
        //  createdAt, offerId?}
        event: { type: mongoose.Schema.Types.Mixed, default: null },
        eventKey: { type: String, default: null },
        clientMessageId: { type: String, default: null },
        readAt: { type: Date, default: null },
    },
    { timestamps: true }
);

orderMessageSchema.index({ conversationId: 1, createdAt: 1 });

orderMessageSchema.index(
    { conversationId: 1, senderId: 1, clientMessageId: 1 },
    {
        unique: true,
        partialFilterExpression: { clientMessageId: { $type: "string" } },
    }
);

// Unique among EVENT messages only. This must be a PARTIAL index,
// not a sparse one: participant messages are stored with
// eventKey explicitly null (schema default above), and a sparse
// index still indexes an explicit null — so a sparse unique index
// admits exactly ONE participant message in the whole collection
// and every later chat send fails with E11000 (found by the Phase 8
// integration suite, INT-18). The partial filter below indexes only
// documents whose eventKey is a real string, which is precisely the
// set the sync idempotency guarantee exists for.
orderMessageSchema.index(
    { eventKey: 1 },
    {
        unique: true,
        partialFilterExpression: { eventKey: { $type: "string" } },
    }
);

module.exports = mongoose.model("OrderMessage", orderMessageSchema);
