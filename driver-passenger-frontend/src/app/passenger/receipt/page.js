"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import {
    ArrowLeft, CheckCircle2, CarFront,
    Clock3, MapPin, Navigation, ReceiptText,
    Star, Wallet,
} from "lucide-react";

import AuthGuard from "@/components/AuthGuard";
import { useAuth } from "@/context/AuthContext";
import { apiRequest } from "@/lib/api";

const formatMoney = (value) =>
    Number.isFinite(Number(value))
        ? `PKR ${Number(value).toLocaleString("en-PK")}`
        : "—";

const formatDate = (value) =>
    value
        ? new Date(value).toLocaleString("en-PK", {
            dateStyle: "medium",
            timeStyle: "short",
        })
        : "—";

function displayLocation(point) {
    if (!point) return "Location unavailable";

    if (typeof point.address === "string" && point.address.trim()) {
        return point.address;
    }

    const coordinates = point.coordinates;

    if (Array.isArray(coordinates) && coordinates.length === 2) {
        return `${Number(coordinates[1]).toFixed(5)}, ${Number(coordinates[0]).toFixed(5)}`;
    }

    return "Location unavailable";
}

function DetailRow({ label, value }) {
    return (
        <div className="flex items-start justify-between gap-4 border-b border-pd-line py-3 last:border-0">
            <span className="text-sm text-pd-muted">{label}</span>
            <span className="text-right text-sm font-semibold text-pd-text">
                {value ?? "—"}
            </span>
        </div>
    );
}

export default function ReceiptPage() {
    return (
        <AuthGuard role="PASSENGER">
            <ReceiptScreen />
        </AuthGuard>
    );
}

function ReceiptScreen() {
    const { token } = useAuth();
    const searchParams = useSearchParams();
    const rideId = searchParams.get("rideId");

    const [receipt, setReceipt] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    useEffect(() => {
        if (!token) return;

        if (!rideId) {
            setLoading(false);
            setError("No ride selected.");
            return;
        }

        let cancelled = false;

        setLoading(true);
        setError("");

        apiRequest(`/rides/${encodeURIComponent(rideId)}/receipt`, {
            token,
        })
            .then((data) => {
                if (!cancelled) setReceipt(data.receipt);
            })
            .catch((err) => {
                if (!cancelled) setError(err.message);
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [rideId, token]);

    return (
        <main className="min-h-dvh bg-pd-bg pb-10 text-pd-text">
            <header className="bg-[#087F5B] px-5 pb-24 pt-[max(24px,env(safe-area-inset-top))] text-white">
                <div className="mx-auto flex max-w-xl items-center gap-4">
                    <Link
                        href="/passenger/account"
                        aria-label="Back to account"
                        className="rounded-xl bg-white/15 p-3"
                    >
                        <ArrowLeft size={20} />
                    </Link>
                    <h1 className="text-lg font-bold">Trip Receipt</h1>
                </div>

                <div className="mx-auto mt-8 max-w-xl">
                    <p className="text-sm text-white/75">
                        Your journey details
                    </p>
                    <h2 className="mt-1 text-3xl font-extrabold">
                        Ride Summary
                    </h2>
                </div>
            </header>

            <div className="mx-auto -mt-16 max-w-xl space-y-5 px-4">
                {loading && (
                    <div className="rounded-3xl bg-pd-surface p-8 text-center shadow-sm">
                        <p className="text-sm text-pd-muted">
                            Loading your receipt...
                        </p>
                    </div>
                )}

                {error && (
                    <div role="alert" className="rounded-3xl bg-pd-surface p-6 shadow-sm">
                        <p className="font-semibold text-pd-danger">{error}</p>
                        <Link
                            href="/passenger/account"
                            className="mt-4 inline-block text-sm font-bold text-[#087F5B]"
                        >
                            Return to ride history
                        </Link>
                    </div>
                )}

                {!loading && !error && receipt && (
                    <>
                        <section className="rounded-[28px] bg-pd-surface p-6 text-center shadow-lg shadow-slate-900/5">
                            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-pd-success-soft text-[#087F5B]">
                                <CheckCircle2 size={34} />
                            </div>

                            <p className="mt-4 text-sm font-semibold text-[#087F5B]">
                                Trip Completed
                            </p>

                            <p className="mt-2 text-4xl font-extrabold">
                                {formatMoney(receipt.finalPrice)}
                            </p>

                            <div className="mt-4 flex items-center justify-center gap-2 text-sm text-pd-muted">
                                <Wallet size={16} />
                                Cash payment
                            </div>

                            <p className="mt-4 break-all text-xs text-pd-faint">
                                Ride ID: {receipt.rideId}
                            </p>
                        </section>

                        <section className="rounded-3xl bg-pd-surface p-5 shadow-sm">
                            <h3 className="mb-5 flex items-center gap-2 text-lg font-extrabold">
                                <Navigation size={20} className="text-[#087F5B]" />
                                Journey
                            </h3>

                            <div className="flex gap-4">
                                <div className="flex flex-col items-center">
                                    <span className="h-3 w-3 rounded-full bg-[#087F5B]" />
                                    <div className="my-2 min-h-12 w-0.5 flex-1 bg-pd-surface-3" />
                                    <MapPin size={19} className="text-pd-danger" />
                                </div>

                                <div className="min-w-0 flex-1 space-y-6">
                                    <div>
                                        <p className="text-xs font-semibold text-pd-muted">
                                            Pickup
                                        </p>
                                        <p className="mt-1 break-words text-sm font-medium">
                                            {displayLocation(receipt.pickup)}
                                        </p>
                                    </div>

                                    <div>
                                        <p className="text-xs font-semibold text-pd-muted">
                                            Destination
                                        </p>
                                        <p className="mt-1 break-words text-sm font-medium">
                                            {displayLocation(receipt.destination)}
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </section>

                        <section className="rounded-3xl bg-pd-surface p-5 shadow-sm">
                            <h3 className="mb-3 flex items-center gap-2 text-lg font-extrabold">
                                <ReceiptText size={20} className="text-[#087F5B]" />
                                Receipt Details
                            </h3>

                            <DetailRow
                                label="Vehicle"
                                value={receipt.vehicleType?.replaceAll("_", " ")}
                            />
                            <DetailRow
                                label="Trip distance"
                                value={receipt.distance != null
                                    ? `${receipt.distance} km`
                                    : "—"}
                            />
                            <DetailRow
                                label="Requested fare"
                                value={formatMoney(receipt.requestedPrice)}
                            />
                            <DetailRow
                                label="Agreed fare"
                                value={formatMoney(
                                    Number(receipt.finalPrice || 0) -
                                    Number(receipt.waitingCharge || 0)
                                )}
                            />
                            <DetailRow
                                label="Waiting charges"
                                value={formatMoney(receipt.waitingCharge || 0)}
                            />
                            <DetailRow
                                label="Total payable"
                                value={formatMoney(receipt.finalPrice)}
                            />
                            <DetailRow
                                label="Booked"
                                value={formatDate(receipt.bookedAt)}
                            />
                            <DetailRow
                                label="Completed"
                                value={formatDate(receipt.completedAt)}
                            />
                            <DetailRow
                                label="Payment"
                                value="Cash"
                            />
                        </section>

                        {receipt.driver && (
                            <section className="rounded-3xl bg-pd-surface p-5 shadow-sm">
                                <h3 className="mb-4 flex items-center gap-2 font-extrabold">
                                    <CarFront size={20} className="text-[#087F5B]" />
                                    Driver
                                </h3>

                                <div className="flex items-center gap-2">
                                    <Star
                                        size={20}
                                        className="fill-amber-400 text-amber-400"
                                    />
                                    <p className="font-bold">
                                        {receipt.driver.rating != null
                                            ? Number(receipt.driver.rating).toFixed(1)
                                            : "New driver"}
                                    </p>
                                    <span className="text-sm text-pd-muted">
                                        ({receipt.driver.ratingCount} reviews)
                                    </span>
                                </div>
                            </section>
                        )}

                        <div className="flex items-center justify-center gap-2 text-xs text-pd-muted">
                            <Clock3 size={14} />
                            Receipt generated from recorded trip details
                        </div>

                        <Link
                            href="/passenger/account"
                            className="block rounded-2xl bg-[#087F5B] px-5 py-4 text-center font-bold text-white"
                        >
                            Back to My Rides
                        </Link>
                    </>
                )}
            </div>
        </main>
    );
}
