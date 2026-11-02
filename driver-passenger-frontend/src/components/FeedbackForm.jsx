"use client";

import { useState } from "react";
import { ChevronRight, MessageCircle, Star, X } from "lucide-react";
import { apiRequest } from "@/lib/api";
import { useLanguage } from "@/components/i18n/LanguageProvider";

/**
 * General feedback about the Safar app itself (suggestions for
 * improvement). This is NOT a rating of a driver, ride, rental or
 * purchase — those per-service ratings already exist elsewhere and
 * are untouched. The submitter's role is taken from the logged-in
 * user on the backend, never from this form.
 *
 * Rendered ONLY as a row inside the passenger/driver Account
 * screens — never as a floating button on a home/map screen, so
 * it cannot sit over the map or block normal use.
 */
const CATEGORIES = [
    "APP",
    "RIDE",
    "PARCEL",
    "RENTAL",
    "BUY_DELIVER",
    "PAYMENT",
    "OTHER",
];

export default function FeedbackForm({ token }) {
    // Row trigger only: no floating/fixed button anywhere.
    const { t } = useLanguage();
    const [open, setOpen] = useState(false);
    const [category, setCategory] = useState("APP");
    const [rating, setRating] = useState(0);
    const [message, setMessage] = useState("");
    const [error, setError] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [submitted, setSubmitted] = useState(false);

    const categoryLabel = (value) =>
        t(`feedback.category${value === "BUY_DELIVER" ? "BuyDeliver" : value.charAt(0) + value.slice(1).toLowerCase()}`);

    async function submit() {
        const text = message.trim();
        if (!text) {
            setError(t("feedback.messageRequired"));
            return;
        }
        setError("");
        setSubmitting(true);
        try {
            await apiRequest("/feedback", {
                method: "POST",
                token,
                body: JSON.stringify({
                    category,
                    rating: rating || null,
                    message: text,
                }),
            });
            setSubmitted(true);
            setMessage("");
            setRating(0);
        } catch (err) {
            setError(err.message);
        } finally {
            setSubmitting(false);
        }
    }

    function close() {
        setOpen(false);
        setSubmitted(false);
        setError("");
    }

    return (
        <>
            {!open && (
                <button
                    type="button"
                    onClick={() => setOpen(true)}
                    className="flex w-full items-center gap-3 py-4 text-left"
                >
                    <MessageCircle size={20} aria-hidden="true" className="text-[#087F5B]" />
                    <div className="flex-1">
                        <p className="text-sm font-semibold">{t("feedback.button")}</p>
                        <p className="text-xs text-pd-muted">{t("feedback.subtitle")}</p>
                    </div>
                    <ChevronRight size={18} className="text-pd-faint" />
                </button>
            )}
            {open && (
                <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center">
                    <div className="w-full max-w-md rounded-t-3xl bg-white p-5 shadow-xl sm:rounded-3xl">
                        <div className="flex items-center justify-between">
                            <h2 className="text-base font-extrabold">
                                {t("feedback.title")}
                            </h2>
                            <button
                                type="button"
                                onClick={close}
                                aria-label={t("common.close")}
                                className="rounded-full p-2"
                            >
                                <X size={18} />
                            </button>
                        </div>
                        {submitted ? (
                            <p className="mt-4 rounded-xl bg-emerald-50 p-4 text-sm font-bold text-[#087F5B]">
                                {t("feedback.thanks")}
                            </p>
                        ) : (
                            <>
                                <p className="mt-1 text-sm text-slate-500">
                                    {t("feedback.subtitle")}
                                </p>
                                <label className="mt-4 block text-sm font-bold">
                                    {t("feedback.category")}
                                    <select
                                        value={category}
                                        onChange={(e) => setCategory(e.target.value)}
                                        className="mt-1 h-12 w-full rounded-xl border px-3 text-sm font-normal"
                                    >
                                        {CATEGORIES.map((value) => (
                                            <option key={value} value={value}>
                                                {categoryLabel(value)}
                                            </option>
                                        ))}
                                    </select>
                                </label>
                                <div className="mt-4">
                                    <p className="text-sm font-bold">
                                        {t("feedback.rating")}
                                    </p>
                                    <div className="mt-1 flex gap-1">
                                        {[1, 2, 3, 4, 5].map((value) => (
                                            <button
                                                key={value}
                                                type="button"
                                                onClick={() => setRating(value === rating ? 0 : value)}
                                                aria-label={`${value} star`}
                                                className="p-1"
                                            >
                                                <Star
                                                    size={26}
                                                    fill={value <= rating ? "#f59e0b" : "none"}
                                                    color={value <= rating ? "#f59e0b" : "#94a3b8"}
                                                />
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                <label className="mt-4 block text-sm font-bold">
                                    {t("feedback.message")}
                                    <textarea
                                        value={message}
                                        onChange={(e) => setMessage(e.target.value)}
                                        placeholder={t("feedback.messagePlaceholder")}
                                        maxLength={1000}
                                        rows={4}
                                        className="mt-1 w-full rounded-xl border p-3 text-sm font-normal"
                                    />
                                </label>
                                {error && (
                                    <p role="alert" className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-600">
                                        {error}
                                    </p>
                                )}
                                <button
                                    type="button"
                                    onClick={submit}
                                    disabled={submitting}
                                    className="mt-4 h-12 w-full rounded-xl bg-[#087F5B] text-sm font-extrabold text-white disabled:opacity-50"
                                >
                                    {submitting ? t("feedback.sending") : t("feedback.submit")}
                                </button>
                            </>
                        )}
                    </div>
                </div>
            )}
        </>
    );
}
