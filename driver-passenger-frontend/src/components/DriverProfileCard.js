"use client";

import { useEffect, useState } from "react";
import { CarFront, ShieldCheck, Star, UserRound } from "lucide-react";
import { apiRequest } from "@/lib/api";

export default function DriverProfileCard({
    driverId,
    token,
}) {
    const [profile, setProfile] = useState(null);
    const [photoOpen, setPhotoOpen] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    useEffect(() => {
        if (!driverId || !token) {
            setProfile(null);
            setLoading(false);
            return;
        }

        let cancelled = false;
        setLoading(true);
        setError("");

        apiRequest(`/drivers/profile/${driverId}`, { token })
            .then((data) => {
                if (!cancelled) setProfile(data.driver);
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
    }, [driverId, token]);

    if (loading) {
        return (
            <div className="rounded-2xl border p-4 text-sm text-slate-500">
                Loading driver details...
            </div>
        );
    }

    if (error) {
        return (
            <div role="alert" className="rounded-2xl bg-red-50 p-4 text-sm text-red-600">
                {error}
            </div>
        );
    }

    if (!profile) return null;

    return (
        <>
            <section className="rounded-2xl border border-emerald-100 bg-white p-4 shadow-sm">
                <div className="flex items-center gap-3">
                    <button
                        type="button"
                        onClick={() => profile.profileImage && setPhotoOpen(true)}
                        className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full bg-emerald-50 text-[#087F5B]"
                    >
                        {profile.profileImage ? (
                            <img src={profile.profileImage} alt={profile.name} className="h-full w-full object-cover" />
                        ) : <UserRound size={25} />}
                    </button>

                    <div className="flex-1">
                        <h3 className="font-bold">{profile.name || "Driver Information"}</h3>

                        <p className="flex items-center gap-1 text-xs text-[#087F5B]">
                            <ShieldCheck size={14} />
                            Verified Driver
                        </p>
                    </div>

                    <div className="flex items-center gap-1">
                        <Star size={17} className="fill-amber-400 text-amber-400" />
                        <span className="font-bold">
                            {profile.rating != null
                                ? Number(profile.rating).toFixed(1)
                                : "New"}
                        </span>
                        <span className="text-xs text-slate-500">
                            ({profile.ratingCount})
                        </span>
                    </div>
                </div>

                {profile.vehicle && (
                    <div className="mt-4 flex items-center gap-3 rounded-xl bg-slate-50 p-3">
                        <CarFront size={22} className="text-[#087F5B]" />

                        <div>
                            <p className="font-semibold">
                                {profile.vehicle.make} {profile.vehicle.model}
                            </p>
                            <p className="text-xs text-slate-500">
                                {profile.vehicle.vehicleType?.replaceAll("_", " ")}
                                {profile.vehicle.color
                                    ? ` · ${profile.vehicle.color}`
                                    : ""}
                            </p>
                        </div>
                    </div>
                )}

                {profile.reviews?.length > 0 && (
                    <div className="mt-4 border-t pt-3">
                        <p className="mb-2 text-sm font-bold">
                            Recent Reviews
                        </p>

                        {profile.reviews.map((review, index) => (
                            <div
                                key={index}
                                className="border-b py-2 last:border-0"
                            >
                                <div className="flex items-center gap-1 text-amber-500">
                                    <Star size={13} fill="currentColor" />
                                    <span className="text-xs font-semibold">
                                        {review.rating}/5
                                    </span>
                                </div>

                                {review.comment && (
                                    <p className="mt-1 text-sm text-slate-600">
                                        {review.comment}
                                    </p>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </section>

            {photoOpen && profile.profileImage && (
                <div className="fixed inset-0 z-[9999] flex flex-col bg-black">
                    <button
                        type="button"
                        onClick={() => setPhotoOpen(false)}
                        className="absolute right-5 top-8 z-10 rounded-full bg-white/20 p-3 text-white"
                        aria-label="Close photo"
                    >
                        ✕
                    </button>

                    <img
                        src={profile.profileImage}
                        alt={profile.name || "Driver"}
                        className="h-full w-full object-contain"
                    />
                </div>
            )}
        </>
    );
}
