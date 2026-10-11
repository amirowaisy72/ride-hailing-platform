"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MessageCircle, Send, X } from "lucide-react";
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
        <button type="button" onClick={() => setOpen(true)} className="flex items-center gap-2 rounded-xl bg-emerald-700 px-4 py-3 font-bold text-white">
            <MessageCircle size={18} /> Chat {unread > 0 && <span className="rounded-full bg-red-500 px-2 py-0.5 text-xs text-white">{unread === 99 ? "99+" : unread}</span>}
        </button>
        {open && <div className="fixed inset-0 z-[100] flex flex-col bg-white text-slate-900">
            <header className="flex items-center justify-between border-b px-4 py-4 pt-[max(16px,env(safe-area-inset-top))]">
                <strong>Ride messages</strong>
                <button type="button" onClick={() => setOpen(false)} aria-label="Close chat"><X /></button>
            </header>
            <main className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-slate-50 p-4" aria-live="polite">
                {messages.length === 0 && <p className="pt-8 text-center text-sm text-slate-500">Message your driver or passenger about this ride.</p>}
                {messages.map((m) => <div key={m._id} className={`flex ${same(m.senderId, userId) ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm ${same(m.senderId, userId) ? "bg-emerald-700 text-white" : "bg-white shadow-sm"}`}>
                        <p className="whitespace-pre-wrap break-words">{m.body}</p>
                        <p className="mt-1 text-right text-[10px] opacity-70">{new Date(m.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</p>
                    </div>
                </div>)}<div ref={endRef} />
            </main>
            <div className="flex gap-2 overflow-x-auto border-t px-3 py-2">{QUICK.map((q) => <button key={q} type="button" disabled={sending} onClick={() => send(q)} className="shrink-0 rounded-full border px-3 py-2 text-xs disabled:opacity-50">{q}</button>)}</div>
            {error && <p role="alert" className="px-4 py-2 text-xs text-red-600">{error}</p>}
            <form onSubmit={(e) => { e.preventDefault(); send(text); }} className="flex gap-2 border-t bg-white p-3 pb-[max(20px,env(safe-area-inset-bottom))]">
                <input value={text} maxLength={1000} onChange={(e) => setText(e.target.value)} placeholder="Write your own message..." className="min-w-0 min-h-12 flex-1 rounded-xl border-2 border-emerald-200 bg-white px-4 text-base outline-none focus:border-emerald-600" aria-label="Message" />
                <button type="submit" disabled={sending || !text.trim()} aria-label="Send message" className="rounded-xl bg-emerald-700 p-3 text-white disabled:opacity-50"><Send size={20} /></button>
            </form>
        </div>}
    </>;
}
