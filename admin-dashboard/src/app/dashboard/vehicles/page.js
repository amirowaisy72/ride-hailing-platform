
"use client";

import { useCallback, useEffect, useState } from "react";
import {
    Bike, CarFront, CheckCircle2, Clock3, RefreshCw,
    Search, ShieldCheck, XCircle, AlertCircle,
} from "lucide-react";

import AdminShell from "@/components/AdminShell";
import { useAdminDialog } from "@/components/AdminDialog";
import { authenticatedAdminRequest } from "@/lib/adminSession";

const vehicleNames = {
    BIKE: "Motorcycle",
    RICKSHAW: "Rickshaw",
    CAR_AC: "Car (AC)",
    CAR_NON_AC: "Car (Non-AC)",
};

const statusStyles = {
    APPROVED: "bg-emerald-50 text-emerald-700",
    PENDING: "bg-amber-50 text-amber-700",
    REJECTED: "bg-red-50 text-red-700",
};

export default function VehiclesPage() {
    const { confirmDialog } = useAdminDialog();
    const [vehicles, setVehicles] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [message, setMessage] = useState("");
    const [filter, setFilter] = useState("ALL");
    const [search, setSearch] = useState("");
    const [busyId, setBusyId] = useState(null);

    const loadVehicles = useCallback(async () => {
        setLoading(true);
        setError("");

        try {
            const result = await authenticatedAdminRequest(
                "/admin/vehicles"
            );

            setVehicles(Array.isArray(result.vehicles) ? result.vehicles : []);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadVehicles();
    }, [loadVehicles]);

    const visibleVehicles = vehicles.filter((vehicle) => {
        const matchesStatus =
            filter === "ALL" || vehicle.verificationStatus === filter;

        const text = [
            vehicle.registrationNumber,
            vehicle.make,
            vehicle.model,
            vehicle.vehicleType,
        ].filter(Boolean).join(" ").toLowerCase();

        return matchesStatus && text.includes(search.trim().toLowerCase());
    });

    const countStatus = (status) =>
        vehicles.filter((v) => v.verificationStatus === status).length;

    async function updateStatus(vehicleId, status) {
        if (busyId) return;

        if (!(await confirmDialog(
            `Are you sure you want to ${status.toLowerCase()} this vehicle?`,
            { danger: status === "REJECTED" }
        ))) return;

        setBusyId(vehicleId);
        setMessage("");
        setError("");

        try {
            await authenticatedAdminRequest(
                `/admin/vehicles/${encodeURIComponent(vehicleId)}/review`,
                {
                    method: "PATCH",
                    body: JSON.stringify({ status }),
                }
            );

            setMessage(`Vehicle ${status.toLowerCase()} successfully.`);
            await loadVehicles();
        } catch (err) {
            setError(err.message);
        } finally {
            setBusyId(null);
        }
    }

    return (
        <AdminShell title="Vehicle Management">
            <div className="space-y-6">
                <section className="flex flex-wrap items-start justify-between gap-4 rounded-[24px] bg-white p-6 shadow-sm">
                    <div>
                        <p className="text-xs font-bold uppercase tracking-wider text-[#087F5B]">
                            Fleet Verification
                        </p>
                        <h2 className="mt-2 text-2xl font-extrabold">
                            Vehicle Management
                        </h2>
                        <p className="mt-2 text-sm text-slate-500">
                            Review registered vehicles and their verification status.
                        </p>
                    </div>
                    <button
                        onClick={loadVehicles}
                        disabled={loading}
                        className="flex items-center gap-2 rounded-xl border px-4 py-3 text-sm font-bold disabled:opacity-50"
                    >
                        <RefreshCw size={17} />
                        Refresh
                    </button>
                </section>

                <div className="grid gap-4 sm:grid-cols-3">
                    {[
                        ["Registered Vehicles", vehicles.length, CarFront],
                        ["Approved Vehicles", countStatus("APPROVED"), CheckCircle2],
                        ["Pending Approval", countStatus("PENDING"), Clock3],
                    ].map(([label, value, Icon]) => (
                        <div key={label} className="rounded-2xl bg-white p-5 shadow-sm">
                            <Icon size={24} className="text-[#087F5B]" />
                            <p className="mt-4 text-sm text-slate-500">{label}</p>
                            <p className="mt-1 text-3xl font-extrabold">
                                {loading ? "—" : value}
                            </p>
                        </div>
                    ))}
                </div>

                <section className="overflow-hidden rounded-[24px] bg-white shadow-sm">
                    <div className="space-y-4 border-b p-5">
                        <div className="flex items-center gap-3 rounded-xl border px-4">
                            <Search size={19} className="text-slate-400" />
                            <input
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                placeholder="Search registration, make, model"
                                className="h-12 min-w-0 flex-1 bg-transparent text-sm outline-none"
                            />
                        </div>

                        <div className="flex flex-wrap gap-2">
                            {["ALL", "PENDING", "APPROVED", "REJECTED"].map((status) => (
                                <button
                                    key={status}
                                    onClick={() => setFilter(status)}
                                    className={`rounded-xl px-4 py-2 text-xs font-bold ${filter === status
                                        ? "bg-[#087F5B] text-white"
                                        : "bg-slate-100 text-slate-600"
                                        }`}
                                >
                                    {status === "ALL" ? "All Vehicles" : status}
                                </button>
                            ))}
                        </div>
                    </div>

                    {message && (
                        <p role="status" className="m-5 rounded-xl bg-emerald-50 p-4 text-sm text-[#087F5B]">
                            {message}
                        </p>
                    )}

                    {error && (
                        <p role="alert" className="m-5 rounded-xl bg-red-50 p-4 text-sm text-red-600">
                            <AlertCircle size={16} className="mr-2 inline" />
                            {error}
                        </p>
                    )}

                    {loading ? (
                        <p className="p-10 text-center text-sm text-slate-500">
                            Loading vehicles...
                        </p>
                    ) : visibleVehicles.length === 0 ? (
                        <p className="p-10 text-center text-sm text-slate-500">
                            No vehicles found.
                        </p>
                    ) : (
                        <div className="divide-y divide-slate-100">
                            {visibleVehicles.map((vehicle) => (
                                <div
                                    key={vehicle._id}
                                    className="flex flex-wrap items-center gap-4 p-5"
                                >
                                    <div className="rounded-xl bg-emerald-50 p-3 text-[#087F5B]">
                                        {vehicle.vehicleType === "BIKE"
                                            ? <Bike size={24} />
                                            : <CarFront size={24} />}
                                    </div>

                                    <div className="min-w-0 flex-1">
                                        <h3 className="font-bold">
                                            {vehicle.make || "Vehicle"} {vehicle.model || ""}
                                        </h3>
                                        <p className="mt-1 text-sm text-slate-500">
                                            {vehicle.registrationNumber || "Registration unavailable"}
                                        </p>
                                        <p className="mt-1 text-xs text-slate-500">
                                            {vehicleNames[vehicle.vehicleType] || vehicle.vehicleType}
                                        </p>

                                        <p className="mt-2 text-xs font-semibold text-slate-700">
                                            Driver: {
                                                [
                                                    vehicle.driverId?.userId?.firstName,
                                                    vehicle.driverId?.userId?.lastName,
                                                ].filter(Boolean).join(" ") || "Unknown"
                                            }
                                        </p>

                                        <p className="text-xs text-slate-500">
                                            {vehicle.driverId?.userId?.email || "Email unavailable"}
                                        </p>
                                        <span className={`mt-2 inline-block rounded-lg px-3 py-1 text-xs font-bold ${statusStyles[vehicle.verificationStatus] ||
                                            "bg-slate-100 text-slate-600"
                                            }`}>
                                            {vehicle.verificationStatus}
                                        </span>
                                    </div>

                                    {vehicle.verificationStatus === "PENDING" && (
                                        <div className="flex gap-2">
                                            <button
                                                disabled={Boolean(busyId)}
                                                onClick={() => updateStatus(vehicle._id, "APPROVED")}
                                                className="flex items-center gap-2 rounded-xl bg-[#087F5B] px-4 py-3 text-sm font-bold text-white disabled:opacity-50"
                                            >
                                                <CheckCircle2 size={16} />
                                                Approve
                                            </button>
                                            <button
                                                disabled={Boolean(busyId)}
                                                onClick={() => updateStatus(vehicle._id, "REJECTED")}
                                                className="flex items-center gap-2 rounded-xl border border-red-200 px-4 py-3 text-sm font-bold text-red-600 disabled:opacity-50"
                                            >
                                                <XCircle size={16} />
                                                Reject
                                            </button>
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </section>
            </div>
        </AdminShell>
    );
}
