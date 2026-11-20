"use client";

import { useState } from "react";
import { Share2, Copy, Check, MessageCircle } from "lucide-react";
import { apiRequest } from "@/lib/api";

// ---------------------------------------------------------------------
// Safety (Safar To-Do #5, Phase 1, item c) — live trip sharing.
//
// Creates a 24-hour share link (POST /safety/rides/:rideId/share-link)
// and offers it on WhatsApp (wa.me) or copy. Anyone with the link sees
// the ride's live position on the public share page — no login, no
// phone numbers shown.
// ---------------------------------------------------------------------

export default function ShareTripButton({ rideId, token }) {
    const [shareUrl, setShareUrl] = useState("");
    const [loading, setLoading] = useState(false);
    const [copied, setCopied] = useState(false);
    const [error, setError] = useState("");

    async function createLink() {
        if (shareUrl || loading) return;
        setLoading(true);
        setError("");
        try {
            const data = await apiRequest(`/safety/rides/${rideId}/share-link`, {
                method: "POST",
                token,
            });
            setShareUrl(data.shareUrl || "");
        } catch (err) {
            setError(err.message || "Could not create share link");
        } finally {
            setLoading(false);
        }
    }

    async function copy() {
        try {
            await navigator.clipboard.writeText(shareUrl);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            setError("Copy failed — long-press the link to copy it.");
        }
    }

    if (shareUrl) {
        const waUrl = `https://wa.me/?text=${encodeURIComponent(`Track my live Safar trip here: ${shareUrl}`)}`;
        return (
            <div className="rounded-2xl border border-pd-line p-3">
                <p className="text-xs font-bold text-pd-muted">Live trip link (valid 24 hours)</p>
                <p className="mt-1 break-all text-xs font-semibold text-pd-text-2">{shareUrl}</p>
                <div className="mt-2 flex gap-2">
                    <a
                        href={waUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="flex h-10 flex-1 items-center justify-center gap-2 rounded-xl bg-[#25D366] text-sm font-extrabold text-white"
                    >
                        <MessageCircle size={16} /> Share on WhatsApp
                    </a>
                    <button
                        type="button"
                        onClick={copy}
                        className="flex h-10 items-center justify-center gap-2 rounded-xl bg-pd-surface-2 px-4 text-sm font-bold"
                    >
                        {copied ? <Check size={16} /> : <Copy size={16} />}
                        {copied ? "Copied" : "Copy"}
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div>
            <button
                type="button"
                onClick={createLink}
                disabled={loading}
                className="flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-pd-surface-2 text-sm font-bold disabled:opacity-60"
            >
                <Share2 size={17} />
                {loading ? "Creating link…" : "Share live trip"}
            </button>
            {error && <p role="alert" className="mt-1.5 text-center text-xs font-bold text-red-600">{error}</p>}
        </div>
    );
}
