"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { ArrowLeft, CheckCircle2, KeyRound, Phone, RefreshCw, Star, UserRound, XCircle } from "lucide-react";
import AuthGuard from "@/components/AuthGuard";
import { useAuth } from "@/context/AuthContext";
import { apiRequest } from "@/lib/api";
import { getRealtimeSocket } from "@/lib/socket";
import BottomSheet from "@/components/parcel/BottomSheet";
import {
    Button, InlineError, ParcelProgress, ParcelStatusBadge, ParcelTimeline, RouteSummary, Toast,
} from "@/components/parcel/ParcelKit";
import {
    VEHICLE_LABELS, categoryLabel, formatPKR, orderPrice, playNotificationSound, serviceLabel, statusMeta,
} from "@/components/parcel/parcelUi";

// One map everywhere: live tracking and the pre-assignment preview both
// render on the shared RideMap (same basemap, theming and markers as the
// ride screens). The old parcel-only ParcelTrackingMap was removed.
const RideMap = dynamic(() => import("@/components/RideMap"), { ssr: false });

const PICKUP_OTP_STATUSES = ["DRIVER_ASSIGNED", "DRIVER_EN_ROUTE", "ARRIVED_AT_PICKUP"];
const DELIVERY_OTP_STATUSES = ["PICKED_UP", "OUT_FOR_DELIVERY"];

export default function ParcelDetailsPage() {
    return (
        <AuthGuard role="PASSENGER">
            <ParcelDetails />
        </AuthGuard>
    );
}

function ParcelDetails() {
    const id = useSearchParams().get("parcelId");
    const { token } = useAuth();

    const [order, setOrder] = useState(null);
    const [offers, setOffers] = useState([]);
    const [otp, setOtp] = useState(null);
    const [driverLocation, setDriverLocation] = useState(null);
    const [driverSeenAt, setDriverSeenAt] = useState(0);
    const [snap, setSnap] = useState("peek");
    const [snapTouched, setSnapTouched] = useState(false);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [acceptingId, setAcceptingId] = useState("");
    const [error, setError] = useState("");
    const [notification, setNotification] = useState("");

    const refresh = useCallback(async () => {
        if (!token || !id) return;

        try {
            const result = await apiRequest(`/parcels/${id}`, { token });
            setOrder(result.order);

            if (result.order.status === "REQUESTED") {
                const offerResult = await apiRequest(
                    `/parcels/${id}/offers`,
                    { token }
                );
                setOffers(offerResult.offers || []);
            } else {
                setOffers([]);
            }

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

    useEffect(() => {
        if (!token || !id) return;

        let cancelled = false;

        async function loadTracking() {
            try {
                const data = await apiRequest(
                    `/parcels/${id}/tracking`,
                    { token }
                );

                // Keep the last known driver position on a stale or
                // failed poll: the tracking map must never blank out or
                // swap components because one refresh missed. Freshness
                // is surfaced via driverSeenAt (Live badge) instead.
                if (!cancelled && data.location) {
                    setDriverLocation(data.location);
                    setDriverSeenAt(Date.now());
                }
            } catch {
                // Keep the last known location; the next poll retries.
            }
        }

        loadTracking();

        const timer = setInterval(loadTracking, 5000);

        return () => {
            cancelled = true;
            clearInterval(timer);
        };
    }, [id, token]);

    useEffect(() => {
        if (!token || !id) return;

        let socket;
        let active = true;

        const handleStatus = (data) => {
            if (String(data?.parcelId) !== String(id)) return;

            setNotification(
                data.message || "Parcel delivery status updated"
            );
            playNotificationSound(0.5);
            refresh();
        };

        async function connect() {
            socket = await getRealtimeSocket(token);
            if (!active || !socket) return;

            socket.on("parcel:status:updated", handleStatus);
            socket.on("parcel:offer:new", handleStatus);
        }

        connect();

        return () => {
            active = false;
            socket?.off("parcel:status:updated", handleStatus);
            socket?.off("parcel:offer:new", handleStatus);
        };
    }, [id, token, refresh]);

    // Offers are the main content while waiting: open the sheet once.
    useEffect(() => {
        if (snapTouched || !order) return;
        setSnap(order.status === "REQUESTED" ? "half" : "peek");
    }, [order?.status, snapTouched]); // eslint-disable-line react-hooks/exhaustive-deps

    // A previously shown code is no longer valid once the stage changes.
    useEffect(() => {
        if (!otp || !order) return;
        if (otp.stage === "PICKUP" && !PICKUP_OTP_STATUSES.includes(order.status)) setOtp(null);
        if (otp.stage === "DELIVERY" && !DELIVERY_OTP_STATUSES.includes(order.status)) setOtp(null);
    }, [order, otp]);

    async function acceptOffer(offerId) {
        if (busy) return;
        setBusy(true);
        setAcceptingId(offerId);
        setError("");

        try {
            await apiRequest(
                `/parcels/${id}/offers/${offerId}/accept`,
                { method: "POST", token }
            );
            await refresh();
            setNotification("Driver confirmed. Track your parcel live on the map.");
            setSnap("peek");
        } catch (e) {
            setError(e.message);
        } finally {
            setBusy(false);
            setAcceptingId("");
        }
    }

    async function generateOtp(stage) {
        if (busy) return;
        setBusy(true);
        setError("");

        try {
            const result = await apiRequest(`/parcels/${id}/otp`, {
                method: "POST",
                token,
                body: JSON.stringify({ stage }),
            });

            setOtp({ stage, code: result.otp });
        } catch (e) {
            setError(e.message);
        } finally {
            setBusy(false);
        }
    }

    async function cancelOrder() {
        if (!window.confirm("Cancel this parcel request?")) return;

        setBusy(true);
        try {
            await apiRequest(`/parcels/${id}/cancel`, {
                method: "PATCH",
                token,
            });
            await refresh();
        } catch (e) {
            setError(e.message);
        } finally {
            setBusy(false);
        }
    }

    const sortedOffers = useMemo(
        () => [...offers].sort((a, b) => Number(a.price) - Number(b.price)),
        [offers]
    );

    const changeSnap = (value) => { setSnapTouched(true); setSnap(value); };

    if (!id) {
        return <CenteredMessage title="Parcel not found" body="This link is missing a parcel id." />;
    }

    if (loading && !order) {
        return (
            <main className="relative h-dvh overflow-hidden bg-pd-surface-3">
                <div className="absolute inset-x-0 bottom-0 mx-auto max-w-xl rounded-t-[28px] bg-pd-surface p-5 pd-safe-bottom">
                    <div className="pd-skeleton mx-auto mb-4 h-1.5 w-11 rounded-full" />
                    <div className="pd-skeleton h-5 w-1/2 rounded-full" />
                    <div className="pd-skeleton mt-3 h-2 w-full rounded-full" />
                    <div className="pd-skeleton mt-5 h-12 w-full rounded-2xl" />
                </div>
            </main>
        );
    }

    if (!order) {
        return <CenteredMessage title="Couldn't load delivery" body={error || "Please try again."} retry={refresh} />;
    }

    const meta = statusMeta(order.status);
    const delivered = order.status === "DELIVERED";
    const cancelled = ["CANCELLED", "FAILED"].includes(order.status);
    const otpStage = PICKUP_OTP_STATUSES.includes(order.status)
        ? "PICKUP"
        : DELIVERY_OTP_STATUSES.includes(order.status) ? "DELIVERY" : null;
    const showLiveDriver = Boolean(driverLocation) && !delivered && !cancelled;
    const driverFresh = driverSeenAt > 0 && Date.now() - driverSeenAt <= 30000;
    // The driver heads to the pickup until the parcel is collected, then
    // to the destination — same phase rule as ride tracking.
    const driverTarget = PICKUP_OTP_STATUSES.includes(order.status)
        ? order.pickup
        : order.destination;

    return (
        <main className="relative h-dvh overflow-hidden bg-pd-surface-3 text-pd-text">
            <Toast message={notification} onClose={() => setNotification("")} />

            {/* Map — always the shared RideMap; live mode only adds the
                driver marker, navigation framing and the phase target. */}
            <div className="absolute inset-0 z-0">
                <RideMap
                    passengerView={showLiveDriver}
                    userLocation={order.pickup}
                    driverLocation={showLiveDriver ? driverLocation : null}
                    vehicleType={order.vehicleType}
                    destination={showLiveDriver ? driverTarget : order.destination}
                    navigationMode={showLiveDriver}
                    followDriver={showLiveDriver}
                    showNavigationControl={false}
                    sheetRatio={snap === "peek" ? 0.3 : 0.55}
                />
            </div>

            {/* Compact top strip */}
            <div className="pointer-events-none absolute inset-x-0 top-0 z-20 pd-safe-top">
                <div className="mx-auto flex max-w-xl items-center gap-2 px-3">
                    <Link
                        href="/passenger/parcels"
                        aria-label="Back to my parcels"
                        className="pointer-events-auto grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-pd-surface shadow-pd"
                    >
                        <ArrowLeft size={20} />
                    </Link>
                    {showLiveDriver && (
                        <span className="pointer-events-auto ml-auto inline-flex h-9 items-center gap-2 rounded-full bg-pd-surface px-3 text-xs font-bold shadow-pd">
                            <span className={`h-2 w-2 rounded-full bg-pd-accent ${driverFresh ? "pd-live-dot" : "opacity-40"}`} /> {driverFresh ? "Live" : "Last known"}
                        </span>
                    )}
                </div>
            </div>

            <BottomSheet
                snap={snap}
                onSnapChange={changeSnap}
                label="Delivery details"
                peek={
                    <div className="space-y-3">
                        <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                                <p className="text-xs font-semibold text-pd-muted">
                                    {serviceLabel(order.serviceType)} · {formatPKR(orderPrice(order))}
                                </p>
                                <h1 className="mt-0.5 text-lg font-extrabold leading-snug tracking-tight">
                                    {delivered ? "Parcel delivered" : cancelled ? meta.label : meta.label}
                                </h1>
                            </div>
                            <ParcelStatusBadge status={order.status} />
                        </div>
                        {!cancelled && <ParcelProgress status={order.status} />}

                        <InlineError onDismiss={() => setError("")}>{error}</InlineError>

                        {delivered && (
                            <div className="flex items-center gap-3 rounded-2xl bg-pd-success-soft p-3 text-sm font-semibold text-pd-success">
                                <CheckCircle2 size={20} className="shrink-0" />
                                Delivered to {order.receiver?.name || "the receiver"}.
                            </div>
                        )}

                        {cancelled && (
                            <div className="flex items-center gap-3 rounded-2xl bg-pd-danger-soft p-3 text-sm font-semibold text-pd-danger">
                                <XCircle size={20} className="shrink-0" />
                                This delivery is no longer active.
                            </div>
                        )}

                        {order.status === "REQUESTED" && snap === "peek" && (
                            <Button className="w-full" onClick={() => changeSnap("half")}>
                                {offers.length > 0 ? `View ${offers.length} offer${offers.length > 1 ? "s" : ""}` : "Waiting for driver offers…"}
                            </Button>
                        )}

                        {otpStage && (
                            otp && otp.stage === otpStage ? (
                                <OtpCard otp={otp} />
                            ) : (
                                <Button className="w-full" disabled={busy} onClick={() => generateOtp(otpStage)}>
                                    <KeyRound size={18} />
                                    {busy ? "Generating…" : otpStage === "PICKUP" ? "Show pickup code" : "Show delivery code"}
                                </Button>
                            )
                        )}

                        {(delivered || cancelled) && (
                            <Link href="/passenger/parcels" className="flex min-h-12 w-full items-center justify-center rounded-2xl bg-pd-surface-2 font-extrabold">
                                Back to my parcels
                            </Link>
                        )}
                    </div>
                }
            >
                <div className="space-y-5">
                    {order.status === "REQUESTED" && (
                        <section aria-labelledby="offers-title">
                            <div className="mb-2 flex items-center justify-between">
                                <h2 id="offers-title" className="text-sm font-extrabold">Driver offers</h2>
                                <span className="text-xs text-pd-muted">Your offer {formatPKR(order.requestedPrice)}</span>
                            </div>
                            <div className="min-h-[96px] space-y-2.5">
                                {sortedOffers.length === 0 && (
                                    <div className="flex items-center gap-3 rounded-2xl bg-pd-surface-2 p-4">
                                        <span className="pd-live-dot h-2.5 w-2.5 shrink-0 rounded-full bg-pd-accent" />
                                        <p className="text-sm text-pd-text-2">Nearby drivers are reviewing your request. Offers appear here automatically.</p>
                                    </div>
                                )}
                                {sortedOffers.map((offer, index) => (
                                    <OfferCard
                                        key={offer._id}
                                        offer={offer}
                                        best={index === 0 && sortedOffers.length > 1}
                                        requested={order.requestedPrice}
                                        disabled={busy}
                                        accepting={acceptingId === offer._id}
                                        onAccept={() => acceptOffer(offer._id)}
                                    />
                                ))}
                            </div>
                            <button
                                type="button"
                                disabled={busy}
                                onClick={cancelOrder}
                                className="mt-3 min-h-11 w-full rounded-2xl text-sm font-bold text-pd-danger disabled:opacity-50"
                            >
                                Cancel request
                            </button>
                        </section>
                    )}

                    <section>
                        <h2 className="mb-2 text-sm font-extrabold">Route</h2>
                        <RouteSummary pickup={order.pickup} destination={order.destination} />
                    </section>

                    {!cancelled && (
                        <section>
                            <h2 className="mb-3 text-sm font-extrabold">Progress</h2>
                            <ParcelTimeline status={order.status} />
                        </section>
                    )}

                    <section className="grid grid-cols-2 gap-2">
                        <Info label="Sender" value={order.sender?.name} sub={order.sender?.phone} />
                        <Info label="Receiver" value={order.receiver?.name} sub={order.receiver?.phone} />
                        <Info label="Parcel" value={categoryLabel(order.parcel?.category)} sub={`${order.parcel?.weightKg ?? "—"} kg${order.parcel?.quantity ? ` · ×${order.parcel.quantity}` : ""}`} />
                        <Info label="Fare" value={formatPKR(orderPrice(order))} sub={order.paymentBy === "RECEIVER" ? "Receiver pays" : order.paymentBy === "SENDER" ? "Sender pays" : undefined} />
                    </section>

                    {(order.parcel?.description || order.instructions) && (
                        <section className="space-y-2 rounded-2xl bg-pd-surface-2 p-3 text-sm">
                            {order.parcel?.description && <p><span className="text-pd-muted">Contents: </span>{order.parcel.description}</p>}
                            {order.instructions && <p><span className="text-pd-muted">Instructions: </span>{order.instructions}</p>}
                        </section>
                    )}

                    {showLiveDriver && (
                        <p className="text-center text-[11px] text-pd-faint">Driver location refreshes about every 5 seconds.</p>
                    )}
                </div>
            </BottomSheet>
        </main>
    );
}

function OfferCard({ offer, best, requested, disabled, accepting, onAccept }) {
    // Driver/vehicle fields are shown only when the API includes them.
    const driver = offer.driver || offer.driverId || {};
    const driverName = typeof driver === "object" ? (driver.name || driver.fullName) : null;
    const rating = typeof driver === "object" ? (driver.rating ?? driver.averageRating) : null;
    const vehicle = offer.vehicle || (typeof driver === "object" ? driver.vehicle : null);
    const vehicleText = vehicle && typeof vehicle === "object"
        ? [vehicle.make, vehicle.model, vehicle.color].filter(Boolean).join(" ") || VEHICLE_LABELS[vehicle.type]
        : null;
    const diff = Number(offer.price) - Number(requested);

    return (
        <article className={`pd-rise flex items-center gap-3 rounded-2xl border p-3 ${best ? "border-pd-accent bg-pd-accent-soft" : "border-pd-line bg-pd-surface"}`}>
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-pd-surface-3 text-pd-muted">
                <UserRound size={20} />
            </span>
            <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold">{driverName || "Driver offer"}</p>
                <p className="flex items-center gap-1.5 truncate text-xs text-pd-muted">
                    {Number.isFinite(Number(rating)) && rating !== null && (
                        <span className="inline-flex items-center gap-0.5"><Star size={11} className="fill-current" /> {Number(rating).toFixed(1)}</span>
                    )}
                    {vehicleText && <span className="truncate">{vehicleText}</span>}
                    {!vehicleText && !rating && (best ? "Lowest offer" : Number.isFinite(diff) && diff !== 0 ? `${diff > 0 ? "+" : "−"}${formatPKR(Math.abs(diff)).replace("PKR ", "PKR ")} vs yours` : "Matches your offer")}
                </p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1.5">
                <strong className="text-base">{formatPKR(offer.price)}</strong>
                <button
                    type="button"
                    disabled={disabled}
                    onClick={onAccept}
                    className="min-h-10 rounded-xl bg-pd-ink px-4 text-sm font-extrabold text-pd-ink-text disabled:opacity-45"
                >
                    {accepting ? "Accepting…" : "Accept"}
                </button>
            </div>
        </article>
    );
}

function OtpCard({ otp }) {
    return (
        <div className="rounded-2xl border-2 border-pd-accent bg-pd-accent-soft p-4 text-center">
            <p className="text-[11px] font-bold uppercase tracking-wider text-pd-accent-text">
                {otp.stage === "PICKUP" ? "Pickup" : "Delivery"} code
            </p>
            <p className="mt-1 font-mono text-[34px] font-extrabold leading-none tracking-[0.3em] text-pd-text" aria-live="polite">
                {otp.code}
            </p>
            <p className="mt-2 text-xs text-pd-muted">
                {otp.stage === "PICKUP"
                    ? "Share only when handing the parcel to the driver."
                    : "Share with the receiver; give it to the driver only on delivery."}
            </p>
        </div>
    );
}

function Info({ label, value, sub }) {
    return (
        <div className="min-w-0 rounded-2xl bg-pd-surface-2 p-3">
            <p className="text-[10px] font-bold uppercase tracking-wide text-pd-muted">{label}</p>
            <p className="mt-0.5 truncate text-sm font-bold">{value || "—"}</p>
            {sub && (
                <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-pd-muted">
                    {/^[+\d][\d\s-]{6,}$/.test(String(sub)) && <Phone size={11} />} {sub}
                </p>
            )}
        </div>
    );
}

function CenteredMessage({ title, body, retry }) {
    return (
        <main className="grid min-h-dvh place-items-center bg-pd-bg px-6 text-center text-pd-text">
            <div>
                <h1 className="text-lg font-extrabold">{title}</h1>
                <p className="mt-1 text-sm text-pd-muted">{body}</p>
                <div className="mt-5 flex justify-center gap-2">
                    {retry && <Button variant="ink" onClick={retry}><RefreshCw size={16} /> Retry</Button>}
                    <Link href="/passenger/parcels" className="inline-flex min-h-12 items-center rounded-2xl bg-pd-surface-2 px-4 font-extrabold">My parcels</Link>
                </div>
            </div>
        </main>
    );
}
