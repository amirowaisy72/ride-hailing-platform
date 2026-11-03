"use client";

import { useCallback, useEffect, useState } from "react";
import {
    CarFront, CheckCircle2, Clock3, RefreshCw, Route, XCircle,
} from "lucide-react";

import AdminShell from "@/components/AdminShell";
import { authenticatedAdminRequest } from "@/lib/adminSession";

// Today's rides at a glance: four small boxes in one row, so the
// whole day is visible without scrolling. All counts are today's
// Pakistan date (backend window, resets at midnight PKT).
// Cancelled and expired stay separate on purpose: expired means
// certainly no driver was found in 15 minutes, while a passenger
// cancellation only records that the passenger cancelled — the
// before-driver-assignment subset is shown as its own line, never
// merged into the expired count.
const VEHICLE_LABELS = {
    BIKE: "Bike",
    RICKSHAW: "Rickshaw",
    CAR_AC: "Car AC",
    CAR_NON_AC: "Car Non-AC",
};

function fmtTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleTimeString("en-PK", {
        timeZone: "Asia/Karachi",
        hour: "numeric",
        minute: "2-digit",
    });
}

function fmtPrice(value) {
    if (value == null) return "—";
    return `PKR ${Number(value).toLocaleString("en-PK")}`;
}

// Freshness of a driver's last location update ("1 min ago").
// Online drivers are fresh by definition (2-minute window), so
// this normally reads "just now" or "1 min ago".
function fmtAgo(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const minutes = Math.floor((Date.now() - date.getTime()) / 60000);
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.floor(minutes / 60);
    return `${hours} hour${hours === 1 ? "" : "s"} ago`;
}

function Box({ icon: Icon, chip, title, count, subtext, recent }) {
    return (
        <div className="rounded-[22px] border border-slate-100 bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between">
                <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${chip}`}>
                    <Icon size={20} />
                </div>
            </div>
            <p className="mt-3 text-sm text-slate-500">{title}</p>
            <p className="mt-1 text-2xl font-extrabold">{count}</p>
            <p className="mt-2 text-xs leading-5 text-slate-500">{subtext}</p>
            {(recent || []).length > 0 && (
                <div className="mt-3 space-y-1 border-t border-slate-100 pt-2">
                    {(recent || []).slice(0, 5).map((item) => (
                        <p key={item.id} className="truncate text-[11px] leading-4 text-slate-500">
                            {item.text ||
                                `${fmtTime(item.time)} · ${VEHICLE_LABELS[item.vehicleType] || item.vehicleType} · ${fmtPrice(item.price)}`}
                        </p>
                    ))}
                </div>
            )}
        </div>
    );
}

export default function TodayRidesPage() {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    const load = useCallback(async () => {
        setLoading(true);
        setError("");
        try {
            const result = await authenticatedAdminRequest(
                "/admin/operations/today-rides"
            );
            setData(result.today);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        load();
    }, [load]);

    const today = data || {};
    const completed = today.completed || { count: 0, recent: [] };
    const cancelled = today.cancelled || { count: 0, beforeDriverCount: 0, recent: [] };
    const expired = today.expired || { count: 0, recent: [] };
    const online = today.onlineDrivers || { count: 0, availableCount: 0, recent: [] };
    const onlineRecent = (online.recent || []).map((item) => ({
        id: item.id,
        text: `${item.name} · ${fmtAgo(item.lastLocationUpdate)}`,
    }));

    return (
        <AdminShell title="Today Rides">
            <div className="space-y-5">
                <div className="rounded-2xl bg-white p-6 shadow-sm">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                            <h2 className="text-2xl font-extrabold">Today Rides</h2>
                            <p className="mt-2 text-sm text-slate-500">
                                {today.date
                                    ? `Pakistan date: ${today.date} · counts reset at midnight PKT.`
                                    : "Today's rides by category."}
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={load}
                            disabled={loading}
                            className="flex items-center gap-2 rounded-xl bg-[#087F5B] px-5 py-3 text-sm font-bold text-white disabled:opacity-50"
                        >
                            <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
                            Refresh
                        </button>
                    </div>
                    {error && (
                        <p className="mt-4 text-sm font-bold text-red-600">{error}</p>
                    )}
                </div>

                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <Box
                        icon={Route}
                        chip="bg-blue-50 text-blue-600"
                        title="Created Today"
                        count={today.totalCreated ?? 0}
                        subtext="Rides created today."
                        recent={[]}
                    />
                    <Box
                        icon={CheckCircle2}
                        chip="bg-emerald-50 text-[#087F5B]"
                        title="Completed Today"
                        count={completed.count}
                        subtext={
                            completed.count === 0
                                ? "No rides completed yet today."
                                : "Rides completed today."
                        }
                        recent={completed.recent}
                    />
                    <Box
                        icon={XCircle}
                        chip="bg-red-50 text-red-600"
                        title="Cancelled Today"
                        count={cancelled.count}
                        subtext={
                            cancelled.count === 0
                                ? "No rides cancelled today."
                                : `${cancelled.beforeDriverCount} cancelled before a driver was assigned.`
                        }
                        recent={cancelled.recent}
                    />
                    <Box
                        icon={Clock3}
                        chip="bg-amber-50 text-amber-600"
                        title="Expired Today"
                        count={expired.count}
                        subtext={
                            expired.count === 0
                                ? "No rides expired today."
                                : "Expired with no driver found in 15 minutes."
                        }
                        recent={expired.recent}
                    />
                    <Box
                        icon={CarFront}
                        chip="bg-violet-50 text-violet-600"
                        title="Drivers Online Now"
                        count={online.count}
                        subtext={
                            online.count === 0
                                ? "No drivers online right now."
                                : `${online.availableCount} available for rides now.`
                        }
                        recent={onlineRecent}
                    />
                </div>

                <p className="text-xs text-slate-500">
                    Expired means no driver was selected within 15 minutes. Cancelled
                    means the passenger cancelled; only the before-driver-assignment
                    line hints at waiting without a driver, since the recorded
                    reason does not prove the motive. Drivers online means the
                    online flag is on and location was updated in the last 2
                    minutes — the same rule ride offers use — so a driver who
                    closed the app stops counting after 2 minutes.
                </p>
            </div>
        </AdminShell>
    );
}
