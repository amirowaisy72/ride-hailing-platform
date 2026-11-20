"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Check, Copy, MessageCircle, UserPlus } from "lucide-react";
import AuthGuard from "@/components/AuthGuard";
import MobileBottomNav from "@/components/MobileBottomNav";
import { useAuth } from "@/context/AuthContext";
import { apiRequest } from "@/lib/api";

// ---------------------------------------------------------------------
// Invite System (Safar To-Do #6) — invite screen.
//
// Any logged-in user (passenger or driver) sees their unique invite
// code + link and can share it on WhatsApp. NO reward/benefit logic:
// the user has not decided any reward yet — invite facility only.
// ---------------------------------------------------------------------

export default function InvitePage() {
    return (
        <AuthGuard>
            <InviteContent />
        </AuthGuard>
    );
}

function InviteContent() {
    const { user, token } = useAuth();
    const [invite, setInvite] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [copied, setCopied] = useState("");

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const data = await apiRequest("/invites/me", { token });
                if (!cancelled) setInvite(data);
            } catch (err) {
                if (!cancelled) setError(err.message || "Could not load your invite code");
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [token]);

    async function copy(text, which) {
        try {
            await navigator.clipboard.writeText(text);
            setCopied(which);
            setTimeout(() => setCopied(""), 2000);
        } catch {
            setError("Copy failed — long-press the text to copy it.");
        }
    }

    const role = user?.activeMode || "PASSENGER";
    const waUrl = invite?.inviteLink
        ? `https://wa.me/?text=${encodeURIComponent(`Join me on Safar — book rides, send parcels and rent cars in Khanpur, Rahim Yar Khan and Liaquatpur. Sign up here: ${invite.inviteLink}`)}`
        : "";

    return (
        <main className="min-h-dvh bg-pd-bg px-4 pb-28 pt-6 text-pd-text">
            <div className="mx-auto max-w-lg">
                <Link href={role === "DRIVER" ? "/driver/account" : "/passenger/account"} className="text-sm font-bold text-[#087F5B]">
                    ← Back to account
                </Link>
                <div className="mt-4 rounded-3xl bg-pd-surface p-6 shadow-sm">
                    <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#087F5B] text-white">
                        <UserPlus size={22} />
                    </span>
                    <h1 className="mt-3 text-2xl font-extrabold tracking-tight">Invite friends to Safar</h1>
                    <p className="mt-1 text-sm text-pd-muted">
                        Share your invite link — anyone who signs up with it joins Safar through you.
                    </p>

                    {loading && <p className="mt-6 text-sm font-semibold text-pd-muted">Loading your invite code…</p>}
                    {error && <p role="alert" className="mt-6 rounded-xl bg-pd-danger-soft p-3 text-sm text-pd-danger">{error}</p>}

                    {invite && (
                        <div className="mt-6 space-y-3">
                            <div>
                                <p className="text-xs font-bold uppercase tracking-wide text-pd-muted">Your invite code</p>
                                <div className="mt-1 flex items-center gap-2">
                                    <p className="flex-1 rounded-2xl border border-dashed border-pd-line bg-pd-surface-2 px-4 py-3 text-center font-mono text-xl font-extrabold tracking-[0.2em]">
                                        {invite.inviteCode}
                                    </p>
                                    <button
                                        type="button"
                                        onClick={() => copy(invite.inviteCode, "code")}
                                        aria-label="Copy invite code"
                                        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-pd-surface-2"
                                    >
                                        {copied === "code" ? <Check size={19} className="text-[#087F5B]" /> : <Copy size={19} />}
                                    </button>
                                </div>
                            </div>

                            <div>
                                <p className="text-xs font-bold uppercase tracking-wide text-pd-muted">Your invite link</p>
                                <p className="mt-1 break-all rounded-2xl bg-pd-surface-2 px-4 py-3 text-xs font-semibold text-pd-text-2">
                                    {invite.inviteLink}
                                </p>
                            </div>

                            <a
                                href={waUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="flex h-13 items-center justify-center gap-2 rounded-2xl bg-[#25D366] py-3.5 text-sm font-extrabold text-white"
                            >
                                <MessageCircle size={18} /> Share on WhatsApp
                            </a>
                            <button
                                type="button"
                                onClick={() => copy(invite.inviteLink, "link")}
                                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-pd-surface-2 py-3.5 text-sm font-bold"
                            >
                                {copied === "link" ? <Check size={17} className="text-[#087F5B]" /> : <Copy size={17} />}
                                {copied === "link" ? "Link copied" : "Copy invite link"}
                            </button>

                            <p className="pt-1 text-center text-xs font-semibold text-pd-muted">
                                {invite.invitedCount === 0
                                    ? "Nobody has joined with your code yet."
                                    : `${invite.invitedCount} ${invite.invitedCount === 1 ? "person has" : "people have"} joined with your code.`}
                            </p>
                        </div>
                    )}
                </div>
            </div>
            <MobileBottomNav role={role} />
        </main>
    );
}
