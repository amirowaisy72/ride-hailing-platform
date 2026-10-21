"use client";

import { useCallback, useEffect, useState } from "react";
import AdminShell from "@/components/AdminShell";
import { authenticatedAdminRequest } from "@/lib/adminSession";

const STATUSES = [
    "ALL", "REQUESTED", "DRIVER_ASSIGNED", "DRIVER_EN_ROUTE",
    "ARRIVED_AT_PICKUP", "PICKED_UP", "OUT_FOR_DELIVERY",
    "DELIVERED", "CANCELLED", "FAILED",
];

export default function AdminParcelsPage() {
    const [orders, setOrders] = useState([]);
    const [status, setStatus] = useState("ALL");
    const [page, setPage] = useState(1);
    const [total, setTotal] = useState(0);
    const [totalPages, setTotalPages] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    const load = useCallback(async () => {
        setLoading(true);
        setError("");

        try {
            const params = new URLSearchParams({ page: String(page) });
            if (status !== "ALL") params.set("status", status);

            const data = await authenticatedAdminRequest(
                `/admin/parcels?${params}`
            );

            setOrders(data.orders || []);
            setTotal(data.total || 0);
            setTotalPages(data.totalPages || 0);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, [page, status]);

    useEffect(() => {
        load();
    }, [load]);

    return (
        <AdminShell title="Parcel Management">
            <div className="space-y-5">
                <div className="rounded-2xl bg-white p-6 shadow-sm">
                    <h2 className="text-2xl font-extrabold">
                        Parcel Deliveries
                    </h2>
                    <p className="mt-2 text-sm text-slate-500">
                        Total matching orders: {total}
                    </p>

                    <div className="mt-4 flex flex-wrap gap-3">
                        <select
                            value={status}
                            onChange={(e) => {
                                setStatus(e.target.value);
                                setPage(1);
                            }}
                            className="rounded-xl border p-3 text-sm"
                        >
                            {STATUSES.map((value) => (
                                <option key={value} value={value}>
                                    {value.replaceAll("_", " ")}
                                </option>
                            ))}
                        </select>

                        <button
                            type="button"
                            onClick={load}
                            disabled={loading}
                            className="rounded-xl bg-[#087F5B] px-5 py-3 text-sm font-bold text-white disabled:opacity-50"
                        >
                            Refresh
                        </button>
                    </div>
                </div>

                {error && (
                    <p role="alert" className="rounded-xl bg-red-50 p-4 text-red-600">
                        {error}
                    </p>
                )}

                <div className="space-y-3">
                    {orders.map((order) => (
                        <article
                            key={order._id}
                            className="rounded-2xl bg-white p-5 shadow-sm"
                        >
                            <div className="flex flex-wrap justify-between gap-2">
                                <strong>
                                    {order.serviceType.replaceAll("_", " ")}
                                </strong>
                                <span className="text-sm font-bold text-[#087F5B]">
                                    {order.status.replaceAll("_", " ")}
                                </span>
                            </div>

                            <p className="mt-3 text-sm">
                                <strong>Pickup:</strong> {order.pickup?.address || "—"}
                            </p>
                            <p className="mt-2 text-sm">
                                <strong>Destination:</strong> {order.destination?.address || "—"}
                            </p>
                            <p className="mt-2 text-sm">
                                <strong>Parcel:</strong> {order.parcel?.category} · {order.parcel?.weightKg} kg
                            </p>
                            <p className="mt-2 text-sm">
                                <strong>Driver:</strong> {order.driverId?._id || "Not assigned"}
                            </p>
                            <p className="mt-2 font-extrabold">
                                PKR {Number(order.finalPrice ?? order.requestedPrice).toLocaleString("en-PK")}
                            </p>
                            <p className="mt-2 text-xs text-slate-500">
                                {new Date(order.createdAt).toLocaleString("en-PK")}
                            </p>
                        </article>
                    ))}

                    {!loading && !error && orders.length === 0 && (
                        <p className="rounded-2xl bg-white p-6 text-slate-500">
                            No parcel orders found.
                        </p>
                    )}
                </div>

                <div className="flex items-center justify-between">
                    <button
                        disabled={loading || page <= 1}
                        onClick={() => setPage(page - 1)}
                        className="rounded-xl border px-5 py-3 disabled:opacity-40"
                    >
                        Previous
                    </button>

                    <span className="text-sm font-bold">
                        Page {page} of {Math.max(1, totalPages)}
                    </span>

                    <button
                        disabled={loading || page >= totalPages}
                        onClick={() => setPage(page + 1)}
                        className="rounded-xl border px-5 py-3 disabled:opacity-40"
                    >
                        Next
                    </button>
                </div>
            </div>
        </AdminShell>
    );
}