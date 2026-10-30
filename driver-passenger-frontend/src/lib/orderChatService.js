import { apiRequest } from "@/lib/api";

// Phase 6 — client wrappers for the shared order-chat API
// (/order-chats). One conversation system serves Buy & Deliver
// purchases and Safar Rentals bookings; RideChat (rides/parcels)
// is a separate legacy surface and is untouched.
//
// Contract (backend Phase 6):
//   GET    /order-chats?orderType=PURCHASE|RENTAL&orderId=<id>
//   POST   /order-chats { orderType, orderId, partnerUserId }
//   GET    /order-chats/:id/messages?limit&before  (fetch marks read)
//   POST   /order-chats/:id/messages { clientMessageId, kind, body?, imageUrl? }
//   POST   /order-chats/:id/read
//   GET    /order-chats/unread/counts
//   POST   /order-chats/upload (multipart, field "image") -> { imageUrl }

export const listOrderConversations = ({ orderType, orderId } = {}, token) => {
    const params = new URLSearchParams();
    if (orderType) params.set("orderType", orderType);
    if (orderId) params.set("orderId", String(orderId));
    const query = params.toString();
    return apiRequest(`/order-chats${query ? `?${query}` : ""}`, { token });
};

export const ensureOrderConversation = ({ orderType, orderId, partnerUserId }, token) =>
    apiRequest("/order-chats", {
        method: "POST",
        token,
        body: JSON.stringify({ orderType, orderId, partnerUserId }),
    });

export const getOrderMessages = (conversationId, { limit = 50, before } = {}, token) => {
    const params = new URLSearchParams();
    if (limit) params.set("limit", String(limit));
    if (before) params.set("before", String(before));
    const query = params.toString();
    return apiRequest(`/order-chats/${conversationId}/messages${query ? `?${query}` : ""}`, { token });
};

export const sendOrderMessage = (conversationId, payload, token) =>
    apiRequest(`/order-chats/${conversationId}/messages`, {
        method: "POST",
        token,
        body: JSON.stringify(payload),
    });

export const markOrderChatRead = (conversationId, token) =>
    apiRequest(`/order-chats/${conversationId}/read`, {
        method: "POST",
        token,
    });

export const getOrderChatUnread = (token) =>
    apiRequest("/order-chats/unread/counts", { token });

// Generic image upload reused by chat attachments, Buy & Deliver
// reference photos and rental fee-proof images.
export const uploadOrderImage = (file, token) => {
    const formData = new FormData();
    formData.append("image", file);
    return apiRequest("/order-chats/upload", {
        method: "POST",
        token,
        body: formData,
    });
};

// Voice-message upload (Phase 3, A11b): POST /order-chats/upload-audio
// (multipart, field "audio") -> { audioUrl }. The message itself is
// then sent with kind "AUDIO" through sendOrderMessage.
export const uploadOrderAudio = (file, token) => {
    const formData = new FormData();
    formData.append("audio", file);
    return apiRequest("/order-chats/upload-audio", {
        method: "POST",
        token,
        body: formData,
    });
};
