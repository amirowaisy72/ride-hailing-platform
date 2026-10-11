"use client";

import { useEffect, useState } from "react";
import { ArrowRight, Check, Clock3, MapPin, Navigation2, ShieldCheck, X } from "lucide-react";

const SEARCHING = ["REQUESTED", "SEARCHING", "BIDDING"];
const labels = {
    DRIVER_SELECTED: ["Driver confirmed", "Your driver is getting ready to pick you up."],
    DRIVER_EN_ROUTE: ["Driver is on the way", "Your driver is heading towards your pickup."],
    DRIVER_ARRIVED: ["Your driver has arrived", "Please meet your driver at the pickup point."],
    TRIP_STARTED: ["Your journey is underway", "Follow the journey progress here."],
};
const offerId = o => String(o?._id || o?.offerId || "");
const driverName = o => [o?.driverId?.userId?.firstName, o?.driverId?.userId?.lastName].filter(Boolean).join(" ") || "Nearby driver";
const money = v => `PKR ${Number(v || 0).toLocaleString("en-PK")}`;

export default function RideJourneyExperience({ ride, offers = [], busyId, onAccept, onReject, onCancel, cancelling, onShowMap, notification, chat = null, locationUpdatedAt = null }) {
    const [now, setNow] = useState(Date.now());
    const [showOffers, setShowOffers] = useState(true);
    useEffect(() => { const t = setInterval(() => setNow(Date.now()), 250); return () => clearInterval(t); }, []);
    useEffect(() => { setShowOffers(true); }, [ride?._id]);
    if (!ride) return null;
    const searching = SEARCHING.includes(ride.status);
    const visibleOffers = offers.filter(o => o && o.status !== "REJECTED" && (!o.expiresAt || new Date(o.expiresAt).getTime() > now));
    const active = labels[ride.status] || ["Trip in progress", "We'll keep your ride status updated."];
    const newestOffer = visibleOffers.find(o => {
        const stamp = new Date(o.updatedAt || o.createdAt || o.expiresAt && (new Date(o.expiresAt).getTime() - 300000)).getTime();
        return Number.isFinite(stamp) && now - stamp >= 0 && now - stamp < 10000;
    });
    const newestStamp = newestOffer ? new Date(newestOffer.updatedAt || newestOffer.createdAt || new Date(newestOffer.expiresAt).getTime() - 300000).getTime() : 0;
    const popupRemaining = Math.max(0, 10000 - (now - newestStamp));

    if (searching) {
        return (
            <section aria-label="Finding a driver" className="absolute inset-x-0 bottom-[calc(68px+env(safe-area-inset-bottom))] top-[calc(76px+env(safe-area-inset-top))] z-20 overflow-y-auto bg-transparent px-4 py-4">
                <div className="mx-auto flex min-h-full max-w-lg flex-col gap-3">
                    <div className="flex items-center justify-between gap-3">
                        <div className="rounded-2xl border border-emerald-100 bg-white/95 px-4 py-3 shadow-xl backdrop-blur"><p className="text-[10px] font-bold uppercase tracking-[0.13em] text-emerald-700">Searching nearby</p><h1 className="mt-1 text-xl font-black tracking-tight text-slate-900">Finding your driver</h1></div>
                        <button type="button" onClick={onShowMap} aria-label="View map" className="rounded-2xl bg-white p-3 text-emerald-700 shadow-sm"><MapPin size={21} /></button>
                    </div>
                    <div className="relative mx-auto my-1 flex h-[min(36dvh,270px)] w-[min(65vw,270px)] shrink-0 items-center justify-center rounded-full bg-emerald-50/10" aria-label="Searching nearby drivers">
                        <div className="absolute h-52 w-52 animate-ping rounded-full border border-emerald-300/60 bg-emerald-100/20" style={{ animationDuration: "3.2s" }} />
                        <div className="absolute h-44 w-44 animate-pulse rounded-full border-2 border-emerald-200 bg-emerald-50" />
                        <div className="absolute h-32 w-32 rounded-full border-2 border-dashed border-emerald-400/60" />
                        <div className="absolute right-2 top-11 h-4 w-4 rounded-full bg-emerald-400 ring-4 ring-white" />
                        <div className="absolute bottom-9 left-6 h-3 w-3 rounded-full bg-emerald-300 ring-4 ring-white" />
                        <div className="relative flex h-24 w-24 flex-col items-center justify-center rounded-full bg-[#087F5B] text-white shadow-[0_18px_45px_rgba(0,110,75,0.3)]"><Navigation2 size={33} /><span className="mt-1 text-[10px] font-bold">SEARCHING</span></div>
                    </div>
                    <p className="mx-auto rounded-full bg-white/95 px-4 py-2 text-center text-xs font-semibold text-emerald-800 shadow-lg">Checking available drivers around your pickup</p>
                    <div className="mt-auto grid grid-cols-2 gap-3">
                        <div className="rounded-2xl bg-white/95 p-4 shadow-lg"><p className="text-xs text-slate-400">Your proposed fare</p><p className="mt-1 text-xl font-black text-emerald-800">{money(ride.requestedPrice)}</p></div>
                        <div className="rounded-2xl bg-white/95 p-4 shadow-lg"><p className="text-xs text-slate-400">Offers available</p><p className="mt-1 text-xl font-black text-slate-900">{visibleOffers.length}</p></div>
                    </div>
                    {newestOffer && popupRemaining > 0 && <div role="alert" className="fixed inset-x-3 top-[calc(84px+env(safe-area-inset-top))] z-[60] mx-auto max-w-md rounded-[24px] border border-emerald-100 bg-white p-4 shadow-[0_20px_60px_rgba(0,40,25,0.3)]">
                        <div className="flex items-center justify-between gap-3"><div><p className="text-[10px] font-extrabold uppercase tracking-widest text-emerald-700">New driver offer</p><p className="mt-1 font-bold text-slate-900">{driverName(newestOffer)}</p></div><strong className="text-2xl font-black text-emerald-700">{money(newestOffer.price)}</strong></div>
                        <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-emerald-600 transition-[width] duration-200" style={{ width: `${popupRemaining / 100}%` }} /></div>
                        <div className="mt-3 grid grid-cols-2 gap-2"><button type="button" disabled={!!busyId} onClick={() => onReject(offerId(newestOffer))} className="rounded-xl border border-red-200 bg-red-50 py-3 text-sm font-bold text-red-600 disabled:opacity-50">Reject</button><button type="button" disabled={!!busyId} onClick={() => onAccept(offerId(newestOffer))} className="rounded-xl bg-[#087F5B] py-3 text-sm font-bold text-white disabled:opacity-50">Accept offer</button></div>
                        <p className="mt-2 text-right text-[10px] text-slate-400">Closes in {Math.ceil(popupRemaining / 1000)}s · offer remains in list</p>
                    </div>}
                    {notification && <p role="status" className="rounded-xl bg-white/95 px-4 py-2 text-xs text-slate-600 shadow-sm">{notification}</p>}
                    {visibleOffers.length > 0 && (
                        <div className="mt-5 rounded-[28px] border border-emerald-100 bg-white p-4 shadow-xl shadow-emerald-900/5">
                            <button className="flex w-full items-center justify-between text-left" type="button" onClick={() => setShowOffers(v => !v)}><span className="font-extrabold text-slate-900">Driver offers ({visibleOffers.length})</span><span className="text-xs font-bold text-emerald-700">{showOffers ? "Hide" : "Show"}</span></button>
                            {showOffers && <div className="mt-4 space-y-3">{visibleOffers.map(offer => {
                                const key = offerId(offer);
                                const expiry = new Date(offer.expiresAt).getTime();
                                const remaining = Number.isFinite(expiry) ? Math.max(0, expiry - now) : 300000;
                                const percentage = Math.min(100, remaining / 300000 * 100);
                                return <article key={key} className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                                    <div className="flex items-center justify-between gap-2"><div><p className="font-bold text-slate-900">{driverName(offer)}</p><p className="mt-1 flex items-center gap-1 text-xs text-slate-500"><ShieldCheck size={13} /> Driver offer {offer.driverId?.rating != null ? `· ★ ${offer.driverId.rating}` : ""}</p></div><strong className="text-xl text-[#087F5B]">{money(offer.price)}</strong></div>
                                    <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-emerald-100"><div className="h-full rounded-full bg-emerald-600 transition-[width] duration-200" style={{ width: `${percentage}%` }} /></div>
                                    <p className="mt-1.5 flex items-center gap-1 text-[11px] text-slate-500"><Clock3 size={12} />Offer valid for {Math.ceil(remaining / 1000)} more seconds</p>
                                    <div className="mt-3 grid grid-cols-2 gap-2"><button disabled={!!busyId} onClick={() => onReject(key)} className="rounded-xl border border-red-100 bg-white py-3 text-sm font-bold text-red-600 disabled:opacity-50">Reject</button><button disabled={!!busyId} onClick={() => onAccept(key)} className="flex items-center justify-center gap-2 rounded-xl bg-[#087F5B] py-3 text-sm font-bold text-white disabled:opacity-50"><Check size={16} /> Accept</button></div>
                                </article>;
                            })}</div>}
                        </div>
                    )}
                    <div className="mt-auto pt-6"><button type="button" disabled={cancelling} onClick={onCancel} className="w-full rounded-2xl border border-red-200 bg-white py-4 font-bold text-red-600 disabled:opacity-50">{cancelling ? "Cancelling..." : "Cancel ride request"}</button><p className="mt-3 rounded-xl bg-white/90 p-2 text-center text-xs text-slate-500">Real drivers appear here as their offers arrive. Live driver pins need the location feed.</p></div>
                </div>
            </section>
        );
    }

    return <section aria-label="Active ride" className="absolute inset-x-0 bottom-[calc(68px+env(safe-area-inset-bottom))] z-20 max-h-[56dvh] overflow-y-auto rounded-t-[32px] bg-white px-5 pb-7 pt-4 shadow-[0_-15px_50px_rgba(15,23,42,0.12)]">
        <div className="mx-auto max-w-lg"><div className="mx-auto mb-5 h-1.5 w-12 rounded-full bg-slate-200" /><div className="flex items-start justify-between gap-3"><div><span className="rounded-full bg-emerald-50 px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-emerald-700">Live ride status</span><h1 className="mt-3 text-2xl font-black text-slate-900">{active[0]}</h1><p className="mt-1 text-sm text-slate-500">{active[1]}</p></div><button type="button" onClick={onShowMap} className="shrink-0 rounded-xl bg-emerald-50 p-3 text-emerald-700" aria-label="Show more of map"><Navigation2 size={21} /></button></div>
            <div className="mt-6 flex items-center justify-between gap-2 rounded-2xl bg-slate-50 p-4"><div><p className="text-xs text-slate-500">Agreed fare</p><p className="text-xl font-black text-[#087F5B]">{money(ride.finalPrice || ride.requestedPrice)}</p></div><span className="text-xs font-semibold text-slate-500">{String(ride.vehicleType || "").replaceAll("_", " ")}</span></div>
            <div className="mt-5 space-y-3"><div className="flex gap-3"><span className="mt-1 h-3 w-3 shrink-0 rounded-full bg-emerald-600" /><div><p className="text-xs font-bold uppercase text-slate-400">Pickup</p><p className="text-sm text-slate-700">Your chosen pickup location</p></div></div>{(ride.stops || []).map((s, i) => <div key={i} className="flex gap-3"><span className="mt-1 h-3 w-3 shrink-0 rounded-full border-2 border-amber-500" /><p className="text-sm text-slate-700">{s.name || `Stop ${i + 1}`}</p></div>)}<div className="flex gap-3"><span className="mt-1 h-3 w-3 shrink-0 rounded-full bg-red-500" /><div><p className="text-xs font-bold uppercase text-slate-400">Destination</p><p className="text-sm text-slate-700">Your selected destination</p></div></div></div>
            {chat && <div className="mt-4">{chat}</div>}
            {locationUpdatedAt && <p className="mt-3 text-xs text-slate-500">Driver GPS last updated: {new Date(locationUpdatedAt).toLocaleTimeString()}</p>}
            {ride.status === "DRIVER_ARRIVED" && <div role="alert" className="mt-5 rounded-2xl bg-amber-50 p-4 font-semibold text-amber-800">Your driver is waiting at the pickup point.</div>}
            {notification && <p role="status" className="mt-4 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">{notification}</p>}
            <p className="mt-5 text-center text-xs text-slate-400">Road ETA is estimated. Follow the map for driver location updates.</p>
        </div>
    </section>;
}
