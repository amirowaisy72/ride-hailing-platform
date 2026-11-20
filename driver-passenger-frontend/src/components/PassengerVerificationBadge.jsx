"use client";

import { BadgeCheck, Phone, Star, TriangleAlert, UserRound } from "lucide-react";

// ---------------------------------------------------------------------
// Safety (Safar To-Do #5, Phase 1, item b) — passenger verification
// badge, shown to the driver on a ride request BEFORE they offer.
//
// Honest signals only: the system has no SMS phone verification, so
// nothing here claims a phone is "verified" — it shows phone-on-file,
// email-verified, profile photo, and ride history (completed rides,
// no-shows). Rendered only when the backend attached
// ride.passengerVerification; old app versions never see it.
// ---------------------------------------------------------------------

export default function PassengerVerificationBadge({ verification }) {
    if (!verification) return null;

    return (
        <div className="mt-3 rounded-2xl border border-pd-line bg-pd-surface-2 p-3">
            <div className="flex items-center gap-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-pd-ink text-sm font-extrabold text-[#087F5B]">
                    {verification.profileImage ? (
                        <img src={verification.profileImage} alt="Passenger" className="h-full w-full object-cover" />
                    ) : (
                        <UserRound size={20} />
                    )}
                </span>
                <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-extrabold">{verification.name || "Passenger"}</p>
                    <p className="text-xs font-semibold text-pd-muted">
                        {verification.completedRides} completed ride{verification.completedRides === 1 ? "" : "s"}
                        {verification.ratingCount > 0 && (
                            <span className="ml-1 inline-flex items-center gap-0.5">
                                <Star size={11} className="fill-[#F5A524] text-[#F5A524]" />
                                {Number(verification.rating).toFixed(1)}
                            </span>
                        )}
                    </p>
                </div>
            </div>
            <div className="mt-2.5 flex flex-wrap gap-1.5">
                <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-bold ${verification.phoneProvided ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200" : "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200"}`}>
                    <Phone size={11} />
                    {verification.phoneProvided ? "Phone on file" : "No phone on file"}
                </span>
                {verification.emailVerified && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-1 text-[11px] font-bold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
                        <BadgeCheck size={11} /> Email verified
                    </span>
                )}
                {verification.noShowCount > 0 && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-1 text-[11px] font-bold text-red-700 dark:bg-red-950 dark:text-red-200">
                        <TriangleAlert size={11} />
                        {verification.noShowCount} no-show{verification.noShowCount === 1 ? "" : "s"}
                    </span>
                )}
            </div>
        </div>
    );
}
