"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import AuthGuard from "@/components/AuthGuard";
import { useAuth } from "@/context/AuthContext";
import { apiRequest } from "@/lib/api";

const NEXT = {
    DRIVER_ASSIGNED: ["DRIVER_EN_ROUTE", "Head to Pickup"],
    DRIVER_EN_ROUTE: ["ARRIVED_AT_PICKUP", "I've Arrived"],
    ARRIVED_AT_PICKUP: ["PICKED_UP", "Confirm Parcel Pickup"],
    PICKED_UP: ["OUT_FOR_DELIVERY", "Start Delivery"],
    OUT_FOR_DELIVERY: ["DELIVERED", "Confirm Delivery"],
};

export default function DriverParcelDetailsPage() {
    return (
        <AuthGuard role="DRIVER">
            <DriverParcelDetails />
        </AuthGuard>
    );
}

function DriverParcelDetails() {
    const id = useSearchParams().get("parcelId");
    const { token } = useAuth();

    const [order, setOrder] = useState(null);
    const [otp, setOtp] = useState("");
    const [busy, setBusy] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    const refresh = useCallback(async () => {
        if (!token || !id) return;

        try {
            const data = await apiRequest(`/parcels/driver/${id}`, { token });
            setOrder(data.order);
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

    async function updateStatus() {
        if (!order || !NEXT[order.status] || busy) return;

        const needsOtp = ["ARRIVED_AT_PICKUP", "OUT_FOR_DELIVERY"]
            .includes(order.status);

        if (needsOtp && !/^\d{6}$/.test(otp)) {
            setError("Enter the 6-digit confirmation code.");
            return;
        }

        setBusy(true);
        setError("");

        try {
            await apiRequest(`/parcels/${id}/status`, {
                method: "PATCH",
                token,
                body: JSON.stringify(needsOtp ? { otp } : {}),
            });

            setOtp("");
            await refresh();
        } catch (e) {
            setError(e.message);
        } finally {
            setBusy(false);
        }
    }

    const action = NEXT[order?.status];
    const needsOtp = ["ARRIVED_AT_PICKUP", "OUT_FOR_DELIVERY"]
        .includes(order?.status);

    return (
        <main className="min-h-dvh bg-[#F4F5F7] p-4 text-[#111111]">
            <div className="mx-auto max-w-xl space-y-4">
                <Link href="/driver/parcels" className="text-sm font-bold">
                    ← Parcel Deliveries
                </Link>

                <h1 className="text-2xl font-extrabold">
                    📦 Manage Delivery
                </h1>

                {loading && <p>Loading delivery...</p>}

                {error && (
                    <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-600">
                        {error}
                    </p>
                )}

                {order && (
                    <>
                        <section className="space-y-3 rounded-2xl bg-white p-5 shadow-sm">
                            <p className="text-xs font-bold text-gray-500">
                                DELIVERY STATUS
                            </p>
                            <h2 className="text-xl font-extrabold">
                                {order.status.replaceAll("_", " ")}
                            </h2>
                            <p className="font-bold">
                                PKR {order.finalPrice ?? order.requestedPrice}
                            </p>
                            <p className="text-sm text-gray-500">
                                {order.parcel?.category} · {order.parcel?.weightKg} kg
                            </p>
                            <p className="text-sm">
                                {order.parcel?.description || "No description"}
                            </p>
                        </section>

                        <section className="space-y-3 rounded-2xl bg-white p-5 shadow-sm">
                            <h3 className="font-extrabold">Pickup</h3>
                            <p>{order.pickup?.address || "Pickup location"}</p>
                            <p className="text-sm font-semibold">
                                {order.sender?.name} · {order.sender?.phone}
                            </p>
                            <h3 className="font-extrabold">Delivery</h3>
                            <p>{order.destination?.address || "Delivery location"}</p>
                            <p className="text-sm font-semibold">
                                {order.receiver?.name} · {order.receiver?.phone}
                            </p>
                        </section>

                        {action && (
                            <section className="space-y-3 rounded-2xl bg-white p-5">
                                {needsOtp && (
                                    <input
                                        type="text"
                                        inputMode="numeric"
                                        maxLength={6}
                                        value={otp}
                                        onChange={(e) =>
                                            setOtp(e.target.value.replace(/\D/g, ""))
                                        }
                                        placeholder="6-digit confirmation code"
                                        className="w-full rounded-xl bg-[#F4F5F7] p-4 text-center text-lg font-bold tracking-widest"
                                    />
                                )}

                                <button
                                    type="button"
                                    disabled={busy}
                                    onClick={updateStatus}
                                    className="w-full rounded-2xl bg-[#C1F11D] p-4 font-extrabold disabled:opacity-50"
                                >
                                    {busy ? "Updating..." : action[1]}
                                </button>
                            </section>
                        )}

                        {order.status === "DELIVERED" && (
                            <p className="rounded-2xl bg-[#EFFFBE] p-5 text-center font-extrabold">
                                ✓ Parcel Delivered Successfully
                            </p>
                        )}
                    </>
                )}
            </div>
        </main>
    );
}