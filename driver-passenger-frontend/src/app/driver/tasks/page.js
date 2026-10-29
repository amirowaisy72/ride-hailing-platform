"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
    ArrowLeft,
    CalendarClock,
    CarFront,
    CheckCircle2,
    ChevronRight,
    CircleAlert,
    ClipboardList,
    KeyRound,
    MapPin,
    Package,
    RefreshCw,
    Send,
    ShoppingBag,
    Undo2,
    Wallet,
    XCircle,
} from "lucide-react";

import AuthGuard from "@/components/AuthGuard";
import MobileBottomNav from "@/components/MobileBottomNav";
import { useAuth } from "@/context/AuthContext";
import { getRealtimeSocket } from "@/lib/socket";
import {
    getAvailablePurchaseRequests,
    getDriverPurchaseTasks,
    submitPurchaseOffer,
    withdrawPurchaseOffer,
} from "@/lib/purchaseService";
import {
    acceptRentalBooking,
    getPartnerRentalBookings,
    rejectRentalBooking,
} from "@/lib/rentalService";

// Unified Active Tasks — one queue for everything the partner is
// working on: new Buy & Deliver requests to bid on, live shopping
// tasks, rental bookings waiting on a partner action, and shortcuts
// into the existing ride / parcel work queues.

const money = (value) =>
    value == null ? "—" : `PKR ${Number(value).toLocaleString("en-PK")}`;

const fmtDateTime = (value) =>
    value
        ? new Date(value).toLocaleString("en-PK", {
              day: "numeric",
              month: "short",
              hour: "numeric",
              minute: "2-digit",
          })
        : "—";

const FILTERS = [
    { key: "ALL", label: "All" },
    { key: "RIDE", label: "Ride" },
    { key: "PARCEL", label: "Parcel" },
    { key: "BUY_DELIVER", label: "Buy & Deliver" },
    { key: "RENTAL", label: "Rentals" },
];

const PURCHASE_STATUS_LABEL = {
    DRIVER_SELECTED: "Ready to shop",
    SHOPPING: "Shopping",
    AWAITING_APPROVAL: "Awaiting cost approval",
    PURCHASE_APPROVED: "Approved — buy now",
    PURCHASED: "Purchased",
    OUT_FOR_DELIVERY: "Out for delivery",
    ARRIVED: "Arrived at customer",
    DELIVERED: "Delivered — payment pending",
    DISPUTED: "In dispute",
};

const RENTAL_ACTION = {
    REQUESTED: "New request — accept or reject",
    PROVIDER_ACCEPTED: "Accepted — awaiting fee payment",
    PAYMENT_PENDING: "Fee payment in progress",
    CONFIRMED: "Verify pickup",
    PICKUP_VERIFIED: "Start the rental",
    RENTAL_ACTIVE: "Record return",
    RETURN_PENDING: "Awaiting passenger confirmation",
};

const RENTAL_TERMINAL = ["COMPLETED", "CANCELLED", "NO_SHOW", "DISPUTED"];

export default function DriverTasksPage() {
    return (
        <AuthGuard role="DRIVER">
            <TasksScreen />
        </AuthGuard>
    );
}

function TasksScreen() {
    const { token } = useAuth();
    const [filter, setFilter] = useState("ALL");
    const [requests, setRequests] = useState([]);
    const [purchaseTasks, setPurchaseTasks] = useState([]);
    const [rentalBookings, setRentalBookings] = useState([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState(null);
    const [fees, setFees] = useState({});
    const [myOffers, setMyOffers] = useState({});
    const [busyId, setBusyId] = useState("");
    const [rejectingId, setRejectingId] = useState("");
    const [rejectReason, setRejectReason] = useState("");
    const loadRef = useRef(null);

    const load = useCallback(
        async (initial = false) => {
            if (!token) return;
            if (initial) setLoading(true);
            else setRefreshing(true);
            try {
                const [feed, tasks, rentals] = await Promise.allSettled([
                    getAvailablePurchaseRequests(token),
                    getDriverPurchaseTasks(token),
                    getPartnerRentalBookings(token),
                ]);
                if (feed.status === "fulfilled") {
                    const feedOrders =
                        feed.value.orders || feed.value.requests || [];
                    setRequests(feedOrders);
                    // The API embeds the driver's own live offer
                    // (myOffer) on each request — hydrate from it so
                    // the withdraw state survives an app restart
                    // instead of living only in this session's memory.
                    const persisted = {};
                    for (const order of feedOrders) {
                        if (order.myOffer) {
                            persisted[order._id] = order.myOffer;
                        }
                    }
                    if (Object.keys(persisted).length) {
                        setMyOffers((prev) => ({ ...prev, ...persisted }));
                    }
                }
                if (tasks.status === "fulfilled") {
                    setPurchaseTasks(tasks.value.orders || []);
                }
                if (rentals.status === "fulfilled") {
                    setRentalBookings(
                        (rentals.value.bookings || []).filter(
                            (b) => !RENTAL_TERMINAL.includes(b.status)
                        )
                    );
                }
                const failed = [feed, tasks, rentals].find(
                    (r) => r.status === "rejected"
                );
                setError(failed ? failed.reason?.message || "" : "");
            } finally {
                setLoading(false);
                setRefreshing(false);
            }
        },
        [token]
    );

    useEffect(() => {
        loadRef.current = load;
    }, [load]);

    useEffect(() => {
        if (!token) return;
        void (async () => {
            await Promise.resolve();
            await load(true);
        })();
        const poll = setInterval(() => void loadRef.current?.(), 20000);
        const socket = getRealtimeSocket();
        const refresh = () => void loadRef.current?.();
        socket?.on("purchase:request:new", refresh);
        socket?.on("purchase:status:updated", refresh);
        socket?.on("rental:booking:updated", refresh);
        return () => {
            clearInterval(poll);
            socket?.off("purchase:request:new", refresh);
            socket?.off("purchase:status:updated", refresh);
            socket?.off("rental:booking:updated", refresh);
        };
    }, [token, load]);

    async function sendOffer(order) {
        const fee = Number(fees[order._id]);
        if (!Number.isSafeInteger(fee) || fee < 1) {
            setNotice({
                kind: "error",
                text: "Enter your delivery fee in whole PKR first.",
            });
            return;
        }
        setBusyId(order._id);
        setNotice(null);
        try {
            const data = await submitPurchaseOffer(order._id, fee, token);
            setMyOffers((prev) => ({
                ...prev,
                [order._id]: data.offer || { deliveryFee: fee },
            }));
            setNotice({
                kind: "success",
                text: "Offer sent — the customer picks the partner.",
            });
        } catch (err) {
            setNotice({ kind: "error", text: err.message });
        } finally {
            setBusyId("");
        }
    }

    async function withdraw(order) {
        setBusyId(order._id);
        setNotice(null);
        try {
            await withdrawPurchaseOffer(order._id, token);
            setMyOffers((prev) => {
                const next = { ...prev };
                delete next[order._id];
                return next;
            });
            setNotice({ kind: "success", text: "Offer withdrawn." });
        } catch (err) {
            setNotice({ kind: "error", text: err.message });
        } finally {
            setBusyId("");
        }
    }

    async function rentalAction(booking, action) {
        if (action === "reject" && !rejectReason.trim()) {
            setNotice({
                kind: "error",
                text: "Add a short reason for rejecting this booking.",
            });
            return;
        }
        setBusyId(booking._id);
        setNotice(null);
        try {
            if (action === "accept") {
                await acceptRentalBooking(booking._id, token);
            } else {
                await rejectRentalBooking(booking._id, rejectReason.trim(), token);
            }
            setRejectingId("");
            setRejectReason("");
            setNotice({
                kind: "success",
                text:
                    action === "accept"
                        ? "Booking accepted — the customer now pays the booking fee."
                        : "Booking rejected.",
            });
            void load();
        } catch (err) {
            setNotice({ kind: "error", text: err.message });
        } finally {
            setBusyId("");
        }
    }

    const showFeed = filter === "ALL" || filter === "BUY_DELIVER";
    const showPurchases = showFeed;
    const showRentals = filter === "ALL" || filter === "RENTAL";
    const showLinks =
        filter === "ALL" || filter === "RIDE" || filter === "PARCEL";

    return (
        <main className="driver-subpage min-h-dvh bg-[#F7F9F8] pb-28 text-slate-900">
            <MobileBottomNav role="DRIVER" />

            <header className="bg-[#087F5B] px-5 pb-8 pt-[max(24px,env(safe-area-inset-top))] text-white">
                <div className="mx-auto max-w-xl">
                    <div className="flex items-center justify-between">
                        <Link
                            href="/driver"
                            className="inline-flex items-center gap-2 text-sm font-semibold"
                        >
                            <ArrowLeft size={19} /> Dashboard
                        </Link>
                        <button
                            type="button"
                            onClick={() => void load()}
                            disabled={refreshing || loading}
                            aria-label="Refresh tasks"
                            className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/15 disabled:opacity-50"
                        >
                            <RefreshCw
                                size={18}
                                className={refreshing ? "animate-spin" : ""}
                            />
                        </button>
                    </div>
                    <h1 className="mt-6 flex items-center gap-3 text-3xl font-extrabold">
                        <ClipboardList size={30} /> Active Tasks
                    </h1>
                    <p className="mt-2 text-sm text-white/75">
                        Every job that needs you — shopping, rentals, rides and
                        parcels — in one queue.
                    </p>
                </div>
            </header>

            <div className="relative z-10 mx-auto mt-4 max-w-xl space-y-5 px-4 pb-6">
                <div className="flex gap-2 overflow-x-auto pb-1">
                    {FILTERS.map((item) => (
                        <button
                            key={item.key}
                            type="button"
                            onClick={() => setFilter(item.key)}
                            className={`shrink-0 rounded-full px-4 py-2 text-xs font-extrabold shadow-sm ${
                                filter === item.key
                                    ? "bg-[#087F5B] text-white"
                                    : "bg-white text-slate-600"
                            }`}
                        >
                            {item.label}
                        </button>
                    ))}
                </div>

                {notice && (
                    <p
                        role={notice.kind === "error" ? "alert" : "status"}
                        className={`rounded-xl p-4 text-sm font-semibold ${
                            notice.kind === "error"
                                ? "bg-red-50 text-red-600"
                                : "bg-emerald-50 text-[#087F5B]"
                        }`}
                    >
                        {notice.text}
                    </p>
                )}
                {error && !notice && (
                    <p
                        role="alert"
                        className="flex items-start gap-2 rounded-xl bg-red-50 p-4 text-sm font-semibold text-red-600"
                    >
                        <CircleAlert size={17} className="mt-0.5 shrink-0" />
                        Some task lists could not refresh: {error}
                    </p>
                )}

                {loading ? (
                    <div
                        className="h-64 animate-pulse rounded-[24px] bg-white shadow-sm"
                        aria-busy="true"
                    />
                ) : (
                    <>
                        {showLinks && (
                            <section className="grid grid-cols-2 gap-3">
                                {(filter === "ALL" || filter === "RIDE") && (
                                    <Link
                                        href="/driver/trips"
                                        className="flex items-center gap-3 rounded-[24px] bg-white p-4 shadow-sm"
                                    >
                                        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-50 text-[#087F5B]">
                                            <CarFront size={22} />
                                        </span>
                                        <span className="min-w-0 flex-1">
                                            <span className="block text-sm font-extrabold">
                                                Rides
                                            </span>
                                            <span className="block text-xs text-slate-500">
                                                Live trip & history
                                            </span>
                                        </span>
                                        <ChevronRight
                                            size={16}
                                            className="text-slate-400"
                                        />
                                    </Link>
                                )}
                                {(filter === "ALL" || filter === "PARCEL") && (
                                    <Link
                                        href="/driver/parcels"
                                        className="flex items-center gap-3 rounded-[24px] bg-white p-4 shadow-sm"
                                    >
                                        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
                                            <Package size={22} />
                                        </span>
                                        <span className="min-w-0 flex-1">
                                            <span className="block text-sm font-extrabold">
                                                Parcels
                                            </span>
                                            <span className="block text-xs text-slate-500">
                                                Offers & deliveries
                                            </span>
                                        </span>
                                        <ChevronRight
                                            size={16}
                                            className="text-slate-400"
                                        />
                                    </Link>
                                )}
                            </section>
                        )}

                        {showFeed && (
                            <section>
                                <h2 className="flex items-center gap-2 px-1 text-xs font-extrabold uppercase tracking-wider text-slate-500">
                                    <ShoppingBag size={14} />
                                    New Buy &amp; Deliver requests
                                    <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-extrabold text-violet-700">
                                        {requests.length}
                                    </span>
                                </h2>
                                <div className="mt-2 space-y-3">
                                    {requests.length === 0 ? (
                                        <div className="rounded-[24px] bg-white p-6 text-center shadow-sm">
                                            <ShoppingBag
                                                size={30}
                                                className="mx-auto text-violet-400"
                                            />
                                            <p className="mt-2 text-sm font-bold">
                                                No open shopping requests
                                            </p>
                                            <p className="mt-1 text-xs text-slate-500">
                                                New requests near you appear here
                                                automatically — stay online to
                                                receive them.
                                            </p>
                                        </div>
                                    ) : (
                                        requests.map((order) => {
                                            const mine = myOffers[order._id];
                                            return (
                                                <article
                                                    key={order._id}
                                                    className="rounded-[24px] border-t-4 border-violet-400 bg-white p-5 shadow-sm"
                                                >
                                                    <div className="flex items-start justify-between gap-3">
                                                        <span className="inline-flex items-center gap-1.5 rounded-full bg-violet-50 px-2.5 py-1 text-[11px] font-extrabold text-violet-700">
                                                            <ShoppingBag size={12} />
                                                            BUY &amp; DELIVER
                                                        </span>
                                                        <span className="text-[11px] font-semibold text-slate-400">
                                                            {fmtDateTime(order.createdAt)}
                                                        </span>
                                                    </div>
                                                    <p className="mt-3 line-clamp-3 whitespace-pre-line text-sm font-semibold leading-6">
                                                        {order.itemsText}
                                                    </p>
                                                    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs font-semibold text-slate-500">
                                                        <span className="inline-flex items-center gap-1">
                                                            <Wallet size={13} />
                                                            Budget up to{" "}
                                                            {money(order.estimatedBudget)}
                                                        </span>
                                                        <span className="inline-flex items-center gap-1">
                                                            <MapPin size={13} />
                                                            {order.deliveryLabel ||
                                                                order.deliveryAddress?.address ||
                                                                "Delivery area"}
                                                        </span>
                                                        {order.preferences?.preferredShop && (
                                                            <span>
                                                                Shop:{" "}
                                                                {order.preferences.preferredShop}
                                                            </span>
                                                        )}
                                                    </div>
                                                    {(order.imageUrls || []).length > 0 && (
                                                        <div className="mt-3 flex gap-2 overflow-x-auto">
                                                            {order.imageUrls.map((url) => (
                                                                // eslint-disable-next-line @next/next/no-img-element
                                                                <img
                                                                    key={url}
                                                                    src={url}
                                                                    alt="Item reference"
                                                                    className="h-14 w-14 shrink-0 rounded-xl object-cover"
                                                                />
                                                            ))}
                                                        </div>
                                                    )}
                                                    {mine ? (
                                                        <div className="mt-4 flex items-center gap-2">
                                                            <p className="flex flex-1 items-center gap-1.5 rounded-xl bg-violet-50 px-3 py-2.5 text-sm font-bold text-violet-700">
                                                                <CheckCircle2 size={16} />
                                                                Your offer:{" "}
                                                                {money(mine.deliveryFee)}
                                                            </p>
                                                            <button
                                                                type="button"
                                                                disabled={busyId === order._id}
                                                                onClick={() => void withdraw(order)}
                                                                className="inline-flex h-11 items-center gap-1.5 rounded-xl bg-slate-100 px-3 text-sm font-bold text-slate-600 disabled:opacity-40"
                                                            >
                                                                <Undo2 size={15} />
                                                                Withdraw
                                                            </button>
                                                        </div>
                                                    ) : (
                                                        <div className="mt-4 flex gap-2">
                                                            <label className="relative flex-1">
                                                                <span className="sr-only">
                                                                    Your delivery fee (PKR)
                                                                </span>
                                                                <input
                                                                    type="number"
                                                                    min="1"
                                                                    step="1"
                                                                    inputMode="numeric"
                                                                    placeholder="Your delivery fee (PKR)"
                                                                    value={fees[order._id] || ""}
                                                                    onChange={(e) =>
                                                                        setFees((prev) => ({
                                                                            ...prev,
                                                                            [order._id]: e.target.value,
                                                                        }))
                                                                    }
                                                                    className="h-12 w-full rounded-xl border px-4 text-sm font-semibold"
                                                                />
                                                            </label>
                                                            <button
                                                                type="button"
                                                                disabled={busyId === order._id}
                                                                onClick={() => void sendOffer(order)}
                                                                className="inline-flex h-12 items-center gap-1.5 rounded-xl bg-violet-600 px-4 text-sm font-bold text-white disabled:opacity-40"
                                                            >
                                                                <Send size={15} />
                                                                {busyId === order._id
                                                                    ? "Sending…"
                                                                    : "Send offer"}
                                                            </button>
                                                        </div>
                                                    )}
                                                </article>
                                            );
                                        })
                                    )}
                                </div>
                            </section>
                        )}

                        {showPurchases && purchaseTasks.length > 0 && (
                            <section>
                                <h2 className="flex items-center gap-2 px-1 text-xs font-extrabold uppercase tracking-wider text-slate-500">
                                    <ClipboardList size={14} /> My shopping tasks
                                </h2>
                                <div className="mt-2 space-y-3">
                                    {purchaseTasks.map((order) => (
                                        <Link
                                            key={order._id}
                                            href={`/driver/buy-deliver/details?id=${order._id}`}
                                            className="block rounded-[24px] border-l-4 border-violet-500 bg-white p-5 shadow-sm"
                                        >
                                            <div className="flex items-center gap-2">
                                                <span className="inline-flex items-center gap-1.5 rounded-full bg-violet-600 px-2.5 py-1 text-[11px] font-extrabold text-white">
                                                    <ShoppingBag size={12} />
                                                    PURCHASE
                                                </span>
                                                <span className="rounded-full bg-violet-50 px-2.5 py-1 text-[11px] font-extrabold text-violet-700">
                                                    {PURCHASE_STATUS_LABEL[order.status] ||
                                                        order.status}
                                                </span>
                                                <ChevronRight
                                                    size={16}
                                                    className="ml-auto text-slate-400"
                                                />
                                            </div>
                                            <p className="mt-2.5 line-clamp-2 whitespace-pre-line text-sm font-semibold leading-6">
                                                {order.itemsText}
                                            </p>
                                            <p className="mt-2 flex items-center gap-1 text-xs font-semibold text-slate-500">
                                                <MapPin size={13} />
                                                {order.deliveryLabel ||
                                                    order.deliveryAddress?.address ||
                                                    "Delivery address"}
                                                <span className="ml-auto font-extrabold text-[#087F5B]">
                                                    Fee {money(order.deliveryFee)}
                                                </span>
                                            </p>
                                        </Link>
                                    ))}
                                </div>
                            </section>
                        )}

                        {showRentals && rentalBookings.length > 0 && (
                            <section>
                                <h2 className="flex items-center gap-2 px-1 text-xs font-extrabold uppercase tracking-wider text-slate-500">
                                    <KeyRound size={14} /> Rental bookings needing you
                                </h2>
                                <div className="mt-2 space-y-3">
                                    {rentalBookings.map((booking) => (
                                        <article
                                            key={booking._id}
                                            className="rounded-[24px] border-l-4 border-[#087F5B] bg-white p-5 shadow-sm"
                                        >
                                            <div className="flex items-center gap-2">
                                                <span className="inline-flex items-center gap-1.5 rounded-full bg-[#087F5B] px-2.5 py-1 text-[11px] font-extrabold text-white">
                                                    <KeyRound size={12} />
                                                    RENTAL
                                                </span>
                                                <span className="text-xs font-extrabold text-slate-600">
                                                    {booking.bookingRef}
                                                </span>
                                                <span className="ml-auto text-[11px] font-bold text-slate-400">
                                                    {booking.mode === "WITH_DRIVER"
                                                        ? "With Driver"
                                                        : "Self-Drive"}
                                                </span>
                                            </div>
                                            <p className="mt-2.5 text-sm font-extrabold">
                                                {booking.vehicle
                                                    ? `${booking.vehicle.brand} ${booking.vehicle.model} (${booking.vehicle.year})`
                                                    : "Vehicle"}
                                            </p>
                                            <p className="mt-1 flex items-center gap-1 text-xs font-semibold text-slate-500">
                                                <CalendarClock size={13} />
                                                {fmtDateTime(booking.startAt)} →{" "}
                                                {fmtDateTime(booking.endAt)}
                                            </p>
                                            <p className="mt-1 text-xs font-semibold text-slate-500">
                                                {RENTAL_ACTION[booking.status] ||
                                                    booking.status}{" "}
                                                · Charges {money(booking.rentalCharges)}
                                            </p>

                                            {booking.status === "REQUESTED" && (
                                                <div className="mt-3 space-y-2">
                                                    {rejectingId === booking._id ? (
                                                        <>
                                                            <input
                                                                type="text"
                                                                value={rejectReason}
                                                                onChange={(e) =>
                                                                    setRejectReason(e.target.value)
                                                                }
                                                                placeholder="Reason for rejecting"
                                                                className="h-11 w-full rounded-xl border px-3 text-sm font-semibold"
                                                            />
                                                            <div className="flex gap-2">
                                                                <button
                                                                    type="button"
                                                                    disabled={busyId === booking._id}
                                                                    onClick={() =>
                                                                        void rentalAction(booking, "reject")
                                                                    }
                                                                    className="flex h-11 flex-1 items-center justify-center gap-1.5 rounded-xl bg-red-500 text-sm font-bold text-white disabled:opacity-40"
                                                                >
                                                                    <XCircle size={15} />
                                                                    Confirm reject
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => setRejectingId("")}
                                                                    className="h-11 rounded-xl bg-slate-100 px-4 text-sm font-bold text-slate-600"
                                                                >
                                                                    Back
                                                                </button>
                                                            </div>
                                                        </>
                                                    ) : (
                                                        <div className="flex gap-2">
                                                            <button
                                                                type="button"
                                                                disabled={busyId === booking._id}
                                                                onClick={() =>
                                                                    void rentalAction(booking, "accept")
                                                                }
                                                                className="flex h-11 flex-1 items-center justify-center gap-1.5 rounded-xl bg-[#087F5B] text-sm font-bold text-white disabled:opacity-40"
                                                            >
                                                                <CheckCircle2 size={15} />
                                                                Accept
                                                            </button>
                                                            <button
                                                                type="button"
                                                                disabled={busyId === booking._id}
                                                                onClick={() => setRejectingId(booking._id)}
                                                                className="flex h-11 flex-1 items-center justify-center gap-1.5 rounded-xl bg-red-50 text-sm font-bold text-red-600 disabled:opacity-40"
                                                            >
                                                                <XCircle size={15} />
                                                                Reject
                                                            </button>
                                                        </div>
                                                    )}
                                                </div>
                                            )}

                                            <Link
                                                href={`/driver/rentals/bookings/details?id=${booking._id}`}
                                                className="mt-3 inline-flex items-center gap-1 text-sm font-extrabold text-[#087F5B]"
                                            >
                                                Open booking <ChevronRight size={15} />
                                            </Link>
                                        </article>
                                    ))}
                                </div>
                            </section>
                        )}

                        {!loading &&
                            requests.length === 0 &&
                            purchaseTasks.length === 0 &&
                            rentalBookings.length === 0 && (
                                <div className="rounded-[24px] bg-white p-6 text-center shadow-sm">
                                    <CheckCircle2
                                        size={30}
                                        className="mx-auto text-[#087F5B]"
                                    />
                                    <p className="mt-2 text-sm font-bold">
                                        All caught up
                                    </p>
                                    <p className="mt-1 text-xs text-slate-500">
                                        Nothing is waiting on you right now.
                                    </p>
                                </div>
                            )}
                    </>
                )}
            </div>
        </main>
    );
}
