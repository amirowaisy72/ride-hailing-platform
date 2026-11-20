// Mandatory-phone collection screen. Google sign-in creates an
// account with NO phone number, so after a Google sign-in the user
// lands here until a valid Pakistani mobile number is saved. Also
// used when "Become a driver" needs a phone first (?next=...).
// New-app screen only — old apps never route here.
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AuthGuard from "@/components/AuthGuard";
import { useAuth } from "@/context/AuthContext";
import { apiRequest } from "@/lib/api";
import { normalizePkPhone, isValidPkPhone, PK_PHONE_HINT } from "@/lib/phone";

export default function CompletePhonePage() {
    return (
        <AuthGuard>
            <CompletePhoneScreen />
        </AuthGuard>
    );
}

function CompletePhoneScreen() {
    const router = useRouter();
    const { token } = useAuth();
    const [phone, setPhone] = useState("");
    const [error, setError] = useState("");
    const [saving, setSaving] = useState(false);
    const [checking, setChecking] = useState(true);

    function nextPath() {
        if (typeof window === "undefined") return "/passenger";
        const next = new URLSearchParams(window.location.search).get("next");
        return next && next.startsWith("/") ? next : "/passenger";
    }

    // If the account already has a valid number, there is nothing
    // to do here — go on to the destination.
    useEffect(() => {
        if (!token) return;
        (async () => {
            try {
                const account = await apiRequest("/account/me", { token });
                if (isValidPkPhone(account.user?.phone)) {
                    router.replace(nextPath());
                    return;
                }
            } catch {
                // Stay on the form; saving will surface any error.
            } finally {
                setChecking(false);
            }
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [token]);

    async function submit(e) {
        e.preventDefault();
        if (saving) return;

        const normalized = normalizePkPhone(phone);
        if (!normalized) {
            setError(`A valid Pakistani mobile number is required. ${PK_PHONE_HINT}`);
            return;
        }

        setSaving(true);
        setError("");
        try {
            await apiRequest("/account/me", {
                method: "PATCH",
                token,
                body: JSON.stringify({ phone: normalized }),
            });
            router.replace(nextPath());
        } catch (err) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    }

    if (checking) {
        return (
            <main className="flex min-h-dvh items-center justify-center bg-pd-bg text-pd-text">
                Loading...
            </main>
        );
    }

    return (
        <main className="min-h-dvh bg-pd-bg text-pd-text">
            <header className="px-6 pb-8 pt-12">
                <h1 className="text-4xl font-extrabold">Add your mobile number</h1>
                <p className="mt-3 text-pd-muted">
                    Your mobile number is required for your Safar account —
                    so pilots and support can reach you. {PK_PHONE_HINT}
                </p>
            </header>

            <section className="rounded-t-[36px] bg-pd-surface px-6 py-9">
                <form onSubmit={submit} className="mx-auto max-w-md space-y-4">
                    <label className="block">
                        <span className="mb-2 block text-sm font-semibold">
                            Mobile Number *
                        </span>
                        <input
                            type="tel"
                            autoComplete="tel"
                            required
                            maxLength={20}
                            value={phone}
                            onChange={(e) => setPhone(e.target.value)}
                            placeholder="0301-2345678"
                            className="h-14 w-full rounded-2xl border bg-pd-surface-2 px-4 outline-none focus:border-[#087F5B]"
                        />
                    </label>

                    {error && (
                        <p role="alert" className="rounded-xl bg-pd-danger-soft p-3 text-sm text-pd-danger">
                            {error}
                        </p>
                    )}

                    <button
                        disabled={saving}
                        className="h-14 w-full rounded-2xl bg-[#087F5B] font-bold text-white disabled:opacity-50"
                    >
                        {saving ? "Saving..." : "Save and Continue →"}
                    </button>
                </form>
            </section>
        </main>
    );
}
