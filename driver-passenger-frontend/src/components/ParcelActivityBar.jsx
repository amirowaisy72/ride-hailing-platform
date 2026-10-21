"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { apiRequest } from "@/lib/api";

export default function ParcelActivityBar({ token, role = "PASSENGER" }) {
    const [order, setOrder] = useState(null);
    const [offset, setOffset] = useState({ x: 0, y: 0 });
    const drag = useRef(null);
    const wasDragged = useRef(false);

    useEffect(() => {
        if (!token) return;

        let active = true;

        async function refresh() {
            try {
                const endpoint = role === "DRIVER"
                    ? "/parcels/driver/my"
                    : "/parcels/my";

                const data = await apiRequest(endpoint, { token });
                if (!active) return;

                const current = (data.orders || []).find(
                    (item) => !["DELIVERED", "CANCELLED", "FAILED"]
                        .includes(item.status)
                );

                setOrder(current || null);
            } catch {
                // Retain last known state during temporary network failure.
            }
        }

        refresh();
        const timer = setInterval(refresh, 5000);

        return () => {
            active = false;
            clearInterval(timer);
        };
    }, [token, role]);

    if (!order) return null;

    const href = role === "DRIVER"
        ? `/driver/parcels/details?parcelId=${order._id}`
        : `/passenger/parcels/details?parcelId=${order._id}`;

    return (
        <Link
            href={href}
            draggable={false}
            onDragStart={(e) => e.preventDefault()}
            className="fixed bottom-[260px] left-4 right-4 z-50 mx-auto max-w-md cursor-grab select-none rounded-2xl border border-gray-200 bg-white p-3 text-[#111111] shadow-lg active:cursor-grabbing"
            style={{
                transform: `translate(${offset.x}px, ${offset.y}px)`,
                touchAction: "none",
            }}
            onPointerDown={(e) => {
                if (e.button !== 0) return;
                wasDragged.current = false;
                drag.current = {
                    x: e.clientX,
                    y: e.clientY,
                    startX: offset.x,
                    startY: offset.y,
                };
                e.currentTarget.setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => {
                if (!drag.current) return;

                const dx = e.clientX - drag.current.x;
                const dy = e.clientY - drag.current.y;

                if (Math.abs(dx) + Math.abs(dy) > 6) {
                    wasDragged.current = true;
                }

                if (!wasDragged.current) return;

                const rect = e.currentTarget.getBoundingClientRect();

                setOffset({
                    x: Math.round(Math.max(
                        -rect.left + offset.x,
                        Math.min(window.innerWidth - rect.right + offset.x, drag.current.startX + dx)
                    )),
                    y: Math.round(Math.max(
                        -rect.top + offset.y,
                        Math.min(window.innerHeight - rect.bottom + offset.y, drag.current.startY + dy)
                    )),
                });
            }}
            onPointerUp={() => {
                drag.current = null;
            }}
            onPointerCancel={() => {
                drag.current = null;
            }}
            onClick={(e) => {
                if (wasDragged.current) {
                    e.preventDefault();
                    wasDragged.current = false;
                }
            }}
        >
            <div className="flex items-center justify-between gap-3">
                <div>
                    <p className="text-sm font-extrabold">
                        📦 Active Parcel Delivery
                    </p>
                    <p className="mt-1 text-xs text-gray-500">
                        {order.status.replaceAll("_", " ")}
                    </p>
                </div>
                <span className="rounded-xl bg-[#C1F11D] px-3 py-2 text-xs font-bold">
                    Track →
                </span>
            </div>
        </Link>
    );
}