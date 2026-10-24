"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiRequest } from "@/lib/api";
import { BRAND } from "@/config/brand";
import { FirebaseAuthentication } from "@capacitor-firebase/authentication";
import { useAuth } from "@/context/AuthContext";
import "@/lib/firebase";

export default function SignupPage() {
    const router = useRouter();
    const { login } = useAuth();
    const [form, setForm] = useState({
        firstName: "",
        lastName: "",
        email: "",
        password: "",
    });
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);
    const [signupStep, setSignupStep] = useState("");

    async function submit(e) {
        e.preventDefault();
        if (loading) return;
        setLoading(true);
        setError("");

        try {
            const email = form.email.trim().toLowerCase();

            const withTimeout = (promise, step) =>
                Promise.race([
                    promise,
                    new Promise((_, reject) =>
                        setTimeout(
                            () => reject(new Error(`${step} failed: Server did not respond within 20 seconds.`)),
                            20000
                        )
                    ),
                ]);

            setSignupStep("Checking email...");

            await withTimeout(
                apiRequest("/auth/register", {
                    method: "POST",
                    body: JSON.stringify({
                        ...form,
                        email,
                        role: "PASSENGER",
                    }),
                }),
                "Email Check"
            );

            setSignupStep("Sending OTP...");

            await withTimeout(
                apiRequest("/auth/signup/send-otp", {
                    method: "POST",
                    body: JSON.stringify({ email }),
                }),
                "OTP Sending"
            );

            sessionStorage.setItem(
                "safar-pending-signup",
                JSON.stringify({ ...form, email, role: "PASSENGER" })
            );

            router.push(`/verify-otp?email=${encodeURIComponent(email)}`);
            return;

            await apiRequest("/auth/register", {
                method: "POST",
                body: JSON.stringify({
                    ...form,
                    email,
                    role: "PASSENGER",
                }),
            });

            sessionStorage.setItem(
                "safar-pending-signup",
                JSON.stringify({
                    ...form,
                    email,
                    role: "PASSENGER",
                })
            );

            await apiRequest("/auth/signup/send-otp", {
                method: "POST",
                body: JSON.stringify({ email }),
            });

            router.push(`/verify-otp?email=${encodeURIComponent(email)}`);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }


    async function handleGoogleSignup() {
        if (loading) return;

        setError("");
        setLoading(true);
        setSignupStep("Signing in with Google...");

        try {
            await FirebaseAuthentication.signInWithGoogle();

            const { token: idToken } =
                await FirebaseAuthentication.getIdToken();

            if (!idToken) {
                throw new Error("Google ID token missing");
            }

            const data = await apiRequest("/auth/google", {
                method: "POST",
                body: JSON.stringify({ idToken }),
            });

            if (!data.accessToken || !data.refreshToken) {
                throw new Error("Invalid authentication response");
            }

            const profile = await apiRequest("/auth/me", {
                token: data.accessToken,
            });

            await login(
                data.accessToken,
                profile.user,
                data.refreshToken
            );

            router.replace(
                profile.user.activeMode === "DRIVER"
                    ? "/driver"
                    : "/passenger"
            );
        } catch (err) {
            setError(err.message || "Google Sign-In failed");
        } finally {
            setLoading(false);
            setSignupStep("");
        }
    }


    return (
        <main className="min-h-dvh bg-[#F8FAF9] text-[#111827]">
            <header className="px-6 pb-8 pt-12">
                <div className="mb-8 flex items-center gap-2">
                    <img
                        src="/safar-icon.png"
                        alt="Safar logo"
                        className="h-15 w-15 rounded-2xl object-cover"
                    />
                    <span className="text-2xl font-extrabold tracking-tight text-[#111827] dark:text-white">
                        {BRAND.name}
                    </span>
                </div>
                <h1 className="text-4xl font-extrabold">
                    Create Account
                </h1>
                <p className="mt-3 text-gray-500">
                    Start your journey with {BRAND.name}.
                </p>
            </header>

            <section className="rounded-t-[36px] bg-white px-6 py-9">
                <form onSubmit={submit} className="mx-auto max-w-md space-y-4">
                    {[
                        ["firstName", "First Name"],
                        ["lastName", "Last Name"],
                        ["email", "Email Address"],
                        ["password", "Password"],
                    ].map(([key, label]) => (
                        <label key={key} className="block">
                            <span className="mb-2 block text-sm font-semibold">
                                {label}
                            </span>
                            <input
                                type={key === "password" ? "password" : key === "email" ? "email" : "text"}
                                autoComplete={key === "password" ? "new-password" : key}
                                required
                                minLength={key === "password" ? 8 : undefined}
                                maxLength={key === "password" ? 128 : 80}
                                value={form[key]}
                                onChange={(e) => setForm({
                                    ...form,
                                    [key]: e.target.value,
                                })}
                                className="h-14 w-full rounded-2xl border bg-[#F8FAF9] px-4 outline-none focus:border-[#087F5B]"
                            />
                        </label>
                    ))}

                    {error && (
                        <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-600">
                            {error}
                        </p>
                    )}

                    <button
                        disabled={loading}
                        className="h-14 w-full rounded-2xl bg-[#087F5B] font-bold text-white disabled:opacity-50"
                    >
                        {loading ? (signupStep || "Checking...") : "Create Account →"}
                    </button>

                    <button
                        type="button"
                        onClick={handleGoogleSignup}
                        disabled={loading}
                        className="flex h-14 w-full items-center justify-center gap-3 rounded-2xl border border-gray-200 bg-white font-semibold text-gray-800 disabled:opacity-50"
                    >
                        <span className="text-xl font-bold text-[#4285F4]">G</span>
                        Continue with Google
                    </button>

                    <p className="text-center text-sm">
                        Already have an account?{" "}
                        <Link href="/login" className="font-bold text-[#087F5B]">
                            Sign In
                        </Link>
                    </p>
                </form>
            </section>
        </main>
    );
}