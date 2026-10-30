const mongoose = require("mongoose");

const OrderConversation = require("../models/OrderConversation");
const OrderMessage = require("../models/OrderMessage");
const PurchaseOrder = require("../models/PurchaseOrder");
const PurchaseOffer = require("../models/PurchaseOffer");
const RentalBooking = require("../models/RentalBooking");
const Driver = require("../models/Driver");
const User = require("../models/User");
const { publishEvent } = require("../services/socketService");
const { sendPushToUser } = require("../services/pushService");
const {
    uploadToCloudinary,
    uploadAudioToCloudinary,
} = require("../integrations/cloudinary/uploadService");
const {
    mapEventType,
    mapSenderRole,
    computeConversationClosed,
    effectiveConversationStatus,
    eventBelongsInConversation,
    buildEventKey,
    buildOfferEventKey,
    validateOutgoingMessage,
} = require("../services/orderChatService");

// ---------------------------------------------------------------------------
// Phase 6 — order chat (Buy & Deliver + Rentals).
//
// Participants are ALWAYS resolved server-side from the order itself:
// the passenger, plus one partner thread per counterparty (a Driver for
// PURCHASE, the RentalPartner's user for RENTAL). There is no role gate
// beyond being a party to the order / a participant of the thread.
//
// Amounts NEVER originate here: EVENT messages are materialized from
// the order's validated events[] log and from PurchaseOffer records by
// syncConversationEvents() — this controller creates no order events
// and mutates no order state.
// ---------------------------------------------------------------------------

const isValidId = (value) => mongoose.isValidObjectId(value);
const sameId = (a, b) => !!a && !!b && String(a) === String(b);

// --- Order loading + party resolution ---------------------------------------

async function loadOrder(orderType, orderId) {
    if (!isValidId(orderId)) return null;
    if (orderType === "PURCHASE") return PurchaseOrder.findById(orderId);
    if (orderType === "RENTAL") return RentalBooking.findById(orderId);
    return null;
}

// Every legitimate partner thread for an order, as
// [{ partnerUserId, partnerRefId }]. PURCHASE: the assigned driver plus
// every driver with an offer on the order. RENTAL: the booking partner.
async function legitimatePartners(orderType, order) {
    if (orderType === "RENTAL") {
        return [
            {
                partnerUserId: order.partnerUserId,
                partnerRefId: order.rentalPartnerId,
            },
        ];
    }

    const partners = new Map();
    const offers = await PurchaseOffer.find({ orderId: order._id })
        .select("driverId")
        .lean();
    const driverIds = new Set(offers.map((offer) => String(offer.driverId)));
    if (order.driverId) driverIds.add(String(order.driverId));
    if (!driverIds.size) return [];

    const drivers = await Driver.find({ _id: { $in: [...driverIds] } })
        .select("_id userId")
        .lean();
    for (const driver of drivers) {
        partners.set(String(driver.userId), {
            partnerUserId: driver.userId,
            partnerRefId: driver._id,
        });
    }
    return [...partners.values()];
}

// Is the caller a party to the ORDER at all? (Endpoint 1 gate.)
async function isOrderParty(orderType, order, userId) {
    if (sameId(order.passengerId, userId)) return true;
    const partners = await legitimatePartners(orderType, order);
    return partners.some((p) => sameId(p.partnerUserId, userId));
}

function closedInput(conversation, order) {
    return {
        orderType: conversation.orderType,
        orderStatus: order ? order.status : null,
        orderDriverId:
            conversation.orderType === "PURCHASE" && order ? order.driverId : null,
        partnerRefId: conversation.partnerRefId,
        storedStatus: conversation.status,
    };
}

function isClosed(conversation, order) {
    return computeConversationClosed(closedInput(conversation, order));
}

// --- Serialization ------------------------------------------------------------

function serializeMessage(doc) {
    const m = doc && typeof doc.toObject === "function" ? doc.toObject() : doc;
    return {
        _id: m._id,
        conversationId: m.conversationId,
        senderId: m.senderId || null,
        senderRole: m.senderRole,
        kind: m.kind,
        body: m.body || "",
        imageUrl: m.imageUrl || "",
        audioUrl: m.audioUrl || "",
        audioMime: m.audioMime || "",
        audioDurationSec: m.audioDurationSec ?? null,
        eventType: m.eventType || null,
        event: m.event || null,
        clientMessageId: m.clientMessageId || null,
        readAt: m.readAt || null,
        createdAt: m.createdAt,
    };
}

function userDisplay(user) {
    if (!user) return { userId: null, name: "", photo: "" };
    const name = [user.firstName, user.lastName].filter(Boolean).join(" ").trim();
    return { userId: user._id, name, photo: user.profileImage || "" };
}

async function serializeConversation(conversation, order, callerId) {
    const callerIsPassenger = sameId(conversation.passengerId, callerId);
    const counterpartId = callerIsPassenger
        ? conversation.partnerUserId
        : conversation.passengerId;
    const counterpartUser = await User.findById(counterpartId)
        .select("firstName lastName profileImage")
        .lean();

    const [unreadCount, lastMessage] = await Promise.all([
        OrderMessage.countDocuments({
            conversationId: conversation._id,
            senderId: { $ne: callerId },
            readAt: null,
        }),
        OrderMessage.findOne({ conversationId: conversation._id })
            .sort({ createdAt: -1 })
            .lean(),
    ]);

    return {
        _id: conversation._id,
        orderType: conversation.orderType,
        orderId: conversation.orderId,
        passengerId: conversation.passengerId,
        partnerUserId: conversation.partnerUserId,
        partnerRefId: conversation.partnerRefId,
        status: effectiveConversationStatus(closedInput(conversation, order)),
        counterpart: userDisplay(counterpartUser),
        unreadCount,
        lastMessage: lastMessage ? serializeMessage(lastMessage) : null,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
    };
}

// --- Event sync ----------------------------------------------------------------
// Materializes EVENT messages for one conversation from the order's
// events[] log (+ the partner's PurchaseOffer snapshot for PURCHASE).
// Idempotent: eventKey is unique-sparse, existing keys are skipped, and
// the offer card is upserted so a resubmitted fee updates the SAME card.

async function syncConversationEvents(conversation, order) {
    if (!order) return;
    const orderType = conversation.orderType;
    const docs = [];

    // Offer snapshot card (PURCHASE only, this thread's driver only).
    if (orderType === "PURCHASE") {
        const offer = await PurchaseOffer.findOne({
            orderId: order._id,
            driverId: conversation.partnerRefId,
        }).lean();
        if (offer) {
            const eventKey = buildOfferEventKey(offer._id);
            const snapshot = {
                type: "OFFER",
                amount: offer.deliveryFee,
                note: offer.status,
                fromStatus: null,
                toStatus: null,
                actorRole: "DRIVER",
                createdAt: offer.createdAt,
                offerId: offer._id,
            };
            await OrderMessage.updateOne(
                { eventKey },
                {
                    $set: { event: snapshot, eventType: "OFFER" },
                    $setOnInsert: {
                        conversationId: conversation._id,
                        senderId: conversation.partnerUserId,
                        senderRole: "DRIVER",
                        kind: "EVENT",
                        body: "",
                        imageUrl: "",
                        eventKey,
                        createdAt: offer.createdAt,
                    },
                },
                { upsert: true }
            );
        }
    }

    const events = Array.isArray(order.events) ? order.events : [];
    events.forEach((event, index) => {
        if (
            !eventBelongsInConversation({
                orderType,
                rawType: event.type,
                actorId: event.actorId,
                partnerUserId: conversation.partnerUserId,
                partnerRefId: conversation.partnerRefId,
                orderDriverId: orderType === "PURCHASE" ? order.driverId : null,
            })
        ) {
            return;
        }
        docs.push({
            conversationId: conversation._id,
            senderId: event.actorId || null,
            senderRole: mapSenderRole(event.actorRole),
            kind: "EVENT",
            body: "",
            imageUrl: "",
            eventType: mapEventType(orderType, event.type),
            event: {
                type: event.type,
                amount: event.amount ?? null,
                note: event.note || "",
                fromStatus: event.fromStatus || null,
                toStatus: event.toStatus || null,
                actorRole: event.actorRole || "SYSTEM",
                createdAt: event.createdAt,
            },
            eventKey: buildEventKey(orderType, order._id, index, event.type),
            createdAt: event.createdAt,
        });
    });

    if (docs.length) {
        const keys = docs.map((d) => d.eventKey);
        const existing = await OrderMessage.find({
            conversationId: conversation._id,
            eventKey: { $in: keys },
        })
            .select("eventKey")
            .lean();
        const seen = new Set(existing.map((m) => m.eventKey));
        const fresh = docs.filter((d) => !seen.has(d.eventKey));
        if (fresh.length) {
            // ordered:false + catch: a racing sync may insert the same
            // eventKey first — the unique index makes that a no-op here.
            await OrderMessage.insertMany(fresh, { ordered: false }).catch(
                () => {}
            );
        }
    }
}

// Sync every persisted thread of an order (used on conversation list).
async function syncOrderConversations(orderType, order) {
    const conversations = await OrderConversation.find({
        orderType,
        orderId: order._id,
    });
    for (const conversation of conversations) {
        await syncConversationEvents(conversation, order);
    }
    return conversations;
}

// Loads a conversation + its order and verifies the caller participates.
async function loadParticipantConversation(req, res) {
    if (!isValidId(req.params.id)) {
        res.status(404).json({ success: false, message: "Conversation not found" });
        return null;
    }
    const conversation = await OrderConversation.findById(req.params.id);
    if (!conversation) {
        res.status(404).json({ success: false, message: "Conversation not found" });
        return null;
    }
    const uid = req.user._id;
    if (!sameId(conversation.passengerId, uid) && !sameId(conversation.partnerUserId, uid)) {
        res.status(403).json({ success: false, message: "Access denied" });
        return null;
    }
    const order = await loadOrder(conversation.orderType, conversation.orderId);
    return { conversation, order };
}

async function markOthersRead(conversationId, callerId) {
    await OrderMessage.updateMany(
        { conversationId, senderId: { $ne: callerId }, readAt: null },
        { $set: { readAt: new Date() } }
    );
}

// ---------------------------------------------------------------------------
// 1. GET /order-chats?orderType&orderId — list threads for an order
// ---------------------------------------------------------------------------
async function listConversations(req, res) {
    try {
        const { orderType, orderId } = req.query;
        if (!["PURCHASE", "RENTAL"].includes(orderType) || !isValidId(orderId)) {
            return res.status(400).json({
                success: false,
                message: "orderType (PURCHASE|RENTAL) and a valid orderId are required",
            });
        }
        const order = await loadOrder(orderType, orderId);
        if (!order) {
            return res.status(404).json({ success: false, message: "Order not found" });
        }
        if (!(await isOrderParty(orderType, order, req.user._id))) {
            return res.status(403).json({ success: false, message: "Access denied" });
        }

        await syncOrderConversations(orderType, order);

        const filter = { orderType, orderId: order._id };
        if (!sameId(order.passengerId, req.user._id)) {
            // A partner sees ONLY their own thread.
            filter.partnerUserId = req.user._id;
        }
        const conversations = await OrderConversation.find(filter).sort({
            updatedAt: -1,
        });

        const serialized = [];
        for (const conversation of conversations) {
            serialized.push(
                await serializeConversation(conversation, order, req.user._id)
            );
        }
        return res.json({ success: true, conversations: serialized });
    } catch (error) {
        console.error("List order conversations", error);
        return res.status(500).json({ success: false, message: "Unable to load conversations" });
    }
}

// ---------------------------------------------------------------------------
// 2. POST /order-chats — get-or-create a thread
// ---------------------------------------------------------------------------
async function getOrCreateConversation(req, res) {
    try {
        const { orderType, orderId } = req.body || {};
        if (!["PURCHASE", "RENTAL"].includes(orderType) || !isValidId(orderId)) {
            return res.status(400).json({
                success: false,
                message: "orderType (PURCHASE|RENTAL) and a valid orderId are required",
            });
        }
        const order = await loadOrder(orderType, orderId);
        if (!order) {
            return res.status(404).json({ success: false, message: "Order not found" });
        }

        const partners = await legitimatePartners(orderType, order);
        let partner = null;

        if (sameId(order.passengerId, req.user._id)) {
            const { partnerUserId } = req.body || {};
            if (!isValidId(partnerUserId)) {
                return res.status(400).json({
                    success: false,
                    message: "partnerUserId is required",
                });
            }
            // Passenger purchase APIs expose the counterparty's Driver /
            // RentalPartner record id (partnerRefId), not their User id —
            // accept either and resolve to the partner's User id here.
            // Both ids come from the same legitimate-partner record, so
            // this never widens access beyond this order's counterparties.
            partner = partners.find(
                (p) =>
                    sameId(p.partnerUserId, partnerUserId) ||
                    sameId(p.partnerRefId, partnerUserId)
            );
            if (!partner) {
                return res.status(403).json({
                    success: false,
                    message: "That user is not a counterparty on this order",
                });
            }
        } else {
            // Partner caller: partnerUserId is forced to self.
            partner = partners.find((p) => sameId(p.partnerUserId, req.user._id));
            if (!partner) {
                return res.status(403).json({ success: false, message: "Access denied" });
            }
        }

        let conversation = await OrderConversation.findOne({
            orderType,
            orderId: order._id,
            partnerUserId: partner.partnerUserId,
        });
        if (!conversation) {
            try {
                conversation = await OrderConversation.create({
                    orderType,
                    orderId: order._id,
                    passengerId: order.passengerId,
                    partnerUserId: partner.partnerUserId,
                    partnerRefId: partner.partnerRefId,
                });
            } catch (error) {
                if (error.code !== 11000) throw error;
                conversation = await OrderConversation.findOne({
                    orderType,
                    orderId: order._id,
                    partnerUserId: partner.partnerUserId,
                });
            }
        }

        await syncConversationEvents(conversation, order);
        const serialized = await serializeConversation(
            conversation,
            order,
            req.user._id
        );
        return res.json({ success: true, conversation: serialized });
    } catch (error) {
        console.error("Get/create order conversation", error);
        return res.status(500).json({ success: false, message: "Unable to open conversation" });
    }
}

// ---------------------------------------------------------------------------
// 3. GET /order-chats/:id/messages — history (marks the other's read)
// ---------------------------------------------------------------------------
async function getMessages(req, res) {
    try {
        const context = await loadParticipantConversation(req, res);
        if (!context) return undefined;
        const { conversation, order } = context;

        await syncConversationEvents(conversation, order);
        await markOthersRead(conversation._id, req.user._id);

        const limit = Math.min(
            Math.max(parseInt(req.query.limit, 10) || 50, 1),
            100
        );

        const filter = { conversationId: conversation._id };
        if (isValidId(req.query.before)) {
            const beforeMessage = await OrderMessage.findOne({
                _id: req.query.before,
                conversationId: conversation._id,
            })
                .select("createdAt")
                .lean();
            if (beforeMessage) filter.createdAt = { $lt: beforeMessage.createdAt };
        }

        const fetched = await OrderMessage.find(filter)
            .sort({ createdAt: -1 })
            .limit(limit + 1)
            .lean();
        const hasMore = fetched.length > limit;
        const page = fetched.slice(0, limit).reverse();

        return res.json({
            success: true,
            messages: page.map(serializeMessage),
            hasMore,
        });
    } catch (error) {
        console.error("Load order chat messages", error);
        return res.status(500).json({ success: false, message: "Unable to load messages" });
    }
}

// ---------------------------------------------------------------------------
// 4. POST /order-chats/:id/messages — send (idempotent)
// ---------------------------------------------------------------------------
async function sendMessage(req, res) {
    try {
        const context = await loadParticipantConversation(req, res);
        if (!context) return undefined;
        const { conversation, order } = context;

        const validation = validateOutgoingMessage(req.body || {});
        if (!validation.valid) {
            return res.status(400).json({ success: false, message: validation.message });
        }

        const senderId = req.user._id;
        const clientMessageId = req.body.clientMessageId.trim();

        const existing = await OrderMessage.findOne({
            conversationId: conversation._id,
            senderId,
            clientMessageId,
        });
        if (existing) {
            return res.json({
                success: true,
                message: serializeMessage(existing),
                duplicate: true,
            });
        }

        if (isClosed(conversation, order)) {
            return res.status(403).json({
                success: false,
                message: "This conversation is closed",
            });
        }

        const callerIsPassenger = sameId(conversation.passengerId, senderId);
        const senderRole = callerIsPassenger
            ? "PASSENGER"
            : conversation.orderType === "RENTAL"
              ? "PARTNER"
              : "DRIVER";
        const otherUserId = callerIsPassenger
            ? conversation.partnerUserId
            : conversation.passengerId;

        let message;
        try {
            message = await OrderMessage.create({
                conversationId: conversation._id,
                senderId,
                senderRole,
                kind: validation.kind,
                body: validation.body,
                imageUrl: validation.imageUrl,
                audioUrl: validation.audioUrl || "",
                audioMime: validation.audioMime || "",
                audioDurationSec: validation.audioDurationSec ?? null,
                clientMessageId,
            });
        } catch (error) {
            if (error.code === 11000) {
                const raced = await OrderMessage.findOne({
                    conversationId: conversation._id,
                    senderId,
                    clientMessageId,
                });
                if (raced) {
                    return res.json({
                        success: true,
                        message: serializeMessage(raced),
                        duplicate: true,
                    });
                }
            }
            throw error;
        }

        await OrderConversation.updateOne(
            { _id: conversation._id },
            { $set: { lastMessageAt: message.createdAt } }
        );

        const serialized = serializeMessage(message);
        const payload = {
            conversationId: String(conversation._id),
            orderType: conversation.orderType,
            orderId: String(conversation.orderId),
            message: serialized,
        };
        publishEvent("chat:message:new", `chat:${conversation._id}`, payload);
        publishEvent("chat:message:new", `user:${otherUserId}`, payload);

        void sendPushToUser(
            otherUserId,
            "New message",
            validation.kind === "IMAGE"
                ? "Sent a photo"
                : validation.kind === "AUDIO"
                  ? "🎤 Voice message"
                  : validation.body.slice(0, 100),
            {
                type: "ORDER_CHAT",
                conversationId: String(conversation._id),
                orderType: conversation.orderType,
                orderId: String(conversation.orderId),
            }
        );

        return res.status(201).json({ success: true, message: serialized });
    } catch (error) {
        console.error("Send order chat message", error);
        return res.status(500).json({ success: false, message: "Message failed" });
    }
}

// ---------------------------------------------------------------------------
// 5. POST /order-chats/:id/read
// ---------------------------------------------------------------------------
async function markRead(req, res) {
    try {
        const context = await loadParticipantConversation(req, res);
        if (!context) return undefined;
        await markOthersRead(context.conversation._id, req.user._id);
        return res.json({ success: true });
    } catch (error) {
        console.error("Mark order chat read", error);
        return res.status(500).json({ success: false, message: "Unable to mark read" });
    }
}

// ---------------------------------------------------------------------------
// 6. GET /order-chats/unread/counts
// ---------------------------------------------------------------------------
async function getUnreadCounts(req, res) {
    try {
        const conversations = await OrderConversation.find({
            $or: [
                { passengerId: req.user._id },
                { partnerUserId: req.user._id },
            ],
        })
            .select("_id orderType orderId")
            .lean();

        const entries = [];
        let total = 0;
        for (const conversation of conversations) {
            const count = await OrderMessage.countDocuments({
                conversationId: conversation._id,
                senderId: { $ne: req.user._id },
                readAt: null,
            });
            if (count > 0) {
                total += count;
                entries.push({
                    conversationId: conversation._id,
                    orderType: conversation.orderType,
                    orderId: conversation.orderId,
                    count,
                });
            }
        }
        return res.json({ success: true, total, conversations: entries });
    } catch (error) {
        console.error("Order chat unread counts", error);
        return res.status(500).json({ success: false, message: "Unable to load unread counts" });
    }
}

// ---------------------------------------------------------------------------
// 7. POST /order-chats/upload — image upload for chat
// ---------------------------------------------------------------------------
async function uploadChatImage(req, res) {
    try {
        if (!req.file?.buffer) {
            return res.status(400).json({ success: false, message: "An image file is required" });
        }
        const { imageUrl } = await uploadToCloudinary(
            req.file.buffer,
            String(req.user._id)
        );
        return res.json({ success: true, imageUrl });
    } catch (error) {
        console.error("Order chat image upload", error);
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || "Upload failed",
        });
    }
}

// ---------------------------------------------------------------------------
// 8. POST /order-chats/upload-audio — audio upload for chat voice messages
// ---------------------------------------------------------------------------
async function uploadChatAudio(req, res) {
    try {
        if (!req.file?.buffer) {
            return res.status(400).json({ success: false, message: "An audio file is required" });
        }
        const { audioUrl } = await uploadAudioToCloudinary(
            req.file.buffer,
            String(req.user._id)
        );
        return res.json({ success: true, audioUrl });
    } catch (error) {
        console.error("Order chat audio upload", error);
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || "Upload failed",
        });
    }
}

module.exports = {
    listConversations,
    getOrCreateConversation,
    getMessages,
    sendMessage,
    markRead,
    getUnreadCounts,
    uploadChatImage,
    uploadChatAudio,
};
