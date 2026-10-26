"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, ChevronRight, Navigation, Package, Scale, ShoppingBag } from "lucide-react";
import AuthGuard from "@/components/AuthGuard";
import { useAuth } from "@/context/AuthContext";
import { apiRequest } from "@/lib/api";
import { Geolocation } from "@capacitor/geolocation";
import { updateDriverLocation } from "@/lib/vehicleService";
import { getRealtimeSocket } from "@/lib/socket";
import {
    CardSkeleton, EmptyState, InlineError, ParcelProgress, ParcelStatusBadge, RouteSummary, Toast,
} from "@/components/parcel/ParcelKit";
import {
    VEHICLE_LABELS, categoryLabel, formatPKR, isActive, orderPrice, playNotificationSound, serviceLabel, statusMeta,
} from "@/components/parcel/parcelUi";

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
    const [assignedParcelId, setAssignedParcelId] = useState("");
    const [loaded, setLoaded] = useState(false);
    const [tab, setTab] = useState("requests");

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
        } finally {
            setLoaded(true);
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
            setAssignedParcelId(data?.parcelId ? String(data.parcelId) : "");
            refresh();
            playNotificationSound(0.6);
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
            setNotification("Offer sent. Waiting for the customer to respond.");
            setAssignedParcelId("");
            setSentOffers((prev) => ({ ...prev, [id]: price }));
            await refresh();
        } catch (e) {
            setError(
                e.message?.includes("DRIVER_WALLET_TOP_UP_REQUIRED") ||
                    e.message?.includes("Please top up your wallet")
                    ? "Wallet top-up required. Please open Earnings / Wallet to add funds before submitting parcel offers."
                    : e.message
            );
        } finally {
            setBusy("");
        }
    }

    const activeJobs = assigned.filter(isActive);
    const pastJobs = assigned.filter((o) => !isActive(o));

    // Show active jobs first automatically when one exists.
    const autoTabbed = useRef(false);
    useEffect(() => {
        if (!loaded || autoTabbed.current) return;
        autoTabbed.current = true;
        if (activeJobs.length > 0) setTab("active");
    }, [loaded, activeJobs.length]);

    const navTarget = assignedParcelId || activeJobs[0]?._id;

    return (
        <main className="min-h-dvh bg-pd-bg text-pd-text">
            <Toast
                message={notification}
                onClose={() => setNotification("")}
                timeout={assignedParcelId ? 12000 : 5000}
                action={assignedParcelId && navTarget ? (
                    <Link
                        href={`/driver/parcels/details?parcelId=${navTarget}`}
                        className="shrink-0 rounded-xl bg-pd-accent px-3 py-2 text-xs font-extrabold text-pd-accent-ink"
                    >
                        Navigate
                    </Link>
                ) : null}
            />

            <div className="sticky top-0 z-20 border-b border-pd-line bg-pd-elevated backdrop-blur-xl pd-safe-top">
                <div className="mx-auto flex max-w-xl items-center gap-2 px-3">
                    <Link href="/driver" aria-label="Driver home" className="grid h-11 w-11 place-items-center rounded-2xl">
                        <ArrowLeft size={21} />
                    </Link>
                    <h1 className="flex-1 text-lg font-extrabold tracking-tight">Parcel deliveries</h1>
                </div>
                <div role="tablist" aria-label="Parcel lists" className="mx-auto grid max-w-xl grid-cols-2 gap-1 px-4 pb-2.5 pt-1">
                    {[
                        ["requests", "Requests", available.length],
                        ["active", "My deliveries", activeJobs.length],
                    ].map(([value, label, count]) => (
                        <button
                            key={value}
                            role="tab"
                            type="button"
                            aria-selected={tab === value}
                            onClick={() => setTab(value)}
                            className={`flex min-h-10 items-center justify-center gap-1.5 rounded-xl text-sm font-bold transition ${tab === value ? "bg-pd-ink text-pd-ink-text" : "bg-pd-surface-2 text-pd-muted"}`}
                        >
                            {label}
                            {count > 0 && (
                                <span className={`min-w-5 rounded-full px-1.5 text-[11px] leading-5 ${tab === value ? "bg-pd-accent text-pd-accent-ink" : "bg-pd-surface-3 text-pd-text"}`}>{count}</span>
                            )}
                        </button>
                    ))}
                </div>
            </div>

            <div className="mx-auto max-w-xl space-y-3 px-4 pb-[calc(28px+env(safe-area-inset-bottom))] pt-4">
                <InlineError onDismiss={() => setError("")}>{error}</InlineError>

                {!loaded && <CardSkeleton count={2} />}

                {loaded && tab === "requests" && (
                    <>
                        {available.length === 0 && (
                            <EmptyState
                                title="No parcel requests nearby"
                                body="Keep this screen open. New requests refresh automatically."
                            />
                        )}
                        {available.map((order) => (
                            <RequestCard
                                key={order._id}
                                order={order}
                                value={offerPrices[order._id] ?? ""}
                                onChange={(value) => setOfferPrices((prev) => ({ ...prev, [order._id]: value }))}
                                sentPrice={sentOffers[order._id]}
                                busy={busy === order._id}
                                disabled={Boolean(busy)}
                                onSubmit={() => submitOffer(order._id, order.requestedPrice)}
                            />
                        ))}
                    </>
                )}

                {loaded && tab === "active" && (
                    <>
                        {activeJobs.length === 0 && (
                            <EmptyState
                                icon={Navigation}
                                title="No active deliveries"
                                body="When a customer accepts your offer it appears here."
                            />
                        )}
                        {activeJobs.map((order) => <AssignedCard key={order._id} order={order} />)}

                        {pastJobs.length > 0 && (
                            <>
                                <h2 className="px-1 pt-3 text-xs font-bold uppercase tracking-wider text-pd-muted">Completed & past</h2>
                                <div className="divide-y divide-pd-line overflow-hidden rounded-3xl border border-pd-line bg-pd-surface">
                                    {pastJobs.map((order) => (
                                        <Link key={order._id} href={`/driver/parcels/details?parcelId=${order._id}`} className="flex min-h-14 items-center gap-3 px-4 py-3">
                                            <span className="min-w-0 flex-1 truncate text-sm font-semibold">{order.destination?.address || serviceLabel(order.serviceType)}</span>
                                            <span className="text-sm font-bold">{formatPKR(orderPrice(order))}</span>
                                            <ParcelStatusBadge status={order.status} />
                                        </Link>
                                    ))}
                                </div>
                            </>
                        )}
                    </>
                )}
            </div>
        </main>
    );
}

function RequestCard({ order, value, onChange, sentPrice, busy, disabled, onSubmit }) {
    const requested = Number(order.requestedPrice);
    const current = Number(value || requested);
    const bump = (delta) => {
        const base = Number.isFinite(current) ? current : requested;
        onChange(String(Math.max(1, Math.round(base + delta))));
    };
    const ServiceIcon = order.serviceType === "SHOP_PICKUP" ? ShoppingBag : Package;

    return (
        <article className="pd-rise rounded-3xl border border-pd-line bg-pd-surface p-4 shadow-pd">
            <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2.5">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-pd-accent-soft text-pd-accent-text">
                        <ServiceIcon size={19} />
                    </span>
                    <div className="min-w-0">
                        <p className="text-sm font-extrabold">{serviceLabel(order.serviceType)}</p>
                        <p className="flex items-center gap-1 truncate text-xs text-pd-muted">
                            {categoryLabel(order.parcel?.category)} · <Scale size={11} /> {order.parcel?.weightKg} kg
                            {order.vehicleType && ` · ${VEHICLE_LABELS[order.vehicleType] || order.vehicleType}`}
                        </p>
                    </div>
                </div>
                <div className="shrink-0 text-right">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-pd-muted">Offered</p>
                    <p className="text-lg font-extrabold leading-tight">{formatPKR(order.requestedPrice)}</p>
                </div>
            </div>

            <div className="mt-4">
                <RouteSummary pickup={order.pickup} destination={order.destination} compact />
            </div>

            <div className="mt-4 rounded-2xl bg-pd-surface-2 p-2">
                <div className="flex items-center gap-1.5">
                    <button type="button" aria-label="Decrease fare by 50" onClick={() => bump(-50)} className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-pd-surface text-lg font-extrabold">−</button>
                    <label className="relative min-w-0 flex-1">
                        <span className="sr-only">Your fare in PKR</span>
                        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-pd-muted">PKR</span>
                        <input
                            type="number"
                            inputMode="numeric"
                            min="1"
                            step="1"
                            placeholder={String(order.requestedPrice ?? "")}
                            value={value}
                            onChange={(e) => onChange(e.target.value.replace(/[^\d]/g, ""))}
                            className="h-12 w-full rounded-xl bg-pd-surface pl-11 pr-2 text-center text-xl font-extrabold text-pd-text outline-none placeholder:text-pd-faint focus:ring-2 focus:ring-pd-text"
                        />
                    </label>
                    <button type="button" aria-label="Increase fare by 50" onClick={() => bump(50)} className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-pd-surface text-lg font-extrabold">+</button>
                </div>
                <button
                    type="button"
                    disabled={disabled}
                    onClick={onSubmit}
                    className={`mt-2 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl text-[15px] font-extrabold transition active:scale-[.98] disabled:opacity-50 ${sentPrice ? "bg-pd-ink text-pd-ink-text" : "bg-pd-accent text-pd-accent-ink"}`}
                >
                    {busy ? "Sending…" : sentPrice ? "Update offer" : value && Number(value) !== requested ? `Offer ${formatPKR(value)}` : `Accept ${formatPKR(order.requestedPrice)}`}
                </button>
            </div>

            {sentPrice && (
                <p role="status" className="mt-3 flex items-center gap-2 rounded-2xl bg-pd-accent-soft px-3 py-2.5 text-sm font-semibold text-pd-accent-text">
                    <Check size={16} className="shrink-0" />
                    Offer of {formatPKR(sentPrice)} sent. Waiting for customer.
                </p>
            )}
        </article>
    );
}

function AssignedCard({ order }) {
    return (
        <Link
            href={`/driver/parcels/details?parcelId=${order._id}`}
            className="pd-rise block rounded-3xl border border-pd-line bg-pd-surface p-4 shadow-pd active:scale-[.99]"
        >
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <p className="text-xs font-semibold text-pd-muted">{serviceLabel(order.serviceType)} · {formatPKR(orderPrice(order))}</p>
                    <p className="mt-0.5 text-[17px] font-extrabold">{statusMeta(order.status).label}</p>
                </div>
                <ParcelStatusBadge status={order.status} />
            </div>
            <ParcelProgress status={order.status} className="mt-3" />
            <div className="mt-4">
                <RouteSummary pickup={order.pickup} destination={order.destination} compact />
            </div>
            <span className="mt-4 flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-pd-ink text-[15px] font-extrabold text-pd-ink-text">
                <Navigation size={17} /> Open navigation <ChevronRight size={17} />
            </span>
        </Link>
    );
}
