
"use client";

import { useState } from "react";
import { Star } from "lucide-react";
import { apiRequest } from "@/lib/api";

export default function DriverRating({ rideId, token, onSuccess }) {
    const [rating, setRating] = useState(0);
    const [comment, setComment] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState("");

    async function submitReview() {
        if (!rating || submitting) return;

        setSubmitting(true);
        setError("");

        try {
            await apiRequest(`/rides/${rideId}/review`, {
                method: "POST",
                token,
                body: JSON.stringify({ rating, comment: comment.trim() }),
            });

            onSuccess?.();
        } catch (err) {
            setError(err.message);
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <div className="rounded-2xl border border-emerald-100 bg-white p-5">
            <h3 className="text-lg font-extrabold">Rate Your Driver</h3>
            <p className="mt-1 text-sm text-slate-500">
                How was your trip?
            </p>

            <div className="my-5 flex justify-center gap-3">
                {[1, 2, 3, 4, 5].map((value) => (
                    <button
                        key={value}
                        type="button"
                        onClick={() => setRating(value)}
                        aria-label={`${value} stars`}
                        className="p-1"
                    >
                        <Star
                            size={34}
                            className={value <= rating
                                ? "fill-amber-400 text-amber-400"
                                : "text-slate-300"}
                        />
                    </button>
                ))}
            </div>

            <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                maxLength={1000}
                rows={3}
                placeholder="Share your experience (optional)"
                className="w-full resize-none rounded-xl border border-slate-200 p-3 text-sm outline-none focus:border-[#087F5B]"
            />

            {error && (
                <p role="alert" className="mt-2 text-sm text-red-600">
                    {error}
                </p>
            )}

            <button
                type="button"
                disabled={!rating || submitting}
                onClick={submitReview}
                className="mt-4 h-12 w-full rounded-xl bg-[#087F5B] font-bold text-white disabled:opacity-50"
            >
                {submitting ? "Submitting..." : "Submit Review"}
            </button>
        </div>
    );
}
