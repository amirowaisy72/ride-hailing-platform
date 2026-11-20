"use client";

import { useCallback, useEffect, useState } from "react";
import AdminShell from "@/components/AdminShell";
import { authenticatedAdminRequest } from "@/lib/adminSession";

// ---------------------------------------------------------------------
// Safety (Safar To-Do #5, Phase 1) — admin SOS Alerts page.
//
// Lists every SOS pressed from an active ride (driver or passenger),
// with the ride, both parties, the GPS fix at SOS time, and the full
// GPS trail for a police complaint (FIR) via "Load GPS trail".
// ---------------------------------------------------------------------

const STATUSES = ["ALL", "OPEN", "ACKNOWLEDGED", "RESOLVED"];

const STATUS_CLASSES = {
    OPEN: "bg-red-100 text-red-700",
    ACKNOWLEDGED: "bg-amber-100 text-amber-700",
    RESOLVED: "bg-emerald-50 text-[#087F5B]",
};

const personName = (person) =>
    [person?.firstName, person?.lastName].filter(Boolean).join(" ") ||
    person?.email ||
    "—";

function sosCoords(alert) {
    const coords = alert?.location?.coordinates;
    if (!Array.isArray(coords) || coords.length !== 2) return null;
    return { lng: coords[0], lat: coords[1] };
}

export default function AdminSosAlertsPage() {
    const [alerts, setAlerts] = useState([]);
    const [status, setStatus] = useState("ALL");
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(0);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    const [selected, setSelected] = useState(null);
    const [editStatus, setEditStatus] = useState("OPEN");
    const [editNote, setEditNote] = useState("");
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState("");

    const [trail, setTrail] = useState(null);
    const [trailLoading, setTrailLoading] = useState(false);
    const [trailError, setTrailError] = useState("");

    const load = useCallback(async () => {
        setLoading(true);
        setError("");
        try {
            const params = new URLSearchParams({ page: String(page) });
            if (status !== "ALL") params.set("status", status);
            const data = await authenticatedAdminRequest(
                `/admin/safety/sos-alerts?${params}`
            );
            setAlerts(data.alerts || []);
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

    function openAlert(alert) {
        setSelected(alert);
        setEditStatus(alert.status);
        setEditNote(alert.adminNote || "");
        setSaveError("");
        setTrail(null);
        setTrailError("");
    }

    async function saveAlert() {
        if (!selected) return;
        setSaving(true);
        setSaveError("");
        try {
            await authenticatedAdminRequest(
                `/admin/safety/sos-alerts/${selected._id}`,
                {
                    method: "PATCH",
                    body: JSON.stringify({ status: editStatus, adminNote: editNote }),
                }
            );
            setSelected((prev) => (prev ? { ...prev, status: editStatus, adminNote: editNote } : prev));
            await load();
        } catch (err) {
            setSaveError(err.message);
        } finally {
            setSaving(false);
        }
    }

    async function loadTrail() {
        if (!selected?.ride?._id) return;
        setTrailLoading(true);
        setTrailError("");
        setTrail(null);
        try {
            const data = await authenticatedAdminRequest(
                `/admin/safety/rides/${selected.ride._id}/trail`
            );
            setTrail(data);
        } catch (err) {
            setTrailError(err.message);
        } finally {
            setTrailLoading(false);
        }
    }

    const openCount = alerts.filter((a) => a.status === "OPEN").length;

    return (
        <AdminShell title="SOS Alerts">
            <div className="mx-auto max-w-6xl space-y-4 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <h1 className="text-2xl font-extrabold">SOS Alerts</h1>
                        <p className="text-sm text-slate-500">
                            Panic-button alerts from active rides. {total} total
                            {status === "ALL" && openCount > 0 ? ` · ${openCount} open on this page` : ""}.
                            In danger cases the driver/passenger should also call 15.
                        </p>
                    </div>
                    <div className="flex gap-2">
                        {STATUSES.map((value) => (
                            <button
                                key={value}
                                type="button"
                                onClick={() => { setStatus(value); setPage(1); }}
                                className={`rounded-full px-3 py-1.5 text-xs font-bold ${status === value ? "bg-[#087F5B] text-white" : "bg-white text-slate-600 border"}`}
                            >
                                {value === "ALL" ? "All" : value.replace("_", " ")}
                            </button>
                        ))}
                    </div>
                </div>

                {loading && <p className="text-sm text-slate-500">Loading…</p>}
                {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-600">{error}</p>}

                {!loading && !error && alerts.length === 0 && (
                    <p className="rounded-2xl bg-white p-6 text-center text-sm text-slate-500">No SOS alerts yet.</p>
                )}

                <ul className="space-y-2">
                    {alerts.map((alert) => {
                        const at = sosCoords(alert);
                        return (
                            <li key={alert._id}>
                                <button
                                    type="button"
                                    onClick={() => openAlert(alert)}
                                    className="w-full rounded-2xl border bg-white p-4 text-left shadow-sm hover:border-red-300"
                                >
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                        <p className="font-bold">
                                            {alert.reporterRole === "DRIVER" ? "Driver" : "Passenger"} SOS
                                            {" · "}
                                            {personName(alert.reporter)}
                                            {alert.reporter?.phone ? ` · ${alert.reporter.phone}` : ""}
                                        </p>
                                        <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${STATUS_CLASSES[alert.status] || ""}`}>
                                            {alert.status}
                                        </span>
                                    </div>
                                    <p className="mt-1 text-xs text-slate-500">
                                        {new Date(alert.createdAt).toLocaleString()} · Ride {String(alert.ride?._id || "").slice(-6)}
                                        {alert.ride?.status ? ` · ${String(alert.ride.status).replaceAll("_", " ")}` : ""}
                                        {at ? ` · GPS ${at.lat.toFixed(5)}, ${at.lng.toFixed(5)}` : " · no GPS fix"}
                                    </p>
                                </button>
                            </li>
                        );
                    })}
                </ul>

                {totalPages > 1 && (
                    <div className="flex items-center justify-center gap-3">
                        <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)} className="rounded-xl border bg-white px-3 py-2 text-sm font-bold disabled:opacity-50">Previous</button>
                        <span className="text-sm font-semibold">Page {page} of {totalPages}</span>
                        <button type="button" disabled={page >= totalPages} onClick={() => setPage(page + 1)} className="rounded-xl border bg-white px-3 py-2 text-sm font-bold disabled:opacity-50">Next</button>
                    </div>
                )}

                {selected && (
                    <section className="rounded-2xl border bg-white p-5 shadow-sm">
                        <h2 className="text-lg font-extrabold">SOS detail</h2>
                        <dl className="mt-3 space-y-1.5 text-sm">
                            <div className="flex gap-2"><dt className="w-32 shrink-0 font-bold text-slate-500">Reporter</dt><dd>{personName(selected.reporter)} ({selected.reporterRole}){selected.reporter?.phone ? ` · ${selected.reporter.phone}` : ""}</dd></div>
                            <div className="flex gap-2"><dt className="w-32 shrink-0 font-bold text-slate-500">Passenger</dt><dd>{selected.passenger ? `${selected.passenger.name}${selected.passenger.phone ? ` · ${selected.passenger.phone}` : ""}` : "—"}</dd></div>
                            <div className="flex gap-2"><dt className="w-32 shrink-0 font-bold text-slate-500">Driver</dt><dd>{selected.driver ? `${selected.driver.name}${selected.driver.phone ? ` · ${selected.driver.phone}` : ""}` : "—"}</dd></div>
                            <div className="flex gap-2"><dt className="w-32 shrink-0 font-bold text-slate-500">Ride</dt><dd>{String(selected.ride?._id || "—")} · {selected.ride?.status || "—"}{selected.ride?.finalPrice ? ` · PKR ${selected.ride.finalPrice}` : selected.ride?.requestedPrice ? ` · PKR ${selected.ride.requestedPrice}` : ""}</dd></div>
                            <div className="flex gap-2"><dt className="w-32 shrink-0 font-bold text-slate-500">GPS at SOS</dt><dd>{(() => { const at = sosCoords(selected); return at ? (<a className="font-bold text-[#087F5B] underline" target="_blank" rel="noreferrer" href={`https://www.google.com/maps/search/?api=1&query=${at.lat},${at.lng}`}>{at.lat.toFixed(5)}, {at.lng.toFixed(5)} (open in Maps)</a>) : "No GPS fix recorded"; })()}</dd></div>
                            {selected.note && (<div className="flex gap-2"><dt className="w-32 shrink-0 font-bold text-slate-500">Note</dt><dd>{selected.note}</dd></div>)}
                            <div className="flex gap-2"><dt className="w-32 shrink-0 font-bold text-slate-500">Raised</dt><dd>{new Date(selected.createdAt).toLocaleString()}</dd></div>
                        </dl>

                        <div className="mt-4 border-t pt-4">
                            <button type="button" onClick={loadTrail} disabled={trailLoading} className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50">
                                {trailLoading ? "Loading trail…" : "Load GPS trail (FIR record)"}
                            </button>
                            {trailError && <p role="alert" className="mt-2 text-sm text-red-600">{trailError}</p>}
                            {trail && (
                                <div className="mt-3 rounded-xl bg-slate-50 p-3 text-sm">
                                    <p className="font-bold">{trail.trailPoints} GPS points recorded</p>
                                    {trail.trail?.length > 0 && (
                                        <p className="mt-1 text-slate-600">
                                            First: {new Date(trail.trail[0].recordedAt).toLocaleString()} ·{" "}
                                            Last: {new Date(trail.trail[trail.trail.length - 1].recordedAt).toLocaleString()}
                                        </p>
                                    )}
                                    {trail.trail?.length > 0 && (
                                        <p className="mt-1 text-slate-600">
                                            Route: {trail.trail[0].latitude.toFixed(5)}, {trail.trail[0].longitude.toFixed(5)}
                                            {" → "}
                                            {trail.trail[trail.trail.length - 1].latitude.toFixed(5)}, {trail.trail[trail.trail.length - 1].longitude.toFixed(5)}
                                        </p>
                                    )}
                                    {trail.passenger && <p className="mt-1">Passenger: {trail.passenger.name}{trail.passenger.phone ? ` · ${trail.passenger.phone}` : ""}</p>}
                                    {trail.driver && <p className="mt-1">Driver: {trail.driver.name}{trail.driver.phone ? ` · ${trail.driver.phone}` : ""}{trail.driver.vehicle ? ` · ${trail.driver.vehicle.make || ""} ${trail.driver.vehicle.model || ""} ${trail.driver.vehicle.registrationNumber || ""}` : ""}</p>}
                                </div>
                            )}
                        </div>

                        <div className="mt-4 border-t pt-4">
                            <label className="block text-xs font-bold uppercase tracking-wide text-slate-500" htmlFor="sos-status">Status</label>
                            <select id="sos-status" value={editStatus} onChange={(e) => setEditStatus(e.target.value)} className="mt-1 h-11 w-full rounded-xl border px-3 font-semibold">
                                <option value="OPEN">OPEN</option>
                                <option value="ACKNOWLEDGED">ACKNOWLEDGED</option>
                                <option value="RESOLVED">RESOLVED</option>
                            </select>
                            <label className="mt-3 block text-xs font-bold uppercase tracking-wide text-slate-500" htmlFor="sos-note">Admin note</label>
                            <textarea id="sos-note" value={editNote} onChange={(e) => setEditNote(e.target.value)} rows={3} maxLength={1000} className="mt-1 w-full rounded-xl border px-3 py-2" />
                            {saveError && <p role="alert" className="mt-2 text-sm text-red-600">{saveError}</p>}
                            <button type="button" onClick={saveAlert} disabled={saving} className="mt-3 rounded-xl bg-[#087F5B] px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50">
                                {saving ? "Saving…" : "Save"}
                            </button>
                        </div>
                    </section>
                )}
            </div>
        </AdminShell>
    );
}
