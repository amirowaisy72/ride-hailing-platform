"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiRequest } from "@/lib/api";
import { BRAND } from "@/config/brand";
import { FirebaseAuthentication } from "@capacitor-firebase/authentication";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/components/i18n/LanguageProvider";
import "@/lib/firebase";

export default function SignupPage() {
    const router = useRouter();
    const { login } = useAuth();
    const { t } = useLanguage();
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
        <main className="min-h-dvh bg-pd-bg text-pd-text">
            <header className="px-6 pb-8 pt-12">
                <div className="mb-8 flex items-center gap-2">
                    <img
                        src="/safar-icon.png"
                        alt="Safar logo"
                        className="h-15 w-15 rounded-2xl object-cover"
                    />
                    <span className="text-2xl font-extrabold tracking-tight text-pd-text dark:text-white">
                        {BRAND.name}
                    </span>
                </div>
                <h1 className="text-4xl font-extrabold">
                    {t("auth.createAccount")}
                </h1>
                <p className="mt-3 text-pd-muted">
                    {t("auth.startJourney", { brand: BRAND.name })}
                </p>
            </header>

            <section className="rounded-t-[36px] bg-pd-surface px-6 py-9">
                <form onSubmit={submit} className="mx-auto max-w-md space-y-4">
                    {[
                        ["firstName", t("auth.firstName")],
                        ["lastName", t("auth.lastName")],
                        ["email", t("auth.emailAddress")],
                        ["password", t("auth.password")],
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
                                className="h-14 w-full rounded-2xl border bg-pd-surface-2 px-4 outline-none focus:border-[#087F5B]"
                            />
                        </label>
                    ))}

                    {error && (
                        <p role="alert" className="rounded-xl bg-pd-danger-soft p-3 text-sm text-pd-danger">
                            {error}
                        </p>
                    )}

                    <button
                        disabled={loading}
                        className="h-14 w-full rounded-2xl bg-[#087F5B] font-bold text-white disabled:opacity-50"
                    >
                        {loading ? (signupStep || t("auth.checking")) : `${t("auth.createAccount")} →`}
                    </button>

                    <button
                        type="button"
                        onClick={handleGoogleSignup}
                        disabled={loading}
                        className="flex h-14 w-full items-center justify-center gap-3 rounded-2xl border border-pd-line bg-pd-surface font-semibold text-pd-text disabled:opacity-50"
                    >
                        <span className="text-xl font-bold text-[#4285F4]">G</span>
                        {t("auth.continueWithGoogle")}
                    </button>

                    <p className="text-center text-sm">
                        {t("auth.alreadyHaveAccount")}{" "}
                        <Link href="/login" className="font-bold text-[#087F5B]">
                            {t("auth.signIn")}
                        </Link>
                    </p>
                </form>
            </section>
        </main>
    );
}