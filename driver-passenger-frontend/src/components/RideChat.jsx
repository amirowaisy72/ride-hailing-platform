"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, MessageCircle, Send, Phone, CheckCheck, UserRound } from "lucide-react";
import { apiRequest } from "@/lib/api";
import { getRealtimeSocket } from "@/lib/socket";
const QUICK = ["I'm at the pickup", "Please wait 2 minutes", "Where are you?", "Please call me"];
const same = (a, b) => String(a) === String(b);
const merge = (old, incoming) => {
    const map = new Map();
    for (const item of [...old, ...incoming]) if (item?._id) map.set(String(item._id), item);
    return Array.from(map.values()).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
};
export default function RideChat({ rideId, token, userId, directOpen = false, onClose, driverPhone, participantLabel = "driver", participantPhoto = "", participantFullName = "" }) {
    const [open, setOpen] = useState(false);
    const [profileOpen, setProfileOpen] = useState(false);
    const isOpen = Boolean(directOpen || open);
    const closeChat = () => { if (directOpen) onClose?.(); else setOpen(false); };
    const callNumber = typeof driverPhone === "string" && /^[+\d ()-]{7,20}$/.test(driverPhone.trim()) ? driverPhone.trim() : "";
    const [messages, setMessages] = useState([]);
    const [loadingMessages, setLoadingMessages] = useState(true);
    const [unread, setUnread] = useState(0);
    const [text, setText] = useState("");
    const [sending, setSending] = useState(false);
    const [error, setError] = useState("");
    const openRef = useRef(false);
    const known = useRef(new Set());
    const endRef = useRef(null);
    useEffect(() => { openRef.current = isOpen; if (isOpen) setUnread(0); }, [isOpen]);
    useEffect(() => { known.current = new Set(); setMessages([]); setUnread(0); setOpen(false); setLoadingMessages(true); }, [rideId]);
    const load = useCallback(async () => {
        if (!rideId || !token) { setError("Chat unavailable. Please reopen the ride."); return; }
        try {
            const data = await apiRequest(`/rides/${rideId}/messages`, { token });
            const incoming = Array.isArray(data.messages) ? data.messages : [];
            incoming.forEach((m) => known.current.add(String(m._id)));
            setMessages((old) => merge(old, incoming));
            setError("");
        } catch (e) { setError(e.message); }
    }, [rideId, token]);
    useEffect(() => {
        if (!rideId || !token) return;
        const socket = getRealtimeSocket();
        const onMessage = (payload) => {
            if (!same(payload?.rideId, rideId) || !payload.message?._id) return;
            const msg = payload.message;
            const id = String(msg._id);
            if (known.current.has(id)) return;
            known.current.add(id);
            setMessages((old) => merge(old, [msg]));
            if (!same(msg.senderId, userId) && !openRef.current) setUnread((n) => Math.min(n + 1, 99));
        };
        const onResume = () => { if (openRef.current) load(); };
        socket?.on("ride:chat:new", onMessage);
        socket?.on("connect", onResume);
        const onVisible = () => { if (document.visibilityState === "visible" && openRef.current) load(); };
        document.addEventListener("visibilitychange", onVisible);
        return () => {
            socket?.off("ride:chat:new", onMessage);
            socket?.off("connect", onResume);
            document.removeEventListener("visibilitychange", onVisible);
        };
    }, [rideId, token, userId, load]);
    useEffect(() => {
        if (!isOpen) return;
        let mounted = true;
        // Keep existing messages visible when refreshing; show loader only on an empty chat.
        if (messages.length === 0) setLoadingMessages(true);
        void load().finally(() => {
            if (mounted) setLoadingMessages(false);
        });
        const timer = setInterval(() => { if (!document.hidden) void load(); }, 15_000);
        return () => { mounted = false; clearInterval(timer); };
    }, [isOpen, load]);
    useEffect(() => { if (isOpen) endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }, [messages.length, isOpen]);
    async function send(value) {
        const body = value.trim();
        if (!body || sending || body.length > 1000) return;
        setSending(true);
        try {
            const data = await apiRequest(`/rides/${rideId}/messages`, {
                method: "POST", token, body: JSON.stringify({ body }),
            });
            if (data.message?._id) {
                known.current.add(String(data.message._id));
                setMessages((old) => merge(old, [data.message]));
            }
            setText(""); setError("");
        } catch (e) { setError(e.message); } finally { setSending(false); }
    }
    return <>
        {!directOpen && <button
            type="button"
            onClick={() => setOpen(true)}
            className="relative flex h-12 items-center justify-center gap-2 rounded-2xl bg-[#111111] px-4 text-sm font-bold text-white transition-transform active:scale-[0.98]"
        >
            <MessageCircle size={18} aria-hidden="true" />
            Message {participantLabel}
            {unread > 0 && (
                <span className="rounded-full bg-[#C1F11D] px-2 py-0.5 text-[11px] font-extrabold text-[#111111]">
                    {unread === 99 ? "99+" : unread}
                    <span className="sr-only"> unread messages</span>
                </span>
            )}
        </button>}
        {isOpen && <div className="fixed inset-0 z-[100] flex h-dvh flex-col overflow-hidden bg-white text-[#111111] dark:!bg-[#101216] dark:!text-[#F5F7FA]" role="dialog" aria-modal="true" aria-label="Ride messages">
            <header className="flex shrink-0 items-center gap-3 border-b border-[#EEF0F2] bg-white px-4 pb-3 pt-[max(12px,env(safe-area-inset-top))] shadow-sm">
                <button
                    type="button"
                    onClick={closeChat}
                    aria-label="Close chat"
                    className="flex h-11 w-11 items-center justify-center rounded-full bg-[#F4F5F7] hover:bg-[#E9EBEE]"
                >
                    <ArrowLeft size={20} />
                </button>
                <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#C1F11D] text-[#111111]">
                    {participantPhoto ? (
                        <img
                            src={participantPhoto}
                            alt={participantLabel}
                            className="h-full w-full object-cover"
                            onError={(e) => {
                                e.currentTarget.style.display = "none";
                                e.currentTarget.nextElementSibling.style.display = "block";
                            }}
                        />
                    ) : null}
                    <UserRound
                        size={22}
                        style={{ display: participantPhoto ? "none" : "block" }}
                    />
                </div>
                <button
                    type="button"
                    onClick={() => setProfileOpen(true)}
                    className="min-w-0 flex-1 text-left"
                >
                    <p className="truncate font-extrabold tracking-tight">
                        Chat with {participantLabel}
                    </p>
                    <p className="text-xs text-[#9CA3AF]">
                        Tap to view passenger profile
                    </p>
                </button>
                {callNumber ? (
                    <a href={`tel:${callNumber.replace(/[^+\d]/g, "")}`} aria-label={`Call ${participantLabel}`} title={`Call ${participantLabel}`}
                        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#C1F11D]">
                        <Phone size={19} />
                    </a>
                ) : (
                    <button type="button" disabled title="Driver phone number unavailable" aria-label="Call unavailable"
                        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#F4F5F7] text-[#9CA3AF]">
                        <Phone size={19} />
                    </button>
                )}
            </header>
            {profileOpen && (
                <div className="absolute inset-0 z-[110] flex flex-col bg-[#101216] text-white">
                    <div className="flex items-center gap-3 px-5 py-4">
                        <button
                            type="button"
                            onClick={() => setProfileOpen(false)}
                            aria-label="Back to chat"
                            className="rounded-full bg-[#252B34] p-3"
                        >
                            <ArrowLeft size={21} />
                        </button>
                        <span className="font-bold">Passenger Profile</span>
                    </div>

                    <div className="flex flex-1 flex-col items-center justify-center gap-6 px-5">
                        <div className="flex h-64 w-64 max-w-full items-center justify-center overflow-hidden rounded-full border-4 border-[#C1F11D] bg-[#252B34]">
                            {participantPhoto ? (
                                <img
                                    src={participantPhoto}
                                    alt={participantFullName || participantLabel}
                                    className="h-full w-full object-cover"
                                    onError={(e) => {
                                        e.currentTarget.style.display = "none";
                                    }}
                                />
                            ) : (
                                <UserRound size={100} className="text-[#C1F11D]" />
                            )}
                        </div>

                        <div className="text-center">
                            <h2 className="text-2xl font-extrabold">
                                {participantFullName || participantLabel}
                            </h2>
                            <p className="mt-2 text-sm text-[#AAB4C2]">
                                Your passenger for this trip
                            </p>
                        </div>
                    </div>

                    <div className="px-5 pb-8 text-center text-xs text-[#AAB4C2]">
                        Profile photo is user-uploaded and does not confirm identity.
                    </div>
                </div>
            )}

            <main className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain bg-[#F4F5F7] p-4 pb-6" aria-live="polite">
                {loadingMessages && messages.length === 0 ? (
                    <div role="status" aria-label="Loading messages" className="mx-auto mt-12 flex flex-col items-center gap-3 text-sm font-semibold text-[#6B7280]">
                        <span className="h-9 w-9 animate-spin rounded-full border-[3px] border-[#E5E7EB] border-t-[#111111]" />
                        Loading messages…
                    </div>
                ) : !error && messages.length === 0 ? (
                    <div className="mx-auto mt-10 max-w-xs rounded-3xl bg-white p-7 text-center shadow-sm">
                        <span className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-[#EFFFBE]">
                            <MessageCircle size={24} aria-hidden="true" />
                        </span>
                        <p className="text-sm font-semibold">No messages yet</p>
                        <p className="mt-1 text-xs text-[#6B7280]">Send a quick note to coordinate your pickup.</p>
                    </div>
                ) : null}
                {messages.map((m) => {
                    const mine = same(m.senderId, userId);
                    return <div key={m._id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                        <div className={`max-w-[82%] px-4 py-3 text-[14px] leading-relaxed shadow-sm ${mine ? "rounded-2xl rounded-br-md bg-[#DFFC79] text-[#111111]" : "rounded-2xl rounded-bl-md bg-white"}`}>
                            <p className="whitespace-pre-wrap break-words">{m.body}</p>
                            <p className={`mt-1 text-right text-[10px] ${mine ? "text-[#4B5563]" : "text-[#9CA3AF]"}`}>
                                {new Date(m.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                            </p>
                        </div>
                    </div>;
                })}
                <div ref={endRef} />
            </main>
            <div className="flex shrink-0 gap-2 overflow-x-auto border-t border-[#EEF0F2] bg-white px-3 py-2.5" style={{ scrollbarWidth: "none" }}>
                {QUICK.map((q) => (
                    <button
                        key={q}
                        type="button"
                        disabled={sending}
                        onClick={() => send(q)}
                        className="shrink-0 whitespace-nowrap rounded-full border border-[#E9EBEE] bg-[#F9FAFB] px-3.5 py-2 text-xs font-semibold text-[#111111] transition-colors hover:bg-[#E9EBEE] disabled:opacity-50 dark:!border-[#434B57] dark:!bg-[#252B34] dark:!text-[#F5F7FA] dark:hover:!bg-[#343D49]"
                    >
                        {q}
                    </button>
                ))}
            </div>
            {error && <p role="alert" className="shrink-0 bg-white px-4 py-2 text-xs font-medium text-[#E5484D]">{error}</p>}
            <form onSubmit={(e) => { e.preventDefault(); send(text); }} className="flex shrink-0 items-end gap-2 border-t border-[#EEF0F2] bg-white px-3 pb-[max(14px,env(safe-area-inset-bottom))] pt-3">
                <input
                    value={text}
                    maxLength={1000}
                    onChange={(e) => setText(e.target.value)}
                    placeholder="Write a message..."
                    className="min-h-12 min-w-0 flex-1 rounded-2xl border border-[#E5E7EB] bg-[#F4F5F7] px-4 text-base text-[#111111] outline-none placeholder:text-[#9CA3AF] focus:border-[#C1F11D] focus:ring-2 focus:ring-[#C1F11D]/30 dark:!border-[#505968] dark:!bg-[#222831] dark:!text-white dark:placeholder:!text-[#AAB4C2] dark:focus:!border-[#C1F11D]"
                    aria-label="Message"
                />
                <button
                    type="submit"
                    disabled={sending || !text.trim()}
                    aria-label="Send message"
                    className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#C1F11D] text-[#111111] transition-transform active:scale-95 disabled:bg-[#E9EBEE] disabled:text-[#9CA3AF] dark:!bg-[#C1F11D] dark:!text-[#111111] dark:disabled:!bg-[#303741] dark:disabled:!text-[#8793A3]"
                >
                    <Send size={19} />
                </button>
            </form>
        </div>}
    </>;
}
