"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { apiRequest } from "@/lib/api";

function VerifyOTPForm() {
    const router = useRouter();
    const params = useSearchParams();
    const email = params.get("email") || "";

    const [otp, setOtp] = useState("");
    const [error, setError] = useState("");
    const [message, setMessage] = useState("");
    const [loading, setLoading] = useState(false);

    async function verify(e) {
        e.preventDefault();
        setLoading(true);
        setError("");

        try {
            await apiRequest("/auth/verify-otp", {
                method: "POST",
                body: JSON.stringify({ email, otp }),
            });

            router.replace("/login");
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }

    async function resend() {
        setError("");
        setMessage("");
        try {
            await apiRequest("/auth/send-otp", {
                method: "POST",
                body: JSON.stringify({ email }),
            });
            setMessage("New OTP sent.");
        } catch (err) {
            setError(err.message);
        }
    }

    return (
        <main className="flex min-h-dvh items-center justify-center bg-[#F8FAF9] px-6">
            <form onSubmit={verify} className="w-full max-w-md rounded-3xl bg-white p-7 shadow-sm">
                <div className="mb-6 flex items-center gap-2">
                    <img
                        src="/safar-icon.png"
                        alt="Safar logo"
                        className="h-15 w-15 rounded-2xl object-cover"
                    />
                    <span className="text-2xl font-extrabold tracking-tight text-[#111827] dark:text-white">
                        Safar
                    </span>
                </div>
                <h1 className="text-3xl font-extrabold">
                    Verify Email
                </h1>
                <p className="mt-3 text-sm text-gray-500">
                    Enter the 6-digit code sent to {email}
                </p>

                <input
                    value={otp}
                    onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    inputMode="numeric"
                    maxLength={6}
                    required
                    pattern="[0-9]{6}"
                    placeholder="000000"
                    className="mt-7 h-16 w-full rounded-2xl border text-center text-2xl tracking-[0.3em] outline-none focus:border-[#087F5B]"
                />

                {error && <p role="alert" className="mt-4 text-sm text-red-600">{error}</p>}
                {message && <p className="mt-4 text-sm text-green-700">{message}</p>}

                <button disabled={loading || otp.length !== 6} className="mt-6 h-14 w-full rounded-2xl bg-[#087F5B] font-bold text-white disabled:opacity-50">
                    {loading ? "Verifying..." : "Verify Email"}
                </button>

                <button type="button" onClick={resend} className="mt-5 w-full text-sm font-bold text-[#087F5B]">
                    Resend OTP
                </button>
            </form>
        </main>
    );
}

export default function VerifyOTPPage() {
    return (
        <Suspense fallback={<p className="p-6">Loading...</p>}>
            <VerifyOTPForm />
        </Suspense>
    );
}