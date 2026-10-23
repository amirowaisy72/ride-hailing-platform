
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiRequest } from "@/lib/api";

export default function ForgotPasswordPage() {
    const router = useRouter();

    const [step, setStep] = useState(1);
    const [email, setEmail] = useState("");
    const [otp, setOtp] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [message, setMessage] = useState("");

    async function handleSubmit(e) {
        e.preventDefault();
        if (loading) return;

        setLoading(true);
        setError("");
        setMessage("");

        try {
            if (step === 1) {
                await apiRequest("/auth/forgot-password", {
                    method: "POST",
                    body: JSON.stringify({
                        email: email.trim().toLowerCase(),
                    }),
                });

                setStep(2);
                setMessage("If this email is registered, an OTP has been sent.");
            } else {
                if (newPassword !== confirmPassword) {
                    throw new Error("Passwords do not match");
                }

                await apiRequest("/auth/reset-password", {
                    method: "POST",
                    body: JSON.stringify({
                        email: email.trim().toLowerCase(),
                        otp,
                        newPassword,
                    }),
                });

                router.replace("/login");
            }
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }

    return (
        <main className="flex min-h-dvh items-center justify-center bg-[#F8FAF9] px-5 py-10">
            <form
                onSubmit={handleSubmit}
                className="w-full max-w-md space-y-5 rounded-3xl bg-white p-7 shadow-lg"
            >
                <h1 className="text-2xl font-extrabold text-[#111827]">
                    {step === 1 ? "Forgot Password?" : "Reset Password"}
                </h1>

                <p className="text-sm text-gray-500">
                    {step === 1
                        ? "Enter your registered email address."
                        : "Enter the OTP sent to your email and set a new password."}
                </p>

                {step === 1 ? (
                    <input
                        type="email"
                        required
                        autoComplete="email"
                        placeholder="Email address"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="w-full rounded-xl border p-4"
                    />
                ) : (
                    <>
                        <input
                            type="text"
                            inputMode="numeric"
                            pattern="[0-9]{6}"
                            maxLength={6}
                            required
                            placeholder="6-digit OTP"
                            value={otp}
                            onChange={(e) =>
                                setOtp(e.target.value.replace(/\D/g, ""))
                            }
                            className="w-full rounded-xl border p-4"
                        />

                        <input
                            type="password"
                            required
                            minLength={8}
                            autoComplete="new-password"
                            placeholder="New password (minimum 8 characters)"
                            value={newPassword}
                            onChange={(e) => setNewPassword(e.target.value)}
                            className="w-full rounded-xl border p-4"
                        />

                        <input
                            type="password"
                            required
                            minLength={8}
                            autoComplete="new-password"
                            placeholder="Confirm new password"
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                            className="w-full rounded-xl border p-4"
                        />
                    </>
                )}

                {error && (
                    <p className="text-sm text-red-600">{error}</p>
                )}

                {message && (
                    <p className="text-sm text-emerald-700">{message}</p>
                )}

                <button
                    type="submit"
                    disabled={loading}
                    className="w-full rounded-xl bg-[#087F5B] p-4 font-bold text-white disabled:opacity-50"
                >
                    {loading
                        ? "Please wait..."
                        : step === 1
                            ? "Send OTP"
                            : "Reset Password"}
                </button>

                <button
                    type="button"
                    onClick={() => router.push("/login")}
                    className="w-full text-sm font-semibold text-gray-600"
                >
                    Back to Login
                </button>
            </form>
        </main>
    );
}
