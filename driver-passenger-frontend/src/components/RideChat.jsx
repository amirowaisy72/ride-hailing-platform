"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, MessageCircle, Send } from "lucide-react";
import { apiRequest } from "@/lib/api";
import { getRealtimeSocket } from "@/lib/socket";

const QUICK = ["I'm at the pickup", "Please wait 2 minutes", "Where are you?", "Please call me"];
const same = (a, b) => String(a) === String(b);
const merge = (old, incoming) => {
    const map = new Map();
    for (const item of [...old, ...incoming]) if (item?._id) map.set(String(item._id), item);
    return Array.from(map.values()).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
};

export default function RideChat({ rideId, token, userId }) {
    const [open, setOpen] = useState(false);
    const [messages, setMessages] = useState([]);
    const [unread, setUnread] = useState(0);
    const [text, setText] = useState("");
    const [sending, setSending] = useState(false);
    const [error, setError] = useState("");
    const openRef = useRef(false);
    const known = useRef(new Set());
    const endRef = useRef(null);
    useEffect(() => { openRef.current = open; if (open) setUnread(0); }, [open]);
    useEffect(() => { known.current = new Set(); setMessages([]); setUnread(0); setOpen(false); }, [rideId]);

    const load = useCallback(async () => {
        if (!rideId || !token) return;
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
        if (!open) return;
        load();
        const timer = setInterval(() => { if (!document.hidden) load(); }, 15_000);
        return () => clearInterval(timer);
    }, [open, load]);
    useEffect(() => { if (open) endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }, [messages.length, open]);

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
        <button
            type="button"
            onClick={() => setOpen(true)}
            className="relative flex h-12 items-center justify-center gap-2 rounded-2xl bg-[#111111] px-4 text-sm font-bold text-white transition-transform active:scale-[0.98]"
        >
            <MessageCircle size={18} aria-hidden="true" />
            Message driver
            {unread > 0 && (
                <span className="rounded-full bg-[#C1F11D] px-2 py-0.5 text-[11px] font-extrabold text-[#111111]">
                    {unread === 99 ? "99+" : unread}
                    <span className="sr-only"> unread messages</span>
                </span>
            )}
        </button>
        {open && <div className="fixed inset-0 z-[100] flex flex-col bg-white text-[#111111]" role="dialog" aria-modal="true" aria-label="Ride messages">
            <header className="flex items-center gap-3 border-b border-[#EEF0F2] px-3 pb-3 pt-[max(12px,env(safe-area-inset-top))]">
                <button
                    type="button"
                    onClick={() => setOpen(false)}
                    aria-label="Close chat"
                    className="flex h-11 w-11 items-center justify-center rounded-full bg-[#F4F5F7] hover:bg-[#E9EBEE]"
                >
                    <ArrowLeft size={20} />
                </button>
                <div className="min-w-0">
                    <p className="font-extrabold tracking-tight">Ride messages</p>
                    <p className="text-xs text-[#6B7280]">Messages stay within this trip</p>
                </div>
            </header>
            <main className="min-h-0 flex-1 space-y-2.5 overflow-y-auto bg-[#F4F5F7] p-4" aria-live="polite">
                {messages.length === 0 && (
                    <div className="mx-auto mt-10 max-w-xs text-center">
                        <span className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-white">
                            <MessageCircle size={24} aria-hidden="true" />
                        </span>
                        <p className="text-sm font-semibold">No messages yet</p>
                        <p className="mt-1 text-xs text-[#6B7280]">Send a quick note to coordinate your pickup.</p>
                    </div>
                )}
                {messages.map((m) => {
                    const mine = same(m.senderId, userId);
                    return <div key={m._id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                        <div className={`max-w-[82%] px-4 py-2.5 text-sm shadow-sm ${mine ? "rounded-2xl rounded-br-md bg-[#111111] text-white" : "rounded-2xl rounded-bl-md bg-white"}`}>
                            <p className="whitespace-pre-wrap break-words">{m.body}</p>
                            <p className={`mt-1 text-right text-[10px] ${mine ? "text-white/60" : "text-[#9CA3AF]"}`}>
                                {new Date(m.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                            </p>
                        </div>
                    </div>;
                })}
                <div ref={endRef} />
            </main>
            <div className="flex gap-2 overflow-x-auto border-t border-[#EEF0F2] bg-white px-3 py-2.5">
                {QUICK.map((q) => (
                    <button
                        key={q}
                        type="button"
                        disabled={sending}
                        onClick={() => send(q)}
                        className="shrink-0 rounded-full bg-[#F4F5F7] px-3.5 py-2 text-xs font-semibold transition-colors hover:bg-[#E9EBEE] disabled:opacity-50"
                    >
                        {q}
                    </button>
                ))}
            </div>
            {error && <p role="alert" className="bg-white px-4 py-2 text-xs font-medium text-[#E5484D]">{error}</p>}
            <form onSubmit={(e) => { e.preventDefault(); send(text); }} className="flex gap-2 bg-white px-3 pb-[max(16px,env(safe-area-inset-bottom))] pt-1">
                <input
                    value={text}
                    maxLength={1000}
                    onChange={(e) => setText(e.target.value)}
                    placeholder="Write a message..."
                    className="min-h-12 min-w-0 flex-1 rounded-2xl bg-[#F4F5F7] px-4 text-base outline-none placeholder:text-[#9CA3AF] focus:ring-2 focus:ring-[#111111]"
                    aria-label="Message"
                />
                <button
                    type="submit"
                    disabled={sending || !text.trim()}
                    aria-label="Send message"
                    className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#C1F11D] text-[#111111] transition-transform active:scale-95 disabled:bg-[#E9EBEE] disabled:text-[#9CA3AF]"
                >
                    <Send size={19} />
                </button>
            </form>
        </div>}
    </>;
}
