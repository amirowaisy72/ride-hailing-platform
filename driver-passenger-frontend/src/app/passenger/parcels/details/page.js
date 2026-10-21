"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import AuthGuard from "@/components/AuthGuard";
import { useAuth } from "@/context/AuthContext";
import { apiRequest } from "@/lib/api";
import { getRealtimeSocket } from "@/lib/socket";
import dynamic from "next/dynamic";

const ParcelTrackingMap = dynamic(
    () => import("@/components/ParcelTrackingMap"),
    { ssr: false }
);

export default function ParcelDetailsPage() {
    return (
        <AuthGuard role="PASSENGER">
            <ParcelDetails />
        </AuthGuard>
    );
}

function ParcelDetails() {
    const id = useSearchParams().get("parcelId");
    const { token } = useAuth();

    const [order, setOrder] = useState(null);
    const [offers, setOffers] = useState([]);
    const [otp, setOtp] = useState(null);
    const [driverLocation, setDriverLocation] = useState(null);
    const [mapOpen, setMapOpen] = useState(false);
    const [sheetExpanded, setSheetExpanded] = useState(false);

    const PARCEL_STEPS = [
        ["REQUESTED", "Requested"],
        ["DRIVER_ASSIGNED", "Driver Assigned"],
        ["DRIVER_EN_ROUTE", "Driver En Route"],
        ["ARRIVED_AT_PICKUP", "Arrived at Pickup"],
        ["PICKED_UP", "Parcel Picked Up"],
        ["OUT_FOR_DELIVERY", "Out for Delivery"],
        ["DELIVERED", "Delivered"],
    ];
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [notification, setNotification] = useState("");

    const refresh = useCallback(async () => {
        if (!token || !id) return;

        try {
            const result = await apiRequest(`/parcels/${id}`, { token });
            setOrder(result.order);

            if (result.order.status === "REQUESTED") {
                const offerResult = await apiRequest(
                    `/parcels/${id}/offers`,
                    { token }
                );
                setOffers(offerResult.offers || []);
            } else {
                setOffers([]);
            }

            setError("");
        } catch (e) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    }, [id, token]);

    useEffect(() => {
        refresh();

        const timer = setInterval(refresh, 5000);
        return () => clearInterval(timer);
    }, [refresh]);

    useEffect(() => {
        if (!token || !id) return;

        let cancelled = false;

        async function loadTracking() {
            try {
                const data = await apiRequest(
                    `/parcels/${id}/tracking`,
                    { token }
                );

                if (!cancelled) {
                    setDriverLocation(data.location || null);
                }
            } catch {
                if (!cancelled) setDriverLocation(null);
            }
        }

        loadTracking();

        const timer = setInterval(loadTracking, 5000);

        return () => {
            cancelled = true;
            clearInterval(timer);
        };
    }, [id, token]);

    useEffect(() => {
        if (!token || !id) return;

        let socket;
        let active = true;

        async function connect() {
            socket = await getRealtimeSocket(token);
            if (!active || !socket) return;

            const handleStatus = (data) => {
                if (String(data?.parcelId) !== String(id)) return;

                setNotification(
                    data.message || "Parcel delivery status updated"
                );

                if (typeof Audio !== "undefined") {
                    const audio = new Audio("/sounds/notification.mp3");
                    audio.volume = 0.5;
                    audio.play().catch(() => { });
                }

                refresh();
            };

            socket.on("parcel:status:updated", handleStatus);
            socket.on("parcel:offer:new", handleStatus);
        }

        connect();

        return () => {
            active = false;
            socket?.off("parcel:status:updated");
            socket?.off("parcel:offer:new");
        };
    }, [id, token, refresh]);

    async function acceptOffer(offerId) {
        setBusy(true);
        setError("");

        try {
            await apiRequest(
                `/parcels/${id}/offers/${offerId}/accept`,
                { method: "POST", token }
            );
            await refresh();
        } catch (e) {
            setError(e.message);
        } finally {
            setBusy(false);
        }
    }

    async function generateOtp(stage) {
        setBusy(true);
        setError("");

        try {
            const result = await apiRequest(`/parcels/${id}/otp`, {
                method: "POST",
                token,
                body: JSON.stringify({ stage }),
            });

            setOtp({ stage, code: result.otp });
        } catch (e) {
            setError(e.message);
        } finally {
            setBusy(false);
        }
    }

    async function cancelOrder() {
        if (!window.confirm("Cancel this parcel request?")) return;

        setBusy(true);
        try {
            await apiRequest(`/parcels/${id}/cancel`, {
                method: "PATCH",
                token,
            });
            await refresh();
        } catch (e) {
            setError(e.message);
        } finally {
            setBusy(false);
        }
    }

    return (
        <main className="min-h-dvh bg-[#F4F5F7] p-4 text-[#111111]">
            <div className="mx-auto max-w-xl space-y-4">
                <Link href="/passenger/parcels" className="text-sm font-bold">
                    ← My Parcels
                </Link>

                <h1 className="text-2xl font-extrabold">
                    📦 Parcel Tracking
                </h1>

                {notification && (
                    <div
                        role="status"
                        className="fixed left-4 right-4 top-4 z-[200] mx-auto max-w-xl rounded-2xl bg-[#111111] p-4 text-sm font-bold text-white shadow-xl"
                    >
                        <div className="flex items-center justify-between gap-3">
                            <span>🔔 {notification}</span>
                            <button
                                type="button"
                                onClick={() => setNotification("")}
                                aria-label="Dismiss notification"
                            >
                                ✕
                            </button>
                        </div>
                    </div>
                )}

                {loading && <p>Loading delivery...</p>}

                {error && (
                    <p role="alert" className="rounded-xl bg-red-50 p-4 text-red-600">
                        {error}
                    </p>
                )}

                {order && (
                    <>
                        <section className="rounded-2xl bg-white p-5 shadow-sm">
                            <p className="text-xs font-bold text-gray-500">
                                DELIVERY STATUS
                            </p>
                            <h2 className="mt-2 text-xl font-extrabold">
                                {order.status.replaceAll("_", " ")}
                            </h2>
                            <p className="mt-3 text-sm">
                                {order.serviceType === "SHOP_PICKUP"
                                    ? "Shop Pickup"
                                    : "Send Parcel"}
                            </p>
                            <p className="mt-2 font-bold">
                                PKR {order.finalPrice ?? order.requestedPrice}
                            </p>
                            <p className="mt-2 text-sm text-gray-500">
                                {order.parcel?.category} · {order.parcel?.weightKg} kg
                            </p>
                        </section>

                        {driverLocation && (
                            <>
                                <button
                                    type="button"
                                    onClick={() => setMapOpen(true)}
                                    className="w-full rounded-2xl bg-[#C1F11D] p-4 font-extrabold"
                                >
                                    📍 Open Full-Screen Live Tracking
                                </button>

                                {mapOpen && (
                                    <div className="fixed inset-0 z-[100] bg-white">
                                        <ParcelTrackingMap
                                            latitude={driverLocation.latitude}
                                            longitude={driverLocation.longitude}
                                            pickup={order.pickup}
                                            destination={order.destination}
                                        />

                                        <div className="absolute left-4 right-4 top-[calc(16px+env(safe-area-inset-top))] z-10 flex items-center justify-between gap-3">
                                            <div className="rounded-2xl bg-white px-4 py-3 font-extrabold shadow-lg">
                                                📦 Live Parcel Tracking
                                            </div>

                                            <button
                                                type="button"
                                                onClick={() => setMapOpen(false)}
                                                className="rounded-2xl bg-white px-4 py-3 font-bold shadow-lg"
                                            >
                                                ✕ Close
                                            </button>
                                        </div>

                                        <div className="absolute bottom-0 left-0 right-0 z-10 rounded-t-[28px] bg-white p-5 pb-[calc(20px+env(safe-area-inset-bottom))] shadow-[0_-8px_30px_rgba(0,0,0,0.15)]">
                                            <div className="mx-auto max-w-xl space-y-3">
                                                <button
                                                    type="button"
                                                    onClick={() => setSheetExpanded((value) => !value)}
                                                    className="flex w-full flex-col items-center gap-2 py-2"
                                                >
                                                    <span className="h-1.5 w-12 rounded-full bg-gray-300" />
                                                    <span className="text-xs font-bold text-gray-500">
                                                        {sheetExpanded ? "Show Less ▲" : "More Details ▼"}
                                                    </span>
                                                </button>

                                                <div className="flex items-center justify-between">
                                                    <h2 className="text-lg font-extrabold">
                                                        {order.status === "DELIVERED"
                                                            ? "Parcel Delivered Successfully"
                                                            : order.status === "CANCELLED"
                                                                ? "Delivery Cancelled"
                                                                : order.status.replaceAll("_", " ")}
                                                    </h2>
                                                    <span className="rounded-full bg-[#EFFFBE] px-3 py-1 text-xs font-bold">
                                                        ● Live GPS
                                                    </span>
                                                </div>

                                                <p className="text-sm text-gray-500">
                                                    {order.serviceType === "SHOP_PICKUP"
                                                        ? "Shop Pickup"
                                                        : "Parcel Delivery"}
                                                </p>

                                                <div className="rounded-xl bg-[#F4F5F7] p-3">
                                                    <p className="text-xs font-bold text-gray-500">
                                                        DELIVERY DESTINATION
                                                    </p>
                                                    <p className="mt-1 text-sm font-semibold">
                                                        {order.destination?.address || "Delivery location"}
                                                    </p>
                                                </div>

                                                <div className="flex items-center justify-between">
                                                    <span className="text-sm text-gray-500">Agreed fare</span>
                                                    <strong>PKR {order.finalPrice ?? order.requestedPrice}</strong>
                                                </div>

                                                {sheetExpanded && (
                                                    <div className="space-y-3 border-t pt-4">
                                                        <h3 className="font-extrabold">Delivery Progress</h3>

                                                        <div className="space-y-3">
                                                            {PARCEL_STEPS.map(([status, label], index) => {
                                                                const current = PARCEL_STEPS.findIndex(
                                                                    ([value]) => value === order.status
                                                                );

                                                                const completed = current >= index;

                                                                return (
                                                                    <div key={status} className="flex items-center gap-3">
                                                                        <span
                                                                            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${completed
                                                                                ? "bg-[#C1F11D] text-black"
                                                                                : "bg-gray-100 text-gray-400"
                                                                                }`}
                                                                        >
                                                                            {completed ? "✓" : index + 1}
                                                                        </span>

                                                                        <span className={`text-sm ${completed ? "font-bold" : "text-gray-400"
                                                                            }`}>
                                                                            {label}
                                                                        </span>
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>
                                                        <div>
                                                            <p className="text-xs font-bold text-gray-500">PICKUP</p>
                                                            <p className="text-sm">{order.pickup?.address || "Pickup location"}</p>
                                                        </div>

                                                        <div>
                                                            <p className="text-xs font-bold text-gray-500">RECEIVER</p>
                                                            <p className="text-sm font-semibold">
                                                                {order.receiver?.name || "Receiver"}
                                                            </p>
                                                        </div>

                                                        <div>
                                                            <p className="text-xs font-bold text-gray-500">PARCEL</p>
                                                            <p className="text-sm">
                                                                {order.parcel?.category} · {order.parcel?.weightKg} kg
                                                            </p>
                                                        </div>
                                                    </div>
                                                )}

                                                <p className="text-center text-xs text-gray-400">
                                                    Driver location refreshes approximately every 5 seconds.
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </>
                        )}

                        {order.status === "REQUESTED" && (
                            <section className="rounded-2xl bg-white p-5">
                                <h3 className="mb-3 font-extrabold">
                                    Driver Offers
                                </h3>

                                {offers.length === 0 && (
                                    <p className="text-sm text-gray-500">
                                        Waiting for driver offers...
                                    </p>
                                )}

                                {offers.map((offer) => (
                                    <div
                                        key={offer._id}
                                        className="flex items-center justify-between border-b py-3"
                                    >
                                        <strong>PKR {offer.price}</strong>
                                        <button
                                            type="button"
                                            disabled={busy}
                                            onClick={() => acceptOffer(offer._id)}
                                            className="rounded-xl bg-[#C1F11D] px-4 py-2 text-sm font-bold disabled:opacity-50"
                                        >
                                            Accept
                                        </button>
                                    </div>
                                ))}

                                <button
                                    type="button"
                                    disabled={busy}
                                    onClick={cancelOrder}
                                    className="mt-4 text-sm font-bold text-red-600"
                                >
                                    Cancel Request
                                </button>
                            </section>
                        )}

                        {["DRIVER_ASSIGNED", "DRIVER_EN_ROUTE", "ARRIVED_AT_PICKUP"].includes(order.status) && (
                            <button
                                type="button"
                                disabled={busy}
                                onClick={() => generateOtp("PICKUP")}
                                className="w-full rounded-2xl bg-[#C1F11D] p-4 font-bold"
                            >
                                Generate Pickup Code
                            </button>
                        )}

                        {["PICKED_UP", "OUT_FOR_DELIVERY"].includes(order.status) && (
                            <button
                                type="button"
                                disabled={busy}
                                onClick={() => generateOtp("DELIVERY")}
                                className="w-full rounded-2xl bg-[#C1F11D] p-4 font-bold"
                            >
                                Generate Delivery Code
                            </button>
                        )}

                        {otp && (
                            <div className="rounded-2xl border-2 border-[#C1F11D] bg-white p-5 text-center">
                                <p className="text-xs font-bold">
                                    {otp.stage} VERIFICATION CODE
                                </p>
                                <p className="mt-3 text-4xl font-extrabold tracking-widest">
                                    {otp.code}
                                </p>
                                <p className="mt-2 text-xs text-gray-500">
                                    Share only when parcel handover is happening.
                                </p>
                            </div>
                        )}
                    </>
                )}
            </div>
        </main>
    );
}