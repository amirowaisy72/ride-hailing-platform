"use client";

import { useEffect } from "react";
import { X } from "lucide-react";

import { ProfileAvatar } from "./ProfilePhotoViewer";

// Shared full-profile modal for the Passengers and Drivers pages.
// Explicitly dark (no white surfaces), so it can never render as one
// of the white cards. Clicking a name opens it; the photo inside
// still opens the fullscreen photo viewer.

const vehicleNames = {
    BIKE: "Motorcycle",
    RICKSHAW: "Rickshaw",
    CAR_AC: "Car (AC)",
    CAR_NON_AC: "Car (Non-AC)",
};

const formatDate = (value) =>
    value
        ? new Date(value).toLocaleDateString("en-PK", {
              day: "numeric",
              month: "short",
              year: "numeric",
          })
        : "—";

function timeAgo(value) {
    if (!value) return "Never seen";
    const seconds = Math.floor((Date.now() - new Date(value)) / 1000);
    if (seconds < 60) return "Just now";
    if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`;
    if (seconds < 86400 * 30)
        return `${Math.floor(seconds / 86400)} days ago`;
    return formatDate(value);
}

function statusChip(status) {
    if (status === "TRIP_COMPLETED" || status === "APPROVED")
        return "bg-emerald-500/20 text-emerald-200";
    if (status === "CANCELLED" || status === "REJECTED")
        return "bg-red-500/20 text-red-200";
    if (status === "PENDING" || status === "UNDER_REVIEW")
        return "bg-amber-500/20 text-amber-200";
    return "bg-white/10 text-white/80";
}

function displayName(user) {
    if (!user) return "User";
    return (
        [user.firstName, user.lastName].filter(Boolean).join(" ") ||
        user.name ||
        "User"
    );
}

export default function ProfileModal({
    open,
    onClose,
    kind,
    profile,
    loading,
    error,
    photoUrl: photoUrlProp,
    onViewPhoto,
    onReviewDocuments,
}) {
    useEffect(() => {
        if (!open) return;
        const onKey = (event) => {
            if (event.key === "Escape") onClose();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [open, onClose]);

    if (!open) return null;

    const user = profile?.user || null;
    const isDriver = kind === "driver";
    const stats = profile?.rideStats || {};
    // Pages pass the row photo (for drivers: latest PROFILE_PHOTO doc
    // first, then the user profileImage) so the modal matches the row.
    const photoUrl = photoUrlProp ?? user?.profileImage ?? null;

    return (
        <div
            className="fixed inset-0 z-[110] flex items-end justify-center bg-black/85 p-4 sm:items-center"
            onClick={onClose}
            role="dialog"
            aria-modal="true"
            aria-label="Full profile"
        >
            <div
                className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-[#2a5245] bg-[#16352c] p-5 text-[#eff6f1] shadow-2xl"
                onClick={(event) => event.stopPropagation()}
            >
                <div className="flex items-start justify-between gap-3">
                    <h3 className="text-lg font-extrabold">
                        {isDriver ? "Driver Profile" : "Passenger Profile"}
                    </h3>
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label="Close profile"
                        className="rounded-lg border border-white/25 px-3 py-1.5 text-sm font-bold text-[#e6efea]"
                    >
                        <X size={16} />
                    </button>
                </div>

                {loading && (
                    <p className="py-10 text-center text-sm text-white/70">
                        Loading profile...
                    </p>
                )}

                {error && (
                    <p
                        role="alert"
                        className="mt-4 rounded-xl bg-red-500/15 p-4 text-sm text-red-200"
                    >
                        {error}
                    </p>
                )}

                {!loading && !error && profile && (
                    <div className="mt-4 space-y-5">
                        <div className="flex items-start gap-4">
                            <ProfileAvatar
                                url={photoUrl}
                                name={displayName(user)}
                                size={72}
                                onOpen={onViewPhoto}
                            />
                            <div className="min-w-0">
                                <p className="truncate text-lg font-extrabold">
                                    {displayName(user)}
                                </p>
                                <p className="mt-1 truncate text-sm text-white/70">
                                    {user?.email || "Email unavailable"}
                                </p>
                                {user?.phone ? (
                                    <a
                                        href={`tel:${user.phone}`}
                                        className="mt-1 block text-sm font-semibold text-[#7fd4a8]"
                                    >
                                        {user.phone}
                                    </a>
                                ) : (
                                    <p className="mt-1 text-sm text-white/50">
                                        No phone number
                                    </p>
                                )}
                                <p className="mt-2 text-xs text-white/60">
                                    Registered{" "}
                                    {formatDate(
                                        isDriver
                                            ? profile.driver?.createdAt
                                            : user?.createdAt
                                    )}
                                    {" · "}Last active{" "}
                                    {timeAgo(profile.lastActiveAt)}
                                </p>
                                {profile.appVersion && (
                                    <p className="mt-1 text-xs text-white/60">
                                        App version {profile.appVersion}
                                    </p>
                                )}
                                {isDriver && (
                                    <p className="mt-1 text-xs text-white/60">
                                        Status:{" "}
                                        {profile.driver?.verificationStatus ||
                                            "PENDING"}
                                        {profile.driver?.isOnline
                                            ? " · Online now"
                                            : ""}
                                    </p>
                                )}
                            </div>
                        </div>

                        <div>
                            <p className="text-xs font-bold uppercase tracking-wider text-[#7fd4a8]">
                                Rides
                            </p>
                            <div className="mt-2 grid grid-cols-3 gap-2">
                                {[
                                    ["Total", stats.total ?? 0],
                                    ["Completed", stats.completed ?? 0],
                                    ["Cancelled", stats.cancelled ?? 0],
                                ].map(([label, value]) => (
                                    <div
                                        key={label}
                                        className="rounded-xl bg-white/5 p-3"
                                    >
                                        <p className="text-xl font-extrabold">
                                            {value}
                                        </p>
                                        <p className="text-xs text-white/60">
                                            {label}
                                        </p>
                                    </div>
                                ))}
                            </div>

                            {(profile.recentRides || []).length === 0 ? (
                                <p className="mt-3 text-sm text-white/50">
                                    No rides yet.
                                </p>
                            ) : (
                                <ul className="mt-3 space-y-2">
                                    {profile.recentRides.map((ride) => (
                                        <li
                                            key={ride._id}
                                            className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white/5 px-3 py-2 text-sm"
                                        >
                                            <span className="text-white/70">
                                                {formatDate(ride.createdAt)}
                                                {" · "}
                                                {vehicleNames[
                                                    ride.vehicleType
                                                ] || ride.vehicleType}
                                            </span>
                                            <span className="flex items-center gap-2">
                                                <span
                                                    className={`rounded-md px-2 py-0.5 text-[11px] font-bold ${statusChip(ride.status)}`}
                                                >
                                                    {ride.status}
                                                </span>
                                                <span className="font-bold">
                                                    PKR{" "}
                                                    {ride.finalPrice ??
                                                        ride.requestedPrice ??
                                                        "—"}
                                                </span>
                                            </span>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>

                        {isDriver && (
                            <div>
                                <p className="text-xs font-bold uppercase tracking-wider text-[#7fd4a8]">
                                    Vehicles listed (
                                    {(profile.vehicles || []).length})
                                </p>
                                {(profile.vehicles || []).length === 0 ? (
                                    <p className="mt-3 text-sm text-white/50">
                                        No vehicles listed.
                                    </p>
                                ) : (
                                    <ul className="mt-3 space-y-2">
                                        {profile.vehicles.map((vehicle) => (
                                            <li
                                                key={vehicle._id}
                                                className="rounded-xl bg-white/5 px-3 py-2.5"
                                            >
                                                <div className="flex flex-wrap items-center justify-between gap-2">
                                                    <p className="font-bold">
                                                        {vehicle.make ||
                                                            "Vehicle"}{" "}
                                                        {vehicle.model || ""}
                                                        {vehicle.modelYear
                                                            ? ` (${vehicle.modelYear})`
                                                            : ""}
                                                    </p>
                                                    {vehicle.isCurrent && (
                                                        <span className="rounded-md bg-emerald-500/25 px-2 py-0.5 text-[11px] font-bold text-emerald-200">
                                                            IN USE NOW
                                                        </span>
                                                    )}
                                                </div>
                                                <p className="mt-1 text-sm text-white/70">
                                                    {vehicle.registrationNumber ||
                                                        "Registration unavailable"}
                                                    {" · "}
                                                    {vehicleNames[
                                                        vehicle.vehicleType
                                                    ] || vehicle.vehicleType}
                                                    {vehicle.color
                                                        ? ` · ${vehicle.color}`
                                                        : ""}
                                                </p>
                                                <div className="mt-2 flex flex-wrap gap-1.5">
                                                    <span
                                                        className={`rounded-md px-2 py-0.5 text-[11px] font-bold ${statusChip(vehicle.verificationStatus)}`}
                                                    >
                                                        {
                                                            vehicle.verificationStatus
                                                        }
                                                    </span>
                                                    {!vehicle.isActive && (
                                                        <span className="rounded-md bg-white/10 px-2 py-0.5 text-[11px] font-bold text-white/70">
                                                            Inactive
                                                        </span>
                                                    )}
                                                </div>
                                            </li>
                                        ))}
                                    </ul>
                                )}

                                <p className="mt-4 text-xs font-bold uppercase tracking-wider text-[#7fd4a8]">
                                    Documents
                                </p>
                                <p className="mt-2 text-sm text-white/70">
                                    {profile.documentCounts?.approved ?? 0}{" "}
                                    approved ·{" "}
                                    {profile.documentCounts?.pending ?? 0}{" "}
                                    pending ·{" "}
                                    {profile.documentCounts?.rejected ?? 0}{" "}
                                    rejected ·{" "}
                                    {profile.documentCounts?.total ?? 0} total
                                </p>
                                {(profile.missingDocuments || []).length >
                                    0 && (
                                    <p className="mt-1 text-sm text-amber-200">
                                        Missing:{" "}
                                        {profile.missingDocuments.join(", ")}
                                    </p>
                                )}
                                {onReviewDocuments && (
                                    <button
                                        type="button"
                                        onClick={onReviewDocuments}
                                        className="mt-3 rounded-xl border border-emerald-200/40 px-4 py-2.5 text-sm font-bold text-[#7fd4a8]"
                                    >
                                        Review Documents
                                    </button>
                                )}
                            </div>
                        )}

                        {!isDriver && (
                            <p className="text-sm text-white/70">
                                Complaints: {profile.complaints ?? 0}
                                {" · "}Feedback: {profile.feedback ?? 0}
                            </p>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
