"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import AuthGuard from "@/components/AuthGuard";
import { useAuth } from "@/context/AuthContext";
import { apiRequest } from "@/lib/api";
import { Geolocation } from "@capacitor/geolocation";
import { updateDriverLocation } from "@/lib/vehicleService";
import { getRealtimeSocket } from "@/lib/socket";

export default function DriverParcelsPage() {
    return (
        <AuthGuard role="DRIVER">
            <DriverParcels />
        </AuthGuard>
    );
}

function DriverParcels() {
    const { token } = useAuth();
    const [available, setAvailable] = useState([]);

    useEffect(() => {
        if (!token) return;

        let stopped = false;
        let updating = false;

        async function refreshGPS() {
            if (stopped || updating || document.hidden) return;

            updating = true;
            try {
                const position = await Geolocation.getCurrentPosition({
                    enableHighAccuracy: true,
                    timeout: 15000,
                    maximumAge: 5000,
                });

                const { latitude, longitude, accuracy } = position.coords;

                if (
                    stopped ||
                    !Number.isFinite(latitude) ||
                    !Number.isFinite(longitude) ||
                    !Number.isFinite(accuracy) ||
                    accuracy > 100
                ) return;

                await updateDriverLocation(latitude, longitude, token);
            } catch (error) {
                console.warn("Parcel GPS refresh:", error.message);
            } finally {
                updating = false;
            }
        }

        refreshGPS();
        const timer = setInterval(refreshGPS, 30000);

        return () => {
            stopped = true;
            clearInterval(timer);
        };
    }, [token]);
    const [assigned, setAssigned] = useState([]);
    const [offerPrices, setOfferPrices] = useState({});
    const [sentOffers, setSentOffers] = useState({});
    const [busy, setBusy] = useState("");
    const [error, setError] = useState("");
    const [notification, setNotification] = useState("");

    const refresh = useCallback(async () => {
        if (!token) return;

        try {
            const [a, b] = await Promise.all([
                apiRequest("/parcels/available", { token }),
                apiRequest("/parcels/driver/my", { token }),
            ]);

            setAvailable(a.orders || []);
            setAssigned(b.orders || []);
        } catch (e) {
            setError(e.message);
        }
    }, [token]);

    useEffect(() => {
        refresh();
        const timer = setInterval(refresh, 5000);
        return () => clearInterval(timer);
    }, [refresh]);

    useEffect(() => {
        if (!token) return;

        let socket;
        let active = true;

        const handleAssignment = (data) => {
            setNotification(data.message || "Parcel assigned to you");
            refresh();

            const audio = new Audio("/sounds/notification.mp3");
            audio.volume = 0.6;
            audio.play().catch(() => { });
        };

        async function connect() {
            socket = await getRealtimeSocket(token);
            if (!active || !socket) return;

            socket.on("parcel:assigned", handleAssignment);
        }

        connect();

        return () => {
            active = false;
            socket?.off("parcel:assigned", handleAssignment);
        };
    }, [token, refresh]);

    async function submitOffer(id, requestedPrice) {
        const price = Number(offerPrices[id] || requestedPrice);

        if (!Number.isSafeInteger(price) || price <= 0) {
            setError("Enter a valid fare.");
            return;
        }

        setBusy(id);
        setError("");

        try {
            await apiRequest(`/parcels/${id}/offers`, {
                method: "POST",
                token,
                body: JSON.stringify({ price }),
            });

            setError("");
            setNotification("✅ Offer sent! Waiting for passenger response.");
            setSentOffers((prev) => ({ ...prev, [id]: true }));
            await refresh();
        } catch (e) {
            setError(e.message);
        } finally {
            setBusy("");
        }
    }

    return (
        <main className="min-h-dvh bg-[#F4F5F7] p-4 text-[#111111]">
            <div className="mx-auto max-w-xl space-y-5">
                <Link href="/driver" className="text-sm font-bold">
                    ← Driver Home
                </Link>

                <h1 className="text-2xl font-extrabold">
                    📦 Parcel Deliveries
                </h1>

                {notification && (
                    <div
                        role="status"
                        className="rounded-2xl bg-[#C1F11D] p-4 font-bold"
                    >
                        <div className="flex items-center justify-between gap-3">
                            <span>🔔 {notification}</span>
                            <button
                                type="button"
                                onClick={() => setNotification("")}
                            >
                                ✕
                            </button>
                        </div>
                    </div>
                )}

                {error && (
                    <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-600">
                        {error}
                    </p>
                )}

                <section className="space-y-3">
                    <h2 className="font-extrabold">My Assigned Deliveries</h2>

                    {assigned.map((order) => (
                        <Link
                            key={order._id}
                            href={`/driver/parcels/details?parcelId=${order._id}`}
                            className="block rounded-2xl bg-white p-4 shadow-sm"
                        >
                            <p className="font-bold">
                                {order.serviceType.replaceAll("_", " ")}
                            </p>
                            <p className="mt-1 text-xs text-gray-500">
                                {order.status.replaceAll("_", " ")}
                            </p>
                            <p className="mt-2 font-bold">
                                PKR {order.finalPrice}
                            </p>
                            <p className="mt-2 text-sm underline">
                                Manage Delivery →
                            </p>
                        </Link>
                    ))}

                    {assigned.length === 0 && (
                        <p className="text-sm text-gray-500">
                            No assigned deliveries.
                        </p>
                    )}
                </section>

                <section className="space-y-3">
                    <h2 className="font-extrabold">Available Parcel Requests</h2>

                    {available.map((order) => (
                        <article key={order._id} className="rounded-2xl bg-white p-4 shadow-sm">
                            <p className="font-bold">
                                {order.serviceType.replaceAll("_", " ")}
                            </p>

                            <p className="mt-1 text-sm text-gray-500">
                                {order.parcel?.category} · {order.parcel?.weightKg} kg
                            </p>

                            <p className="mt-2 text-sm font-semibold">
                                Requested: PKR {order.requestedPrice}
                            </p>

                            <div className="mt-3 flex gap-2">
                                <input
                                    type="number"
                                    min="1"
                                    step="1"
                                    placeholder="Your fare"
                                    value={offerPrices[order._id] ?? ""}
                                    onChange={(e) => setOfferPrices({
                                        ...offerPrices,
                                        [order._id]: e.target.value,
                                    })}
                                    className="min-w-0 flex-1 rounded-xl bg-[#F4F5F7] p-3"
                                />

                                <button
                                    disabled={busy === order._id}
                                    onClick={() => submitOffer(order._id, order.requestedPrice)}
                                    className="rounded-xl bg-[#C1F11D] px-4 font-bold disabled:opacity-50"
                                >
                                    {busy === order._id ? "Sending..." : sentOffers[order._id] ? "Update Offer" : "Send Offer"}
                                </button>
                            </div>

                            {sentOffers[order._id] && (
                                <p role="status" className="mt-3 rounded-xl bg-lime-100 p-3 text-sm font-bold text-green-900">
                                    ✅ Offer sent — Waiting for passenger response.
                                </p>
                            )}
                        </article>
                    ))}

                    {available.length === 0 && (
                        <p className="text-sm text-gray-500">
                            No available parcel requests.
                        </p>
                    )}
                </section>
            </div>
        </main >
    );
}