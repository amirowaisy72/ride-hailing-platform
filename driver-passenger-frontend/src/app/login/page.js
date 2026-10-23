"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiRequest } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { BRAND } from "@/config/brand";
import Link from "next/link";

export default function LoginPage() {
    const router = useRouter();
    const { login } = useAuth();

    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [loginStage, setLoginStage] = useState("");

    async function handleSubmit(event) {
        event.preventDefault();
        setError("");
        setSubmitting(true);
        setLoginStage("Connecting to server...");

        try {
            setLoginStage("Authenticating...");
            const data = await apiRequest("/auth/login", {
                method: "POST",
                body: JSON.stringify({ email, password }),
            });

            if (!data.accessToken || !data.refreshToken) {
                throw new Error("Invalid authentication response");
            }

            setLoginStage("Loading profile...");
            const profile = await apiRequest("/auth/me", {
                token: data.accessToken,
            });

            setLoginStage("Saving secure session...");

            if (!["PASSENGER", "DRIVER"].includes(profile.user?.role)) {
                throw new Error("This account cannot access the mobile app");
            }

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
            setError(err.message);
        } finally {
            setSubmitting(false);
        }
    }


    return (
        <main className="flex min-h-dvh flex-col bg-[#F8FAF9] text-[#111827]">
            <header className="px-6 pb-10 pt-12">
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

                <h1 className="text-4xl font-extrabold tracking-tight">
                    Welcome back.
                </h1>
                <p className="mt-3 text-base text-gray-500">
                    Sign in to continue with {BRAND.name}.
                </p>
            </header>

            <section className="flex-1 rounded-t-[36px] bg-white px-6 pb-10 pt-9 shadow-[0_-8px_35px_rgba(0,0,0,0.03)]">
                <form onSubmit={handleSubmit} className="mx-auto max-w-md space-y-6">
                    <div>
                        <label className="mb-2 block text-sm font-semibold">
                            Email address
                        </label>
                        <input
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="Enter your email"
                            autoComplete="email"
                            required
                            className="h-14 w-full rounded-2xl border border-gray-200 bg-[#F8FAF9] px-4 outline-none focus:border-[#087F5B]"
                        />
                    </div>

                    <div>
                        <label className="mb-2 block text-sm font-semibold">
                            Password
                        </label>
                        <input
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="Enter your password"
                            autoComplete="current-password"
                            required
                            className="h-14 w-full rounded-2xl border border-gray-200 bg-[#F8FAF9] px-4 outline-none focus:border-[#087F5B]"
                        />
                    </div>

                    {error && (
                        <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-600">
                            {error}
                        </p>
                    )}

                    <button
                        type="submit"
                        disabled={submitting}
                        className="flex h-14 w-full items-center justify-center rounded-2xl bg-[#087F5B] font-bold text-white shadow-lg shadow-emerald-900/10 disabled:opacity-50"
                    >
                        {submitting ? (loginStage || "Signing in...") : "Sign In →"}
                    </button>

                    <p className="text-center text-sm text-gray-500">
                        Don't have an account?{" "}
                        <Link href="/signup" className="font-bold text-[#087F5B]">
                            Create Account
                        </Link>
                    </p>
                </form>
            </section>
        </main>
    );

}
