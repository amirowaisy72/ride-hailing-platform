"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiRequest } from "@/lib/api";
import { getRealtimeSocket } from "@/lib/socket";

// Tracks messages received while the ride chat is closed. Each user/ride has its own read cursor.
export function useRideUnreadMessages(rideId, token, userId, chatOpen) {
    const [unread, setUnread] = useState(0);
    const seen = useRef(new Set());
    const opened = useRef(false);
    const lastRead = useRef(0);
    const key = rideId && userId ? `ride-chat-read:${userId}:${rideId}` : null;
    const markRead = useCallback(() => {
        lastRead.current = Date.now();
        setUnread(0);
        try { if (key) localStorage.setItem(key, String(lastRead.current)); } catch { /* Storage optional. */ }
    }, [key]);

    useEffect(() => {
        seen.current.clear();
        setUnread(0);
        try { lastRead.current = key ? Number(localStorage.getItem(key)) || 0 : 0; }
        catch { lastRead.current = 0; }
        opened.current = false;
    }, [key]);

    useEffect(() => {
        opened.current = Boolean(chatOpen);
        if (chatOpen) markRead();
    }, [chatOpen, markRead]);

    useEffect(() => {
        if (!rideId || !token || !userId) return;
        let cancelled = false;
        const countMessages = (messages) => {
            if (cancelled) return;
            for (const message of messages) {
                const id = String(message?._id || "");
                if (!id || seen.current.has(id)) continue;
                seen.current.add(id);
                if (String(message.senderId?._id || message.senderId) === String(userId)) continue;
                const sentAt = new Date(message.createdAt || 0).getTime();
                if (!opened.current && sentAt > lastRead.current) setUnread((n) => Math.min(n + 1, 99));
            }
        };
        const refresh = async () => {
            try {
                const data = await apiRequest(`/rides/${rideId}/messages`, { token });
                countMessages(Array.isArray(data.messages) ? data.messages : []);
            } catch { /* Chat may be unavailable until assignment finishes. */ }
        };
        const onMessage = (payload) => {
            if (String(payload?.rideId) === String(rideId) && payload.message) countMessages([payload.message]);
        };
        const onVisible = () => { if (!document.hidden) void refresh(); };
        const socket = getRealtimeSocket();
        socket?.on("ride:chat:new", onMessage);
        socket?.on("connect", refresh);
        document.addEventListener("visibilitychange", onVisible);
        void refresh();
        const interval = setInterval(onVisible, 15000);
        return () => {
            cancelled = true;
            clearInterval(interval);
            socket?.off("ride:chat:new", onMessage);
            socket?.off("connect", refresh);
            document.removeEventListener("visibilitychange", onVisible);
        };
    }, [rideId, token, userId]);
    return { unread, markRead };
}
