"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import AuthGuard from "@/components/AuthGuard";
import { useAuth } from "@/context/AuthContext";
import { apiRequest } from "@/lib/api";

export default function PassengerParcelsPage() {
    return (
        <AuthGuard role="PASSENGER">
            <ParcelDashboard />
        </AuthGuard>
    );
}

function ParcelDashboard() {
    const { token } = useAuth();
    const [orders, setOrders] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    useEffect(() => {
        if (!token) return;

        let cancelled = false;

        apiRequest("/parcels/my", { token })
            .then((data) => {
                if (!cancelled) setOrders(data.orders || []);
            })
            .catch((err) => {
                if (!cancelled) setError(err.message);
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });

        return () => { cancelled = true; };
    }, [token]);

    return (
        <main className="min-h-dvh bg-[#F4F5F7] p-5 text-[#111111]">
            <div className="mx-auto max-w-xl">
                <Link href="/passenger" className="text-sm font-bold">
                    ← Back
                </Link>

                <h1 className="mt-6 text-3xl font-extrabold">
                    📦 Parcel Delivery
                </h1>

                <p className="mt-2 text-sm text-gray-500">
                    Send parcels or receive orders from shops.
                </p>

                <Link
                    href="/passenger/parcels/new"
                    className="mt-6 block rounded-2xl bg-[#C1F11D] p-4 text-center font-extrabold"
                >
                    + Book Parcel Delivery
                </Link>

                <h2 className="mb-3 mt-8 text-lg font-bold">
                    My Deliveries
                </h2>

                {loading && <p>Loading parcels...</p>}
                {error && <p className="text-red-600">{error}</p>}

                {!loading && !error && orders.length === 0 && (
                    <p className="rounded-2xl bg-white p-5 text-sm text-gray-500">
                        No parcel bookings yet.
                    </p>
                )}

                <div className="space-y-3">
                    {orders.map((order) => (
                        <article
                            key={order._id}
                            className="rounded-2xl bg-white p-4 shadow-sm"
                        >
                            <div className="flex justify-between gap-3">
                                <strong>
                                    {order.serviceType === "SHOP_PICKUP"
                                        ? "Shop Pickup"
                                        : "Send Parcel"}
                                </strong>
                                <span className="text-xs font-bold">
                                    {order.status.replaceAll("_", " ")}
                                </span>
                            </div>

                            <p className="mt-2 text-sm text-gray-500">
                                {order.parcel?.category} · {order.parcel?.weightKg} kg
                            </p>

                            <p className="mt-2 font-bold">
                                PKR {order.finalPrice ?? order.requestedPrice}
                            </p>

                            <Link
                                href={`/passenger/parcels/details?parcelId=${order._id}`}
                                className="mt-3 inline-block text-sm font-bold underline"
                            >
                                View Details →
                            </Link>
                        </article>
                    ))}
                </div>
            </div>
        </main>
    );
}