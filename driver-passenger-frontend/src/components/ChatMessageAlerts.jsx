"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { MessageCircle, X } from "lucide-react";

import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/components/i18n/LanguageProvider";
import { getRealtimeSocket } from "@/lib/socket";
import { getOrderChatUnread } from "@/lib/orderChatService";
import { chatDeepLink, chatDetailsPath } from "@/lib/chatLinks";

// ---------------------------------------------------------------------------
// Global chat-message alerts (Amir-test fix round, T-16).
//
// Mounted by BOTH section layouts (driver + passenger), so a new chat
// message alerts on ANY page — before this, OrderChat / RideChat only
// existed on their own detail screens and a message arriving while
// the user was elsewhere was simply never announced.
//
// Order chat: the server already broadcasts `chat:message:new` to the
// recipient's personal `user:<id>` room (orderChatController), so no
// room join is needed here. Ride chat broadcasts `ride:chat:new` to
// the passenger:/driver: rooms, which every signed-in socket joins.
//
// A tap opens the relevant chat: order details with ?chat=open (the
// detail pages honour it), ride chat via the role home where the
// active ride's chat lives. Alerts for the conversation the user is
// already looking at are suppressed — that screen's own chat shows
// the message and marks it read.
// ---------------------------------------------------------------------------

const MAX_BANNERS = 3;
const BANNER_TTL_MS = 15000;

function snippetFor(message) {
    if (!message) return "";
    if (message.kind === "IMAGE") return "📷 Photo";
    if (message.kind === "AUDIO") return "🎤 Voice message";
    return String(message.body || "").slice(0, 90);
}

export default function ChatMessageAlerts({ role }) {
    const { t } = useLanguage();
    const { token, user } = useAuth();
    const router = useRouter();
    const pathname = usePathname();
    const [banners, setBanners] = useState([]);
    const pathnameRef = useRef(pathname);
    pathnameRef.current = pathname;
    const userId = String(user?._id || user?.id || "");
    const userIdRef = useRef(userId);
    userIdRef.current = userId;
    const timersRef = useRef(new Map());

    const dismiss = (id) => {
        setBanners((prev) => prev.filter((b) => b.id !== id));
        const timer = timersRef.current.get(id);
        if (timer) {
            clearTimeout(timer);
            timersRef.current.delete(id);
        }
    };

    const pushBanner = (banner) => {
        setBanners((prev) => {
            const deduped = prev.filter((b) => b.id !== banner.id);
            return [banner, ...deduped].slice(0, MAX_BANNERS);
        });
        const timer = setTimeout(() => dismiss(banner.id), BANNER_TTL_MS);
        timersRef.current.set(banner.id, timer);
    };

    // Seed: unread order-chat messages waiting when the app opened.
    useEffect(() => {
        if (!token) return undefined;
        let cancelled = false;
        getOrderChatUnread(token)
            .then((data) => {
                if (cancelled) return;
                const total = Number(data?.total || 0);
                const first = (data?.conversations || []).find((c) => c.count > 0);
                if (total > 0 && first) {
                    pushBanner({
                        id: "unread-summary",
                        title: t("chat.newMessage"),
                        body: t("chat.unreadSummary", {
                            count: total,
                            plural: total === 1 ? "" : "s",
                        }),
                        href: chatDeepLink(role, first.orderType, first.orderId, first.conversationId),
                    });
                }
            })
            .catch(() => { /* Alerts are best-effort; chats still work. */ });
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [token, role]);

    // Live: new messages on either chat system.
    useEffect(() => {
        if (!token) return undefined;
        let socket = null;
        let disposed = false;

        const onOrderMessage = (payload) => {
            const message = payload?.message || {};
            if (!payload?.orderId || String(message.senderId || "") === userIdRef.current) return;
            const href = chatDeepLink(role, payload.orderType, payload.orderId, payload.conversationId);
            // Already on that order's screen: its own chat handles it.
            if (pathnameRef.current === chatDetailsPath(role, payload.orderType)) return;
            pushBanner({
                id: `order:${payload.conversationId}`,
                title: t("chat.newMessage"),
                body: snippetFor(message) || t(payload.orderType === "RENTAL" ? "chat.rentalBooking" : "chat.buyDeliverOrder"),
                href,
            });
        };

        const onRideMessage = (payload) => {
            const senderId = String(payload?.senderId || payload?.message?.senderId || "");
            if (senderId && senderId === userIdRef.current) return;
            const home = role === "DRIVER" ? "/driver" : "/passenger";
            if (pathnameRef.current === home) return;
            pushBanner({
                id: `ride:${payload?.rideId || "active"}`,
                title: t("chat.newMessage"),
                body: snippetFor(payload?.message || payload) || "",
                href: home,
            });
        };

        const attach = () => {
            if (disposed) return;
            socket = getRealtimeSocket();
            if (!socket) return;
            socket.off("chat:message:new", onOrderMessage);
            socket.off("ride:chat:new", onRideMessage);
            socket.on("chat:message:new", onOrderMessage);
            socket.on("ride:chat:new", onRideMessage);
        };

        attach();
        // The socket is created by AuthContext on login/restore; if it
        // was not ready at mount, pick it up shortly after.
        const retry = setInterval(() => {
            if (getRealtimeSocket() && getRealtimeSocket() !== socket) attach();
        }, 3000);

        return () => {
            disposed = true;
            clearInterval(retry);
            if (socket) {
                socket.off("chat:message:new", onOrderMessage);
                socket.off("ride:chat:new", onRideMessage);
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [token, role]);

    if (!token || banners.length === 0) return null;

    return (
        <div className="pointer-events-none fixed inset-x-0 top-[max(10px,env(safe-area-inset-top))] z-[125] mx-auto w-full max-w-xl space-y-2 px-3">
            {banners.map((banner) => (
                <div
                    key={banner.id}
                    role="status"
                    className="pointer-events-auto flex items-center gap-3 rounded-2xl border border-pd-line bg-pd-elevated p-3 shadow-pd-lg backdrop-blur"
                >
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-pd-accent-soft text-pd-accent-text">
                        <MessageCircle size={19} />
                    </span>
                    <button
                        type="button"
                        onClick={() => {
                            dismiss(banner.id);
                            router.push(banner.href);
                        }}
                        className="min-w-0 flex-1 text-left"
                    >
                        <span className="block text-[13px] font-extrabold text-pd-text">
                            {banner.title}
                        </span>
                        <span className="block truncate text-xs text-pd-muted">
                            {banner.body}
                        </span>
                    </button>
                    <button
                        type="button"
                        onClick={() => dismiss(banner.id)}
                        aria-label={t("alerts.dismissOffer")}
                        className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-pd-surface-2 text-pd-muted"
                    >
                        <X size={16} />
                    </button>
                </div>
            ))}
        </div>
    );
}
