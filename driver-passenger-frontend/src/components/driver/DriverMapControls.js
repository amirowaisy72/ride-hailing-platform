"use client";

import { useEffect, useRef, useState } from "react";
import { Bell, BellRing, CarFront, CheckCircle2, LocateFixed, MessageCircle, TriangleAlert, Volume2, VolumeX, WifiOff, X } from "lucide-react";

const KIND_ICON = { ride: CarFront, success: CheckCircle2, error: TriangleAlert, chat: MessageCircle, offline: WifiOff };

function timeAgo(at) {
    const s = Math.max(0, Math.round((Date.now() - at) / 1000));
    if (s < 60) return "now";
    if (s < 3600) return `${Math.floor(s / 60)}m`;
    return `${Math.floor(s / 3600)}h`;
}

/** Compact top-right control stack: sound, notifications, locate. */
export function DriverMapControls({ notifications, onLocate, locating }) {
    const { items, unread, soundEnabled, toggleSound, markRead, clear } = notifications;
    const [open, setOpen] = useState(false);
    const panelRef = useRef(null);

    useEffect(() => {
        if (!open) return;
        markRead();
        const close = (e) => { if (panelRef.current && !panelRef.current.contains(e.target)) setOpen(false); };
        window.addEventListener("pointerdown", close);
        return () => window.removeEventListener("pointerdown", close);
    }, [open, items.length]); // eslint-disable-line react-hooks/exhaustive-deps

    return (
        <div ref={panelRef} className="dx-controls">
            <button type="button" className="dx-fab" onClick={toggleSound}
                aria-pressed={soundEnabled}
                aria-label={soundEnabled ? "Mute ride alerts" : "Enable ride alert sounds"}>
                {soundEnabled ? <Volume2 size={18} /> : <VolumeX size={18} />}
            </button>
            <button type="button" className="dx-fab" onClick={() => setOpen((v) => !v)}
                aria-expanded={open} aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}>
                {unread ? <BellRing size={18} /> : <Bell size={18} />}
                {unread > 0 && <span className="dx-badge">{unread > 9 ? "9+" : unread}</span>}
            </button>
            <button type="button" className="dx-fab" onClick={onLocate} disabled={locating} aria-label="Centre on my location">
                <LocateFixed size={18} className={locating ? "dx-spin" : ""} />
            </button>

            {open && (
                <div className="dx-notif-panel" role="dialog" aria-label="Notifications">
                    <div className="dx-notif-head">
                        <p>Notifications</p>
                        {items.length > 0 && <button type="button" onClick={clear}>Clear</button>}
                    </div>
                    {items.length === 0 ? (
                        <p className="dx-notif-empty">You're all caught up.</p>
                    ) : (
                        <ul>
                            {items.map((item) => {
                                const Icon = KIND_ICON[item.kind] || Bell;
                                return (
                                    <li key={item.id} data-kind={item.kind}>
                                        <span className="dx-notif-icon"><Icon size={15} /></span>
                                        <span className="min-w-0 flex-1">
                                            <strong>{item.title}</strong>
                                            {item.body && <small>{item.body}</small>}
                                        </span>
                                        <time>{timeAgo(item.at)}</time>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </div>
            )}
        </div>
    );
}

/** Transient banner shown at the top of the map. */
export function DriverToast({ toast, onDismiss }) {
    if (!toast) return null;
    const Icon = KIND_ICON[toast.kind] || Bell;
    return (
        <div key={toast.id} className="dx-toast" data-kind={toast.kind} role={toast.kind === "error" ? "alert" : "status"} aria-live="polite">
            <span className="dx-toast-icon"><Icon size={16} /></span>
            <span className="min-w-0 flex-1">
                <strong>{toast.title}</strong>
                {toast.body && <small>{toast.body}</small>}
            </span>
            <button type="button" onClick={onDismiss} aria-label="Dismiss notification"><X size={15} /></button>
        </div>
    );
}
