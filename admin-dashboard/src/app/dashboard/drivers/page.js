
"use client";

import { useCallback, useEffect, useState } from "react";
import {
    CarFront, CheckCircle2, Clock3, RefreshCw,
    Search, ShieldCheck, XCircle, UserRound,
    AlertCircle, ChevronLeft, ChevronRight,
} from "lucide-react";

import AdminShell from "@/components/AdminShell";
import { authenticatedAdminRequest } from "@/lib/adminSession";
import DriverDocumentReview from "@/components/DriverDocumentReview";
import DriverServicesPanel from "@/components/DriverServicesPanel";

const statuses = {
    APPROVED: "bg-emerald-50 text-emerald-700",
    PENDING: "bg-amber-50 text-amber-700",
    REJECTED: "bg-red-50 text-red-700",
    SUSPENDED: "bg-red-50 text-red-700",
};

const nameOf = (driver) =>
    [
        driver.userId?.firstName,
        driver.userId?.lastName,
    ].filter(Boolean).join(" ") ||
    driver.userId?.name ||
    driver.name ||
    "Driver";

export default function DriversPage() {
    const [drivers, setDrivers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [message, setMessage] = useState("");
    const [busyId, setBusyId] = useState(null);
    const [reviewDriver, setReviewDriver] = useState(null);
    const [servicesDriver, setServicesDriver] = useState(null);
    const [filter, setFilter] = useState("ALL");
    const [search, setSearch] = useState("");

    const loadDrivers = useCallback(async () => {
        setLoading(true);
        setError("");

        try {
            const data = await authenticatedAdminRequest(
                "/admin/drivers"
            );

            const records = Array.isArray(data.drivers)
                ? data.drivers
                : [];

            setDrivers(records);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadDrivers();
    }, [loadDrivers]);

    async function updateDriver(driverId, action) {
        if (busyId) return;

        const label = action === "approve" ? "approve" : "reject";

        let rejectionReason = "";

        if (action === "reject") {
            const reason = window.prompt("Enter rejection reason:");
            if (!reason?.trim()) return;
            rejectionReason = reason.trim();
        } else if (!window.confirm(`Are you sure you want to ${label} this driver?`)) {
            return;
        }

        setBusyId(driverId);
        setError("");
        setMessage("");

        try {
            // Approval route compatibility will be verified
            // against the existing backend controller.
            const path = `/admin/drivers/${driverId}/status`;

            await authenticatedAdminRequest(path, {
                method: "PATCH",
                body: JSON.stringify({
                    status: action === "approve" ? "APPROVED" : "REJECTED",
                    ...(action === "reject" ? { rejectionReason } : {}),
                }),
            });

            setMessage(`Driver ${label} action completed.`);
            await loadDrivers();
        } catch (err) {
            setError(err.message);
        } finally {
            setBusyId(null);
        }
    }

    const visible = drivers.filter((driver) => {
        const matchesStatus =
            filter === "ALL" ||
            driver.verificationStatus === filter;

        const query = search.trim().toLowerCase();

        const matchesSearch =
            !query ||
            nameOf(driver).toLowerCase().includes(query) ||
            (driver.userId?.email || "")
                .toLowerCase().includes(query);

        return matchesStatus && matchesSearch;
    });

    const countStatus = (status) =>
        drivers.filter((d) => d.verificationStatus === status).length;

    return (
        <AdminShell title="Driver Management">
            <div className="space-y-6">
                <section className="rounded-[24px] bg-white p-6 shadow-sm">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                        <div>
                            <p className="text-xs font-bold uppercase tracking-wider text-[#087F5B]">
                                Verification & Operations
                            </p>
                            <h2 className="mt-2 text-2xl font-extrabold">
                                Driver Management
                            </h2>
                            <p className="mt-2 text-sm text-slate-500">
                                Review registered drivers, verification status
                                and approval requests.
                            </p>
                        </div>

                        <button
                            type="button"
                            onClick={loadDrivers}
                            disabled={loading}
                            className="flex items-center gap-2 rounded-xl border px-4 py-3 text-sm font-bold disabled:opacity-50"
                        >
                            <RefreshCw
                                size={18}
                                className={loading ? "animate-spin" : ""}
                            />
                            Refresh
                        </button>
                    </div>
                </section>

                <div className="grid gap-4 sm:grid-cols-3">
                    {[
                        {
                            label: "Total Drivers",
                            value: drivers.length,
                            icon: UserRound,
                        },
                        {
                            label: "Approved",
                            value: countStatus("APPROVED"),
                            icon: CheckCircle2,
                        },
                        {
                            label: "Pending",
                            value: countStatus("PENDING"),
                            icon: Clock3,
                        },
                    ].map(({ label, value, icon: Icon }) => (
                        <div
                            key={label}
                            className="rounded-2xl bg-white p-5 shadow-sm"
                        >
                            <Icon size={24} className="text-[#087F5B]" />
                            <p className="mt-4 text-sm text-slate-500">
                                {label}
                            </p>
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
                                type="search"
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                placeholder="Search drivers by name or email"
                                className="h-12 min-w-0 flex-1 bg-transparent text-sm outline-none"
                            />
                        </div>

                        <div className="flex flex-wrap gap-2">
                            {["ALL", "PENDING", "APPROVED", "REJECTED"].map((status) => (
                                <button
                                    key={status}
                                    type="button"
                                    onClick={() => setFilter(status)}
                                    className={`rounded-xl px-4 py-2 text-xs font-bold ${filter === status
                                        ? "bg-[#087F5B] text-white"
                                        : "bg-slate-100 text-slate-600"
                                        }`}
                                >
                                    {status === "ALL" ? "All Drivers" : status}
                                </button>
                            ))}
                        </div>
                    </div>

                    {message && (
                        <p
                            role="status"
                            className="m-5 rounded-xl bg-emerald-50 p-4 text-sm font-semibold text-[#087F5B]"
                        >
                            {message}
                        </p>
                    )}

                    {error && (
                        <p
                            role="alert"
                            className="m-5 rounded-xl bg-red-50 p-4 text-sm text-red-600"
                        >
                            <AlertCircle size={16} className="mr-2 inline" />
                            {error}
                        </p>
                    )}

                    {loading ? (
                        <p className="p-10 text-center text-sm text-slate-500">
                            Loading drivers...
                        </p>
                    ) : visible.length === 0 ? (
                        <div className="p-10 text-center">
                            <CarFront
                                size={35}
                                className="mx-auto text-[#087F5B]"
                            />
                            <p className="mt-3 font-bold">No drivers found</p>
                        </div>
                    ) : (
                        <div className="divide-y divide-slate-100">
                            {visible.map((driver) => {
                                const status = driver.verificationStatus || "PENDING";
                                const driverId = driver._id || driver.driverId;

                                return (
                                    <div
                                        key={driverId}
                                        className="flex flex-wrap items-center gap-4 p-5"
                                    >
                                        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 text-[#087F5B]">
                                            <UserRound size={23} />
                                        </div>

                                        <div className="min-w-0 flex-1">
                                            <h3 className="font-bold">{nameOf(driver)}</h3>
                                            <p className="truncate text-sm text-slate-500">
                                                {driver.userId?.email || "Email unavailable"}
                                            </p>
                                            <span
                                                className={`mt-2 inline-block rounded-lg px-3 py-1 text-xs font-bold ${statuses[status] || "bg-slate-100 text-slate-600"
                                                    }`}
                                            >
                                                {status}
                                            </span>

                                            {/* Phase 7 — per-service records at a glance
                                                (stored statuses; the Services panel shows
                                                the evaluated eligibility). */}
                                            <div className="mt-2 flex flex-wrap gap-1.5">
                                                {[
                                                    ["RIDE", "Ride"],
                                                    ["PARCEL", "Parcel"],
                                                    ["BUY_DELIVER", "Buy & Deliver"],
                                                ].map(([key, label]) => {
                                                    const serviceStatus =
                                                        driver.services?.[key]?.status || "NOT_APPLIED";
                                                    return (
                                                        <span
                                                            key={key}
                                                            className={`rounded-md px-2 py-0.5 text-[10px] font-bold ${statuses[serviceStatus] || "bg-slate-100 text-slate-500"
                                                                }`}
                                                        >
                                                            {label}: {serviceStatus.replaceAll("_", " ")}
                                                        </span>
                                                    );
                                                })}
                                            </div>
                                        </div>

                                        <button
                                            type="button"
                                            onClick={() =>
                                                setReviewDriver({
                                                    id: driverId,
                                                    name: nameOf(driver),
                                                })
                                            }
                                            className="rounded-xl border border-emerald-200 px-4 py-3 text-sm font-bold text-[#087F5B]"
                                        >
                                            Review Documents
                                        </button>

                                        <button
                                            type="button"
                                            onClick={() =>
                                                setServicesDriver({
                                                    id: driverId,
                                                    name: nameOf(driver),
                                                })
                                            }
                                            className="rounded-xl border border-emerald-200 px-4 py-3 text-sm font-bold text-[#087F5B]"
                                        >
                                            Services
                                        </button>

                                        {["PENDING", "UNDER_REVIEW"].includes(status) && (
                                            <div className="flex gap-2">
                                                <button
                                                    type="button"
                                                    disabled={Boolean(busyId)}
                                                    onClick={() => updateDriver(driverId, "approve")}
                                                    className="flex items-center gap-2 rounded-xl bg-[#087F5B] px-4 py-3 text-sm font-bold text-white disabled:opacity-50"
                                                >
                                                    <CheckCircle2 size={16} />
                                                    Approve
                                                </button>

                                                <button
                                                    type="button"
                                                    disabled={Boolean(busyId)}
                                                    onClick={() => updateDriver(driverId, "reject")}
                                                    className="flex items-center gap-2 rounded-xl border border-red-200 px-4 py-3 text-sm font-bold text-red-600 disabled:opacity-50"
                                                >
                                                    <XCircle size={16} />
                                                    Reject
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </section>
            </div>
            {reviewDriver && (
                <DriverDocumentReview
                    driverId={reviewDriver.id}
                    driverName={reviewDriver.name}
                    onClose={() => setReviewDriver(null)}
                    onUpdated={loadDrivers}
                />
            )}
            {servicesDriver && (
                <DriverServicesPanel
                    driverId={servicesDriver.id}
                    driverName={servicesDriver.name}
                    onClose={() => setServicesDriver(null)}
                    onUpdated={loadDrivers}
                />
            )}
        </AdminShell>
    );
}
