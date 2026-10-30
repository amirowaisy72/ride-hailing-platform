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
    Mic,
    Send,
    Trash2,
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
    uploadOrderAudio,
    uploadOrderImage,
} from "@/lib/orderChatService";
import { useLanguage } from "@/components/i18n/LanguageProvider";
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

const QUICK_KEYS = ["chat.quick.0", "chat.quick.1", "chat.quick.2", "chat.quick.3", "chat.quick.4"];

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
    const { t } = useLanguage();
    const [text, setText] = useState("");
    const [sending, setSending] = useState(false);
    // Voice-message recording (Phase 3, A11b)
    const [recording, setRecording] = useState(false);
    const [recordSeconds, setRecordSeconds] = useState(0);
    const [sendingVoice, setSendingVoice] = useState(false);
    const recorderRef = useRef(null);
    const recordChunksRef = useRef([]);
    const recordStreamRef = useRef(null);
    const recordTimerRef = useRef(null);
    const recordMimeRef = useRef("");
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
setError(t("chat.notAvailableYet"));
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
setError(t("chat.notAvailableYet"));
                }
            } catch (e) {
                if (!cancelled) setError(e.message);
            } finally {
                if (!cancelled) setResolving(false);
            }
        })();
        return () => { cancelled = true; };
    }, [isOpen, conversationId, token, orderType, orderId, partnerUserId, t]);

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

    // ---- Voice messages (Phase 3, A11b) -------------------------------
    const stopRecordTracks = useCallback(() => {
        if (recordTimerRef.current) {
            clearInterval(recordTimerRef.current);
            recordTimerRef.current = null;
        }
        recordStreamRef.current?.getTracks?.().forEach((track) => track.stop());
        recordStreamRef.current = null;
    }, []);

    useEffect(() => () => stopRecordTracks(), [stopRecordTracks]);

    async function startVoiceRecording() {
        if (recording || closed || !conversationId) return;
        if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
            setError(t("voice.failed"));
            return;
        }
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            recordStreamRef.current = stream;
            const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus", ""];
            const mime = candidates.find((c) => c === "" || MediaRecorder.isTypeSupported(c)) || "";
            recordMimeRef.current = mime;
            const recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
            recordChunksRef.current = [];
            recorder.ondataavailable = (e) => {
                if (e.data && e.data.size > 0) recordChunksRef.current.push(e.data);
            };
            recorderRef.current = recorder;
            setRecordSeconds(0);
            setRecording(true);
            setError("");
            recorder.start(250);
            const startedAt = Date.now();
            recordTimerRef.current = setInterval(() => {
                const secs = Math.floor((Date.now() - startedAt) / 1000);
                setRecordSeconds(secs);
                if (secs >= 300 && recorderRef.current?.state === "recording") {
                    void finishVoiceRecording(true);
                }
            }, 500);
        } catch {
            stopRecordTracks();
            setRecording(false);
            setError(t("voice.denied"));
        }
    }

    function cancelVoiceRecording() {
        const recorder = recorderRef.current;
        if (recorder) {
            recorder.ondataavailable = null;
            recorder.onstop = null;
            try { recorder.stop(); } catch { /* noop */ }
        }
        recorderRef.current = null;
        recordChunksRef.current = [];
        stopRecordTracks();
        setRecording(false);
        setRecordSeconds(0);
    }

    async function finishVoiceRecording(sendIt) {
        const recorder = recorderRef.current;
        if (!recorder) return;
        const durationSec = recordSeconds;
        const blob = await new Promise((resolve) => {
            recorder.onstop = () => resolve(new Blob(recordChunksRef.current, { type: recordMimeRef.current || "audio/webm" }));
            try { recorder.stop(); } catch { resolve(null); }
        });
        recorderRef.current = null;
        recordChunksRef.current = [];
        stopRecordTracks();
        setRecording(false);
        setRecordSeconds(0);
        if (!sendIt) return;
        if (!blob || blob.size === 0 || durationSec < 1) {
            setError(t("voice.tooShort"));
            return;
        }
        const mime = (recordMimeRef.current || "audio/webm").split(";")[0];
        const ext = mime.includes("mp4") ? "m4a" : mime.includes("mpeg") ? "mp3" : mime.includes("ogg") ? "ogg" : mime.includes("wav") ? "wav" : "webm";
        setSendingVoice(true);
        try {
            const file = new File([blob], `voice-message.${ext}`, { type: mime });
            const uploaded = await uploadOrderAudio(file, token);
            const audioUrl = uploaded.audioUrl || uploaded.url;
            if (!audioUrl) throw new Error("upload failed");
            const data = await sendOrderMessage(
                conversationId,
                {
                    clientMessageId: newClientMessageId(),
                    kind: "AUDIO",
                    audioUrl,
                    audioMime: mime,
                    audioDurationSec: Math.min(durationSec, 600),
                },
                token
            );
            if (data.message) {
                remember([data.message]);
                setMessages((old) => merge(old, [data.message]));
            }
            setError("");
        } catch {
            setError(t("voice.failed"));
        } finally {
            setSendingVoice(false);
        }
    }

    return (
        <>
            {!directOpen && (
                <button
                    type="button"
                    onClick={() => { setUnread(0); setOpen(true); }}
                    className="relative flex h-12 items-center justify-center gap-2 rounded-2xl bg-pd-ink px-4 text-sm font-bold text-pd-ink-text transition-transform active:scale-[0.98]"
                >
                    <MessageCircle size={18} aria-hidden="true" />
                    {t("chat.messagePartner", { name: participantLabel })}
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
                    className="fixed inset-0 z-[100] flex h-dvh flex-col overflow-hidden bg-pd-surface text-pd-text"
                    role="dialog"
                    aria-modal="true"
                    aria-label="Order messages"
                >
                    <header className="flex shrink-0 items-center gap-3 border-b border-pd-line bg-pd-surface px-4 pb-3 pt-[max(12px,env(safe-area-inset-top))] shadow-sm">
                        <button
                            type="button"
                            onClick={closeChat}
                            aria-label="Close chat"
                            className="flex h-11 w-11 items-center justify-center rounded-full bg-pd-surface-2 hover:bg-pd-surface-3"
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
                                {t("chat.title", { name: headerName })}
                            </p>
                            <p className="text-xs capitalize text-pd-faint">
                                {orderType === "RENTAL" ? t("chat.rentalBooking") : t("chat.buyDeliverOrder")}
                            </p>
                        </div>
                    </header>

                    {closed && (
                        <p className="shrink-0 bg-pd-warning-soft px-4 py-2.5 text-center text-xs font-bold text-pd-warning">
                            {t("chat.closed")}
                        </p>
                    )}

                    <main className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain bg-pd-bg p-4 pb-6" aria-live="polite">
                        {hasMore && messages.length > 0 && (
                            <div className="flex justify-center">
                                <button
                                    type="button"
                                    onClick={loadOlder}
                                    disabled={loadingOlder}
                                    className="rounded-full bg-pd-surface px-4 py-2 text-xs font-bold text-pd-accent-text shadow-sm disabled:opacity-50"
                                >
                                    {loadingOlder ? t("common.loading") : t("chat.loadOlder")}
                                </button>
                            </div>
                        )}

                        {(resolving || (loadingMessages && messages.length === 0)) ? (
                            <div role="status" aria-label="Loading messages" className="mx-auto mt-12 flex flex-col items-center gap-3 text-sm font-semibold text-pd-muted">
                                <span className="h-9 w-9 animate-spin rounded-full border-[3px] border-pd-line-strong border-t-pd-text" />
                                {t("chat.loadingMessages")}
                            </div>
                        ) : !error && messages.length === 0 ? (
                            <div className="mx-auto mt-10 max-w-xs rounded-3xl bg-pd-surface p-7 text-center shadow-sm">
                                <span className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-pd-accent-soft text-pd-accent-text">
                                    <MessageCircle size={24} aria-hidden="true" />
                                </span>
                                <p className="text-sm font-semibold">{t("chat.noMessages")}</p>
                                <p className="mt-1 text-xs text-pd-muted">
                                    {t("chat.noMessagesHint", { thing: orderType === "RENTAL" ? t("chat.thingRental") : t("chat.thingShopping") })}
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
                                    <div className={`max-w-[82%] px-4 py-3 text-[14px] leading-relaxed shadow-sm ${mine ? "rounded-2xl rounded-br-md bg-[#087F5B] text-white" : "rounded-2xl rounded-bl-md bg-pd-surface"}`}>
                                        {m.kind === "IMAGE" && m.imageUrl ? (
                                            // eslint-disable-next-line @next/next/no-img-element
                                            <img src={m.imageUrl} alt={t("chat.sharedPhoto")} className="max-h-56 w-full rounded-xl object-cover" />
                                        ) : m.kind === "AUDIO" && m.audioUrl ? (
                                            <span className="block min-w-52">
                                                <span className="mb-1 flex items-center gap-1.5 text-xs font-bold">
                                                    <Mic size={13} aria-hidden="true" /> {t("chat.voiceMessage")}
                                                    {m.audioDurationSec ? <span className="font-semibold opacity-80">· {Math.floor(m.audioDurationSec / 60)}:{String(m.audioDurationSec % 60).padStart(2, "0")}</span> : null}
                                                </span>
                                                <audio controls preload="metadata" src={m.audioUrl} className="h-10 w-full max-w-60" aria-label={t("chat.voiceMessage")} />
                                                {m.body ? <span className="mt-1 block whitespace-pre-wrap break-words">{m.body}</span> : null}
                                            </span>
                                        ) : (
                                            <p className="whitespace-pre-wrap break-words">{m.body}</p>
                                        )}
                                        <p className={`mt-1 flex items-center justify-end gap-1 text-right text-[10px] ${mine ? "text-emerald-100" : "text-pd-faint"}`}>
                                            {m.createdAt
                                                ? new Date(m.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                                                : ""}
                                            {mine && (m.kind === "TEXT" || m.kind === "IMAGE" || m.kind === "AUDIO") && (
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
                        <div className="flex shrink-0 gap-2 overflow-x-auto border-t border-pd-line bg-pd-surface px-3 py-2.5" style={{ scrollbarWidth: "none" }}>
                            {QUICK_KEYS.map((key) => (
                                <button
                                    key={key}
                                    type="button"
                                    disabled={sending || !conversationId}
                                    onClick={() => send(t(key))}
                                    className="shrink-0 whitespace-nowrap rounded-full border border-pd-line bg-pd-surface-2 px-3.5 py-2 text-xs font-semibold text-pd-text transition-colors hover:bg-pd-surface-3 disabled:opacity-50"
                                >
                                    {t(key)}
                                </button>
                            ))}
                        </div>
                    )}

                    {error && <p role="alert" className="shrink-0 bg-pd-surface px-4 py-2 text-xs font-medium text-pd-danger">{error}</p>}

                    {recording ? (
                        <div className="flex shrink-0 items-center gap-2 border-t border-pd-line bg-pd-surface px-3 pb-[max(14px,env(safe-area-inset-bottom))] pt-3">
                            <button
                                type="button"
                                onClick={cancelVoiceRecording}
                                aria-label={t("voice.cancel")}
                                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-pd-danger-soft text-pd-danger transition-transform active:scale-95"
                            >
                                <Trash2 size={19} />
                            </button>
                            <div className="flex min-w-0 flex-1 items-center gap-2.5 px-1" role="status">
                                <span className="h-3 w-3 shrink-0 animate-pulse rounded-full bg-pd-danger" aria-hidden="true" />
                                <span className="text-sm font-extrabold tabular-nums">
                                    {Math.floor(recordSeconds / 60)}:{String(recordSeconds % 60).padStart(2, "0")}
                                </span>
                                <span className="truncate text-xs font-semibold text-pd-muted">{t("voice.recording")} {t("voice.tapToSend")}</span>
                            </div>
                            <button
                                type="button"
                                onClick={() => void finishVoiceRecording(true)}
                                disabled={sendingVoice}
                                aria-label={t("voice.send")}
                                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#087F5B] text-white transition-transform active:scale-95 disabled:opacity-60"
                            >
                                {sendingVoice ? <Loader2 size={19} className="animate-spin" /> : <Send size={19} />}
                            </button>
                        </div>
                    ) : (
                    <form
                        onSubmit={(e) => { e.preventDefault(); send(text); }}
                        className="flex shrink-0 items-end gap-2 border-t border-pd-line bg-pd-surface px-3 pb-[max(14px,env(safe-area-inset-bottom))] pt-3"
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
                            aria-label={t("chat.attachPhoto")}
                            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-pd-surface-2 text-pd-text transition-transform active:scale-95 disabled:opacity-50"
                        >
                            {uploading ? <Loader2 size={19} className="animate-spin" /> : <ImagePlus size={19} />}
                        </button>
                        <input
                            value={text}
                            maxLength={1000}
                            disabled={closed}
                            onChange={(e) => setText(e.target.value)}
                            placeholder={closed ? t("chat.closedPlaceholder") : t("chat.writeMessage")}
                            className="min-h-12 min-w-0 flex-1 rounded-2xl border border-pd-line bg-pd-surface-2 px-4 text-base text-pd-text outline-none placeholder:text-pd-faint focus:border-[#087F5B] focus:ring-2 focus:ring-[#087F5B]/30 disabled:opacity-60"
                            aria-label="Message"
                        />
                        <button
                            type="button"
                            disabled={closed || !conversationId || sendingVoice}
                            onClick={() => void startVoiceRecording()}
                            aria-label={t("voice.record")}
                            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-pd-danger-soft text-pd-danger transition-transform active:scale-95 disabled:opacity-50"
                        >
                            <Mic size={19} />
                        </button>
                        <button
                            type="submit"
                            disabled={sending || closed || !text.trim() || !conversationId}
                            aria-label={t("chat.sendMessage")}
                            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#087F5B] text-white transition-transform active:scale-95 disabled:bg-pd-surface-3 disabled:text-pd-faint"
                        >
                            <Send size={19} />
                        </button>
                    </form>
                    )}
                </div>,
                document.body
            )}
        </>
    );
}
