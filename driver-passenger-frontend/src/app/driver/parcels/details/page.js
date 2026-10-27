"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import RideMap from "@/components/RideMap";
import { useDriverPosition } from "@/hooks/useDriverPosition";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, CheckCircle2, CornerUpRight, KeyRound, Phone, Satellite } from "lucide-react";
import AuthGuard from "@/components/AuthGuard";
import { useAuth } from "@/context/AuthContext";
import { apiRequest } from "@/lib/api";
import BottomSheet from "@/components/parcel/BottomSheet";
import {
    Button, InlineError, ParcelStatusBadge, ParcelTimeline, RouteSummary, Toast,
} from "@/components/parcel/ParcelKit";
import { categoryLabel, formatPKR, orderPrice, serviceLabel, shortAddress } from "@/components/parcel/parcelUi";

const NEXT = {
    DRIVER_ASSIGNED: ["DRIVER_EN_ROUTE", "Head to Pickup"],
    DRIVER_EN_ROUTE: ["ARRIVED_AT_PICKUP", "I've Arrived"],
    ARRIVED_AT_PICKUP: ["PICKED_UP", "Confirm Parcel Pickup"],
    PICKED_UP: ["OUT_FOR_DELIVERY", "Start Delivery"],
    OUT_FOR_DELIVERY: ["DELIVERED", "Confirm Delivery"],
};

const STAGE_COPY = {
    DRIVER_ASSIGNED: "New delivery · start heading to pickup",
    DRIVER_EN_ROUTE: "Heading to pickup",
    ARRIVED_AT_PICKUP: "At pickup · verify the code",
    PICKED_UP: "Parcel collected",
    OUT_FOR_DELIVERY: "Delivering parcel",
    DELIVERED: "Delivered",
    CANCELLED: "Delivery cancelled",
    FAILED: "Delivery failed",
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
    // Live position via the shared hook: the map/marker/route update on
    // every fix of any accuracy (last known fix shows instantly) and the
    // hook syncs accurate fixes to the backend — the map is never blocked
    // waiting for a perfect GPS fix. gpsOk only drives the status pill.
    const {
        position: driverLocation,
        gpsOk,
        message: gpsMessage,
    } = useDriverPosition({ token });
    const [routeInfo, setRouteInfo] = useState(null);
    const [snap, setSnap] = useState("peek");
    const [toast, setToast] = useState("");
    const busyRef = useRef(false);

    const headingToPickup = [
        "DRIVER_ASSIGNED",
        "DRIVER_EN_ROUTE",
        "ARRIVED_AT_PICKUP",
    ].includes(order?.status);

    const delivered = order?.status === "DELIVERED";
    const ended = ["DELIVERED", "CANCELLED", "FAILED"].includes(order?.status);

    const navigationTarget = ended
        ? null
        : headingToPickup
            ? order?.pickup
            : order?.destination;

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

    // Announce the automatic target switch pickup -> destination.
    const prevPhase = useRef(null);
    useEffect(() => {
        if (!order) return;
        const phase = ended ? "ended" : headingToPickup ? "pickup" : "delivery";
        if (prevPhase.current === "pickup" && phase === "delivery") {
            setToast("Pickup verified. Navigation switched to the drop-off.");
            setRouteInfo(null);
        }
        prevPhase.current = phase;
    }, [order, headingToPickup, ended]);

    async function updateStatus() {
        if (!order || !NEXT[order.status] || busyRef.current) return;

        const needsOtp = ["ARRIVED_AT_PICKUP", "OUT_FOR_DELIVERY"]
            .includes(order.status);

        if (needsOtp && !/^\d{6}$/.test(otp)) {
            setError("Enter the 6-digit confirmation code.");
            return;
        }

        busyRef.current = true;
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
            busyRef.current = false;
            setBusy(false);
        }
    }

    const action = NEXT[order?.status];
    const needsOtp = ["ARRIVED_AT_PICKUP", "OUT_FOR_DELIVERY"]
        .includes(order?.status);

    const contact = headingToPickup ? order?.sender : order?.receiver;
    const targetLabel = headingToPickup ? "Pickup" : "Drop-off";
    const sheetRatio = snap === "peek" ? (needsOtp ? 0.4 : 0.3) : snap === "half" ? 0.6 : 0.85;

    return (
        <main className="relative h-dvh overflow-hidden bg-pd-surface-3 text-pd-text">
            <Toast message={toast} onClose={() => setToast("")} />

            <div className="absolute inset-0">
                <RideMap
                    userLocation={driverLocation}
                    driverLocation={driverLocation}
                    vehicleType={order?.vehicleType || null}
                    destination={navigationTarget}
                    navigationMode={true}
                    followDriver={true}
                    sheetRatio={sheetRatio}
                    onRouteUpdate={setRouteInfo}
                    showNavigationControl={false}
                />
            </div>

            {/* Compact navigation strip — minimal footprint over the map */}
            <div className="pointer-events-none absolute inset-x-0 top-0 z-20 pd-safe-top">
                <div className="mx-auto flex max-w-xl items-stretch gap-2 px-3">
                    <Link
                        href="/driver/parcels"
                        aria-label="Back to parcel deliveries"
                        className="pointer-events-auto grid w-11 shrink-0 place-items-center rounded-2xl bg-pd-surface shadow-pd"
                    >
                        <ArrowLeft size={20} />
                    </Link>

                    {!ended && (
                        <div className="pointer-events-auto flex min-h-12 min-w-0 flex-1 items-center gap-2.5 rounded-2xl bg-white px-3 py-1.5 text-[#111111] shadow-pd-lg dark:bg-[#20242C] dark:text-white">
                            <CornerUpRight size={20} className="shrink-0 text-pd-accent" />
                            <div className="min-w-0 flex-1">
                                <p className="truncate text-[13px] font-bold leading-tight">
                                    {routeInfo?.nextStep || `Head to ${targetLabel.toLowerCase()}`}
                                </p>
                                <p className="truncate text-[11px] font-semibold leading-tight opacity-65">
                                    {targetLabel} · {shortAddress(navigationTarget?.address, "Pinned location")}
                                </p>
                            </div>
                            {routeInfo && (
                                <div className="shrink-0 text-right leading-tight">
                                    <p className="text-sm font-extrabold">{routeInfo.durationMinutes} min</p>
                                    <p className="text-[11px] font-semibold opacity-65">{routeInfo.distanceKm} km</p>
                                </div>
                            )}
                        </div>
                    )}
                </div>
                {!gpsOk && !ended && (
                    <div className="mx-auto mt-2 flex max-w-xl px-3">
                        <span className="pointer-events-auto ml-[52px] inline-flex h-8 items-center gap-1.5 rounded-full bg-pd-warning-soft px-3 text-[11px] font-bold text-pd-warning shadow-pd backdrop-blur">
                            <Satellite size={13} /> {gpsMessage}
                        </span>
                    </div>
                )}
            </div>

            <BottomSheet
                snap={snap}
                onSnapChange={setSnap}
                label="Delivery details"
                peek={
                    loading && !order ? (
                        <div className="space-y-3 pb-1">
                            <div className="pd-skeleton h-5 w-1/2 rounded-full" />
                            <div className="pd-skeleton h-3 w-3/4 rounded-full" />
                            <div className="pd-skeleton h-12 w-full rounded-2xl" />
                        </div>
                    ) : !order ? (
                        <div className="space-y-3 pb-1">
                            <InlineError>{error || "Delivery not found."}</InlineError>
                            <Link href="/driver/parcels" className="flex min-h-12 items-center justify-center rounded-2xl bg-pd-surface-2 font-extrabold">Back to deliveries</Link>
                        </div>
                    ) : delivered ? (
                        <div className="space-y-3 pb-1 text-center">
                            <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-pd-success-soft text-pd-success">
                                <CheckCircle2 size={30} />
                            </span>
                            <div>
                                <h1 className="text-xl font-extrabold">Parcel delivered</h1>
                                <p className="mt-0.5 text-sm text-pd-muted">
                                    {order.receiver?.name ? `Handed to ${order.receiver.name}` : "Delivery completed"} · {serviceLabel(order.serviceType)}
                                </p>
                            </div>
                            <div className="flex items-center justify-between rounded-2xl bg-pd-surface-2 px-4 py-3 text-left">
                                <span className="text-sm text-pd-muted">Agreed fare</span>
                                <strong className="text-lg">{formatPKR(orderPrice(order))}</strong>
                            </div>
                            <Link href="/driver/parcels" className="flex min-h-12 items-center justify-center rounded-2xl bg-pd-accent font-extrabold text-pd-accent-ink">
                                Back to parcel requests
                            </Link>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <p className="text-xs font-semibold text-pd-muted">{STAGE_COPY[order.status] || order.status.replaceAll("_", " ")}</p>
                                    <h1 className="mt-0.5 truncate text-lg font-extrabold leading-snug">
                                        {contact?.name || targetLabel}
                                    </h1>
                                    <p className="truncate text-xs text-pd-muted">{shortAddress(navigationTarget?.address, targetLabel)}</p>
                                </div>
                                <div className="flex shrink-0 items-center gap-2">
                                    {contact?.phone && (
                                        <a
                                            href={`tel:${contact.phone}`}
                                            aria-label={`Call ${headingToPickup ? "sender" : "receiver"}`}
                                            className="grid h-11 w-11 place-items-center rounded-2xl bg-pd-surface-2"
                                        >
                                            <Phone size={18} />
                                        </a>
                                    )}
                                    <ParcelStatusBadge status={order.status} />
                                </div>
                            </div>

                            <InlineError onDismiss={() => setError("")}>{error}</InlineError>

                            {action && (
                                <div className="space-y-2">
                                    {needsOtp && (
                                        <label className="block">
                                            <span className="mb-1.5 flex items-center gap-1.5 text-xs font-bold text-pd-text-2">
                                                <KeyRound size={13} />
                                                {order.status === "ARRIVED_AT_PICKUP" ? "Pickup code from sender" : "Delivery code from receiver"}
                                            </span>
                                            <input
                                                type="text"
                                                inputMode="numeric"
                                                autoComplete="one-time-code"
                                                maxLength={6}
                                                value={otp}
                                                onChange={(e) =>
                                                    setOtp(e.target.value.replace(/\D/g, ""))
                                                }
                                                onKeyDown={(e) => { if (e.key === "Enter") updateStatus(); }}
                                                placeholder="••••••"
                                                aria-label="6-digit confirmation code"
                                                className="pd-input text-center font-mono text-2xl font-extrabold tracking-[0.5em]"
                                            />
                                        </label>
                                    )}

                                    <Button
                                        className="w-full"
                                        disabled={busy || (needsOtp && otp.length !== 6)}
                                        onClick={updateStatus}
                                    >
                                        {busy ? "Updating…" : action[1]}
                                    </Button>
                                </div>
                            )}

                            {ended && !delivered && (
                                <Link href="/driver/parcels" className="flex min-h-12 items-center justify-center rounded-2xl bg-pd-surface-2 font-extrabold">Back to deliveries</Link>
                            )}
                        </div>
                    )
                }
            >
                {order && (
                    <div className="space-y-5">
                        <section>
                            <h2 className="mb-2 text-sm font-extrabold">Route</h2>
                            <RouteSummary pickup={order.pickup} destination={order.destination} />
                        </section>

                        <section className="grid grid-cols-2 gap-2">
                            <Party label="Sender" person={order.sender} />
                            <Party label="Receiver" person={order.receiver} />
                            <div className="rounded-2xl bg-pd-surface-2 p-3">
                                <p className="text-[10px] font-bold uppercase tracking-wide text-pd-muted">Parcel</p>
                                <p className="mt-0.5 text-sm font-bold">{categoryLabel(order.parcel?.category)}</p>
                                <p className="text-xs text-pd-muted">{order.parcel?.weightKg} kg{order.parcel?.quantity ? ` · ×${order.parcel.quantity}` : ""}</p>
                            </div>
                            <div className="rounded-2xl bg-pd-surface-2 p-3">
                                <p className="text-[10px] font-bold uppercase tracking-wide text-pd-muted">Fare</p>
                                <p className="mt-0.5 text-sm font-bold">{formatPKR(orderPrice(order))}</p>
                                {order.paymentBy && <p className="text-xs text-pd-muted">{order.paymentBy === "RECEIVER" ? "Receiver pays" : "Sender pays"}</p>}
                            </div>
                        </section>

                        <section className="space-y-1.5 rounded-2xl bg-pd-surface-2 p-3 text-sm">
                            <p><span className="text-pd-muted">Contents: </span>{order.parcel?.description || "No description"}</p>
                            {order.instructions && <p><span className="text-pd-muted">Instructions: </span>{order.instructions}</p>}
                        </section>

                        <section>
                            <h2 className="mb-3 text-sm font-extrabold">Progress</h2>
                            <ParcelTimeline status={order.status} />
                        </section>

                        <p className="text-center text-[11px] text-pd-faint">{gpsMessage}</p>
                    </div>
                )}
            </BottomSheet>
        </main>
    );
}

function Party({ label, person }) {
    return (
        <div className="min-w-0 rounded-2xl bg-pd-surface-2 p-3">
            <p className="text-[10px] font-bold uppercase tracking-wide text-pd-muted">{label}</p>
            <p className="mt-0.5 truncate text-sm font-bold">{person?.name || "—"}</p>
            {person?.phone ? (
                <a href={`tel:${person.phone}`} className="flex min-h-6 items-center gap-1 truncate text-xs font-semibold text-pd-accent-text">
                    <Phone size={11} /> {person.phone}
                </a>
            ) : <p className="text-xs text-pd-muted">—</p>}
        </div>
    );
}
