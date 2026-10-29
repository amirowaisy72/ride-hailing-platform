"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
    ArrowLeft,
    Check,
    CheckCheck,
    ImagePlus,
    Loader2,
    MessageCircle,
    Send,
    UserRound,
} from "lucide-react";
import { getRealtimeSocket } from "@/lib/socket";
import { useVisibleViewport, visibleViewportSurfaceStyle } from "@/hooks/useVisibleViewport";
import {
    ensureOrderConversation,
    getOrderMessages,
    listOrderConversations,
    markOrderChatRead,
    sendOrderMessage,
    uploadOrderImage,
} from "@/lib/orderChatService";
import StructuredEventCard from "@/components/order/StructuredEventCard";

// Phase 6 — generalized order chat dialog for Buy & Deliver
// purchases and Safar Rentals bookings, modeled on RideChat.jsx
// (full-screen portal, visible-viewport pinning, merge-by-_id,
// socket listener + refetch on reconnect, unread badge, quick
// replies). RideChat itself is untouched.
//
// Messages are TEXT / IMAGE / EVENT. EVENT messages are read-only
// structured cards (see StructuredEventCard) — amounts only ever
// change through the order REST APIs, never through chat.

const QUICK = [
    "Assalam-o-Alaikum",
    "I am on my way",
    "Please wait a few minutes",
    "Can you call me?",
    "Thank you",
];

const same = (a, b) => String(a) === String(b);

const merge = (old, incoming) => {
    const map = new Map();
    for (const item of [...old, ...incoming]) {
        if (!item) continue;
        const key = item._id
            ? String(item._id)
            : item.clientMessageId
                ? `client:${item.clientMessageId}`
                : null;
        if (key) map.set(key, item);
    }
    return Array.from(map.values()).sort(
        (a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0)
    );
};

const newClientMessageId = () =>
    typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;

export default function OrderChat({
    orderType,
    orderId,
    conversationId: conversationIdProp,
    partnerUserId,
    token,
    userId,
    participantLabel = "partner",
    directOpen = false,
    onClose,
}) {
    const [open, setOpen] = useState(false);
    const isOpen = Boolean(directOpen || open);
    const closeChat = () => {
        if (directOpen) onClose?.();
        else setOpen(false);
    };

    const [conversationId, setConversationId] = useState(conversationIdProp || null);
    const [conversation, setConversation] = useState(null);
    const [resolving, setResolving] = useState(false);
    const [messages, setMessages] = useState([]);
    const [hasMore, setHasMore] = useState(false);
    const [loadingMessages, setLoadingMessages] = useState(true);
    const [loadingOlder, setLoadingOlder] = useState(false);
    const [unread, setUnread] = useState(0);
    const [text, setText] = useState("");
    const [sending, setSending] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [error, setError] = useState("");

    const visibleViewport = useVisibleViewport();
    const openRef = useRef(false);
    const known = useRef(new Set());
    const knownClients = useRef(new Set());
    const endRef = useRef(null);
    const fileRef = useRef(null);
    const conversationIdRef = useRef(null);
    useEffect(() => {
        conversationIdRef.current = conversationId;
    }, [conversationId]);

    const closed = conversation?.status === "CLOSED";
    const counterpart = conversation?.counterpart || null;
    const headerName = counterpart?.name || participantLabel;

    useEffect(() => {
        openRef.current = isOpen;
    }, [isOpen]);

    // Reset when the target order changes (render-time state
    // adjustment — the React-docs alternative to a reset effect).
    const targetKey = `${orderType || ""}:${orderId || ""}:${conversationIdProp || ""}`;
    const [prevTargetKey, setPrevTargetKey] = useState(targetKey);
    if (prevTargetKey !== targetKey) {
        setPrevTargetKey(targetKey);
        setMessages([]);
        setHasMore(false);
        setUnread(0);
        setOpen(false);
        setLoadingMessages(true);
        setConversation(null);
        setConversationId(conversationIdProp || null);
    }

    useEffect(() => {
        known.current = new Set();
        knownClients.current = new Set();
    }, [orderId, orderType, conversationIdProp]);

    const remember = useCallback((list) => {
        for (const m of list || []) {
            if (m?._id) known.current.add(String(m._id));
            if (m?.clientMessageId) knownClients.current.add(String(m.clientMessageId));
        }
    }, []);

    const load = useCallback(async (id) => {
        const targetId = id || conversationIdRef.current;
        if (!targetId || !token) return;
        try {
            const data = await getOrderMessages(targetId, { limit: 50 }, token);
            const incoming = Array.isArray(data.messages) ? data.messages : [];
            remember(incoming);
            setMessages((old) => merge(old, incoming));
            setHasMore(Boolean(data.hasMore));
            if (openRef.current) setUnread(0);
            setError("");
        } catch (e) {
            setError(e.message);
        }
    }, [token, remember]);

    const loadOlder = useCallback(async () => {
        const targetId = conversationIdRef.current;
        if (!targetId || !token || loadingOlder || messages.length === 0) return;
        const oldest = messages[0];
        if (!oldest?._id) return;
        setLoadingOlder(true);
        try {
            const data = await getOrderMessages(
                targetId,
                { limit: 50, before: oldest._id },
                token
            );
            const incoming = Array.isArray(data.messages) ? data.messages : [];
            remember(incoming);
            setMessages((old) => merge(incoming, old));
            setHasMore(Boolean(data.hasMore));
        } catch (e) {
            setError(e.message);
        } finally {
            setLoadingOlder(false);
        }
    }, [token, loadingOlder, messages, remember]);

    // Resolve the conversation: an explicit id wins; otherwise find
    // an existing conversation for this order, creating one only
    // when the chat is actually opened (never as a side effect of
    // rendering a list row).
    useEffect(() => {
        if (!isOpen || conversationId || !token || !orderType || !orderId) return;
        let cancelled = false;
        (async () => {
            setResolving(true);
            try {
                const listed = await listOrderConversations({ orderType, orderId }, token);
                const existing = (listed.conversations || [])[0];
                if (cancelled) return;
                if (existing?._id) {
                    setConversation(existing);
                    setConversationId(String(existing._id));
                    return;
                }
                if (!partnerUserId) {
                    setError("Chat is not available for this order yet.");
                    return;
                }
                const created = await ensureOrderConversation(
                    { orderType, orderId, partnerUserId },
                    token
                );
                if (cancelled) return;
                const conv = created.conversation;
                if (conv?._id) {
                    setConversation(conv);
                    setConversationId(String(conv._id));
                } else {
                    setError("Chat is not available for this order yet.");
                }
            } catch (e) {
                if (!cancelled) setError(e.message);
            } finally {
                if (!cancelled) setResolving(false);
            }
        })();
        return () => { cancelled = true; };
    }, [isOpen, conversationId, token, orderType, orderId, partnerUserId]);

    // When only a conversationId was given, fetch its metadata once
    // (closed state + counterpart) from the order's conversation list.
    useEffect(() => {
        if (!conversationId || conversation || !token || !orderType || !orderId) return;
        let cancelled = false;
        listOrderConversations({ orderType, orderId }, token)
            .then((listed) => {
                if (cancelled) return;
                const found = (listed.conversations || []).find(
                    (c) => same(c._id, conversationId)
                );
                if (found) setConversation(found);
            })
            .catch(() => { /* Header falls back to participantLabel. */ });
        return () => { cancelled = true; };
    }, [conversationId, conversation, token, orderType, orderId]);

    // Initial load + poll fallback while open.
    useEffect(() => {
        if (!isOpen || !conversationId) return;
        let mounted = true;
        (async () => {
            if (messages.length === 0) setLoadingMessages(true);
            try {
                await load();
            } finally {
                if (mounted) setLoadingMessages(false);
            }
        })();
        const timer = setInterval(() => {
            if (!document.hidden) void load();
        }, 15_000);
        return () => {
            mounted = false;
            clearInterval(timer);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, conversationId, load]);

    // Socket: live messages for this conversation + join the chat
    // room; on reconnect re-join and refetch (reconnection-safe).
    useEffect(() => {
        if (!token) return;
        const socket = getRealtimeSocket();
        if (!socket) return;

        const joinRoom = () => {
            const id = conversationIdRef.current;
            if (id) socket.emit("chat:join", { conversationId: id }, () => { });
        };

        const onMessage = (payload) => {
            const id = conversationIdRef.current;
            if (!id || !same(payload?.conversationId, id) || !payload.message?._id) return;
            const msg = payload.message;
            const msgId = String(msg._id);
            if (known.current.has(msgId)) return;
            if (msg.clientMessageId && knownClients.current.has(String(msg.clientMessageId))) return;
            known.current.add(msgId);
            if (msg.clientMessageId) knownClients.current.add(String(msg.clientMessageId));
            setMessages((old) => merge(old, [msg]));
            if (!same(msg.senderId, userId) && !openRef.current) {
                setUnread((n) => Math.min(n + 1, 99));
            }
            if (!same(msg.senderId, userId) && openRef.current) {
                const cid = conversationIdRef.current;
                if (cid) void markOrderChatRead(cid, token).catch(() => { });
            }
        };

        const onConnect = () => {
            joinRoom();
            if (openRef.current) void load();
        };

        const onVisible = () => {
            if (document.visibilityState === "visible" && openRef.current) void load();
        };

        socket.on("chat:message:new", onMessage);
        socket.on("connect", onConnect);
        document.addEventListener("visibilitychange", onVisible);
        if (socket.connected) joinRoom();

        return () => {
            socket.off("chat:message:new", onMessage);
            socket.off("connect", onConnect);
            document.removeEventListener("visibilitychange", onVisible);
        };
    }, [token, userId, load, conversationId]);

    useEffect(() => {
        if (isOpen) endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, [messages.length, isOpen]);

    async function send(value) {
        const body = typeof value === "string" ? value.trim() : "";
        if (!body || sending || closed || !conversationId) return;
        setSending(true);
        const clientMessageId = newClientMessageId();
        try {
            const data = await sendOrderMessage(
                conversationId,
                { clientMessageId, kind: "TEXT", body },
                token
            );
            if (data.message) {
                remember([data.message]);
                setMessages((old) => merge(old, [data.message]));
            }
            setText("");
            setError("");
        } catch (e) {
            setError(e.message);
        } finally {
            setSending(false);
        }
    }

    async function sendImage(file) {
        if (!file || uploading || closed || !conversationId) return;
        setUploading(true);
        try {
            const uploaded = await uploadOrderImage(file, token);
            const imageUrl = uploaded.imageUrl || uploaded.url;
            if (!imageUrl) throw new Error("Image upload failed");
            const data = await sendOrderMessage(
                conversationId,
                { clientMessageId: newClientMessageId(), kind: "IMAGE", imageUrl },
                token
            );
            if (data.message) {
                remember([data.message]);
                setMessages((old) => merge(old, [data.message]));
            }
            setError("");
        } catch (e) {
            setError(e.message);
        } finally {
            setUploading(false);
        }
    }

    return (
        <>
            {!directOpen && (
                <button
                    type="button"
                    onClick={() => { setUnread(0); setOpen(true); }}
                    className="relative flex h-12 items-center justify-center gap-2 rounded-2xl bg-[#111111] px-4 text-sm font-bold text-white transition-transform active:scale-[0.98]"
                >
                    <MessageCircle size={18} aria-hidden="true" />
                    Message {participantLabel}
                    {unread > 0 && (
                        <span className="rounded-full bg-[#087F5B] px-2 py-0.5 text-[11px] font-extrabold text-white">
                            {unread === 99 ? "99+" : unread}
                            <span className="sr-only"> unread messages</span>
                        </span>
                    )}
                </button>
            )}

            {isOpen && createPortal(
                <div
                    style={visibleViewportSurfaceStyle(visibleViewport)}
                    className="fixed inset-0 z-[100] flex h-dvh flex-col overflow-hidden bg-white text-[#111111]"
                    role="dialog"
                    aria-modal="true"
                    aria-label="Order messages"
                >
                    <header className="flex shrink-0 items-center gap-3 border-b border-[#EEF0F2] bg-white px-4 pb-3 pt-[max(12px,env(safe-area-inset-top))] shadow-sm">
                        <button
                            type="button"
                            onClick={closeChat}
                            aria-label="Close chat"
                            className="flex h-11 w-11 items-center justify-center rounded-full bg-[#F4F5F7] hover:bg-[#E9EBEE]"
                        >
                            <ArrowLeft size={20} />
                        </button>
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#087F5B] text-white">
                            {counterpart?.photo ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={counterpart.photo} alt="" className="h-full w-full object-cover" />
                            ) : (
                                <UserRound size={22} />
                            )}
                        </div>
                        <div className="min-w-0 flex-1">
                            <p className="truncate font-extrabold tracking-tight">
                                Chat with {headerName}
                            </p>
                            <p className="text-xs capitalize text-[#9CA3AF]">
                                {orderType === "RENTAL" ? "Rental booking" : "Buy & Deliver order"}
                            </p>
                        </div>
                    </header>

                    {closed && (
                        <p className="shrink-0 bg-amber-50 px-4 py-2.5 text-center text-xs font-bold text-amber-700">
                            This conversation is closed
                        </p>
                    )}

                    <main className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain bg-[#F4F5F7] p-4 pb-6" aria-live="polite">
                        {hasMore && messages.length > 0 && (
                            <div className="flex justify-center">
                                <button
                                    type="button"
                                    onClick={loadOlder}
                                    disabled={loadingOlder}
                                    className="rounded-full bg-white px-4 py-2 text-xs font-bold text-[#087F5B] shadow-sm disabled:opacity-50"
                                >
                                    {loadingOlder ? "Loading…" : "Load older messages"}
                                </button>
                            </div>
                        )}

                        {(resolving || (loadingMessages && messages.length === 0)) ? (
                            <div role="status" aria-label="Loading messages" className="mx-auto mt-12 flex flex-col items-center gap-3 text-sm font-semibold text-[#6B7280]">
                                <span className="h-9 w-9 animate-spin rounded-full border-[3px] border-[#E5E7EB] border-t-[#111111]" />
                                Loading messages…
                            </div>
                        ) : !error && messages.length === 0 ? (
                            <div className="mx-auto mt-10 max-w-xs rounded-3xl bg-white p-7 text-center shadow-sm">
                                <span className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 text-[#087F5B]">
                                    <MessageCircle size={24} aria-hidden="true" />
                                </span>
                                <p className="text-sm font-semibold">No messages yet</p>
                                <p className="mt-1 text-xs text-[#6B7280]">
                                    Say hello to coordinate your {orderType === "RENTAL" ? "rental" : "shopping"}.
                                </p>
                            </div>
                        ) : null}

                        {messages.map((m) => {
                            if (m.kind === "EVENT") {
                                return <StructuredEventCard key={m._id || m.clientMessageId} message={m} />;
                            }
                            const mine = same(m.senderId, userId);
                            return (
                                <div key={m._id || m.clientMessageId} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                                    <div className={`max-w-[82%] px-4 py-3 text-[14px] leading-relaxed shadow-sm ${mine ? "rounded-2xl rounded-br-md bg-[#087F5B] text-white" : "rounded-2xl rounded-bl-md bg-white"}`}>
                                        {m.kind === "IMAGE" && m.imageUrl ? (
                                            // eslint-disable-next-line @next/next/no-img-element
                                            <img src={m.imageUrl} alt="Shared photo" className="max-h-56 w-full rounded-xl object-cover" />
                                        ) : (
                                            <p className="whitespace-pre-wrap break-words">{m.body}</p>
                                        )}
                                        <p className={`mt-1 flex items-center justify-end gap-1 text-right text-[10px] ${mine ? "text-emerald-100" : "text-[#9CA3AF]"}`}>
                                            {m.createdAt
                                                ? new Date(m.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                                                : ""}
                                            {mine && (m.kind === "TEXT" || m.kind === "IMAGE") && (
                                                m.readAt
                                                    ? <CheckCheck size={13} aria-label="Read" />
                                                    : <Check size={13} aria-label="Sent" />
                                            )}
                                        </p>
                                    </div>
                                </div>
                            );
                        })}
                        <div ref={endRef} />
                    </main>

                    {!closed && (
                        <div className="flex shrink-0 gap-2 overflow-x-auto border-t border-[#EEF0F2] bg-white px-3 py-2.5" style={{ scrollbarWidth: "none" }}>
                            {QUICK.map((q) => (
                                <button
                                    key={q}
                                    type="button"
                                    disabled={sending || !conversationId}
                                    onClick={() => send(q)}
                                    className="shrink-0 whitespace-nowrap rounded-full border border-[#E9EBEE] bg-[#F9FAFB] px-3.5 py-2 text-xs font-semibold text-[#111111] transition-colors hover:bg-[#E9EBEE] disabled:opacity-50"
                                >
                                    {q}
                                </button>
                            ))}
                        </div>
                    )}

                    {error && <p role="alert" className="shrink-0 bg-white px-4 py-2 text-xs font-medium text-[#E5484D]">{error}</p>}

                    <form
                        onSubmit={(e) => { e.preventDefault(); send(text); }}
                        className="flex shrink-0 items-end gap-2 border-t border-[#EEF0F2] bg-white px-3 pb-[max(14px,env(safe-area-inset-bottom))] pt-3"
                    >
                        <input
                            ref={fileRef}
                            type="file"
                            accept="image/*"
                            className="hidden"
                            aria-hidden="true"
                            tabIndex={-1}
                            onChange={(e) => {
                                const file = e.target.files?.[0];
                                e.target.value = "";
                                if (file) void sendImage(file);
                            }}
                        />
                        <button
                            type="button"
                            disabled={uploading || closed || !conversationId}
                            onClick={() => fileRef.current?.click()}
                            aria-label="Attach a photo"
                            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#F4F5F7] text-[#111111] transition-transform active:scale-95 disabled:opacity-50"
                        >
                            {uploading ? <Loader2 size={19} className="animate-spin" /> : <ImagePlus size={19} />}
                        </button>
                        <input
                            value={text}
                            maxLength={1000}
                            disabled={closed}
                            onChange={(e) => setText(e.target.value)}
                            placeholder={closed ? "This conversation is closed" : "Write a message..."}
                            className="min-h-12 min-w-0 flex-1 rounded-2xl border border-[#E5E7EB] bg-[#F4F5F7] px-4 text-base text-[#111111] outline-none placeholder:text-[#9CA3AF] focus:border-[#087F5B] focus:ring-2 focus:ring-[#087F5B]/30 disabled:opacity-60"
                            aria-label="Message"
                        />
                        <button
                            type="submit"
                            disabled={sending || closed || !text.trim() || !conversationId}
                            aria-label="Send message"
                            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#087F5B] text-white transition-transform active:scale-95 disabled:bg-[#E9EBEE] disabled:text-[#9CA3AF]"
                        >
                            <Send size={19} />
                        </button>
                    </form>
                </div>,
                document.body
            )}
        </>
    );
}
