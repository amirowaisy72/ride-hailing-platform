"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ChevronRight, Navigation } from "lucide-react";
import AuthGuard from "@/components/AuthGuard";
import JobRequestCard from "@/components/driver/service/JobRequestCard";
import { useAuth } from "@/context/AuthContext";
import { apiRequest } from "@/lib/api";
import { useDriverPosition } from "@/hooks/useDriverPosition";
import { getRealtimeSocket } from "@/lib/socket";
import {
    CardSkeleton, EmptyState, InlineError, ParcelProgress, ParcelStatusBadge, RouteSummary, Toast,
} from "@/components/parcel/ParcelKit";
import {
    VEHICLE_LABELS, categoryLabel, formatPKR, isActive, orderPrice, playNotificationSound, serviceLabel, shortAddress, statusMeta,
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

    // Location sync runs on the shared driver-position pipeline (Round
    // 4's hook): a continuous watch shared with the other driver
    // screens, accurate fixes (<= 100 m) synced to the backend throttled
    // to 10 s. This page used to run its own 30 s getCurrentPosition
    // poll with the same accuracy gate and no watch — a driver sitting
    // on this list in a weak-signal spot silently stopped syncing, so
    // passengers and the nearby-parcel query saw a stale driver. The
    // hook call is for its sync side effect; this list shows no map.
    useDriverPosition({ token });
    const [assigned, setAssigned] = useState([]);
    const [offerPrices, setOfferPrices] = useState({});
    const [sentOffers, setSentOffers] = useState({});
    const [declined, setDeclined] = useState([]);
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

    const visibleRequests = available.filter((order) => !declined.includes(order._id));
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
                        {visibleRequests.length === 0 && (
                            <EmptyState
                                title="No parcel requests nearby"
                                body="Keep this screen open. New requests refresh automatically."
                            />
                        )}
                        {visibleRequests.map((order) => (
                            <RequestCard
                                key={order._id}
                                onDecline={() => setDeclined((prev) => [...prev, order._id])}
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

function RequestCard({ order, value, onChange, sentPrice, busy, disabled, onSubmit, onDecline }) {
    const facts = [
        categoryLabel(order.parcel?.category),
        order.parcel?.weightKg ? `${order.parcel.weightKg} kg` : null,
        order.vehicleType ? VEHICLE_LABELS[order.vehicleType] || order.vehicleType : null,
    ].filter(Boolean);

    return (
        <JobRequestCard
            service="PARCEL"
            heading={serviceLabel(order.serviceType)}
            subject={categoryLabel(order.parcel?.category) || "Parcel"}
            subjectNote={order.parcel?.weightKg ? `${order.parcel.weightKg} kg` : undefined}
            amountLabel="Customer offers"
            amountText={formatPKR(order.requestedPrice)}
            facts={facts.slice(1)}
            fromText={shortAddress(order.pickup?.address, "Pickup")}
            toText={shortAddress(order.destination?.address, "Drop-off")}
            baseFare={Number(order.requestedPrice)}
            fare={value}
            onFareChange={onChange}
            busy={busy || disabled}
            sentText={sentPrice ? `Offer of ${formatPKR(sentPrice)} sent. Waiting for the customer.` : undefined}
            onAccept={onSubmit}
            onDecline={onDecline}
            className="pd-rise"
        />
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
