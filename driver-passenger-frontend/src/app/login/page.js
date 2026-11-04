"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiRequest } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/components/i18n/LanguageProvider";
import { BRAND } from "@/config/brand";
import Link from "next/link";
import "@/lib/firebase";
import { FirebaseAuthentication } from "@capacitor-firebase/authentication";
import { ArrowRight, Lock, Mail } from "lucide-react";
import AuthField from "@/components/auth/AuthField";
import {
    AuthHeader,
    FormError,
    GoogleButton,
    OrDivider,
    PasswordToggle,
    PrimaryButton,
} from "@/components/auth/AuthParts";

export default function LoginPage() {
    const router = useRouter();
    const { login } = useAuth();
    const { t } = useLanguage();

    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [loginStage, setLoginStage] = useState("");
    const [showPassword, setShowPassword] = useState(false);

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


    async function handleGoogleLogin() {
        setError("");
        setSubmitting(true);
        setLoginStage("Signing in with Google...");

        try {
            await FirebaseAuthentication.signInWithGoogle();

            const { token: idToken } =
                await FirebaseAuthentication.getIdToken();

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

            if (!["PASSENGER", "DRIVER"].includes(profile.user?.role)) {
                throw new Error("This account cannot access the app");
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
            setError(err.message || "Google Sign-In failed");
        } finally {
            setSubmitting(false);
        }
    }


    return (
        <main className="flex min-h-dvh flex-col bg-pd-bg text-pd-text">
            <div className="mx-auto flex w-full max-w-md flex-1 flex-col">
                <AuthHeader backHref="/" backLabel="Back to home" />

                <form
                    onSubmit={handleSubmit}
                    className="flex flex-1 flex-col gap-8 px-6 pb-[max(24px,env(safe-area-inset-bottom))] pt-10"
                >
                    <div className="pd-rise flex flex-col gap-3">
                        <h1 className="text-balance text-[clamp(32px,9vw,40px)] font-extrabold leading-[1.08] tracking-tight">
                            {t("auth.welcomeBack")}
                        </h1>
                        <p className="text-pretty text-base leading-relaxed text-pd-muted">
                            {t("auth.signInToContinue", { brand: BRAND.name })}
                        </p>
                    </div>

                    <div
                        className="pd-rise flex flex-col gap-5"
                        style={{ animationDelay: "80ms" }}
                    >
                        <AuthField
                            id="login-email"
                            label={t("auth.emailAddress")}
                            icon={Mail}
                            type="email"
                            inputMode="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder={t("auth.enterEmail")}
                            autoComplete="email"
                            required
                        />

                        <div className="flex flex-col gap-3">
                            <AuthField
                                id="login-password"
                                label={t("auth.password")}
                                icon={Lock}
                                type={showPassword ? "text" : "password"}
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder={t("auth.enterPassword")}
                                autoComplete="current-password"
                                required
                                trailing={
                                    <PasswordToggle
                                        visible={showPassword}
                                        onToggle={() => setShowPassword((v) => !v)}
                                    />
                                }
                            />
                            <Link
                                href="/forgot-password"
                                className="self-end rounded-md text-sm font-semibold text-pd-accent-text outline-none focus-visible:ring-2 focus-visible:ring-pd-accent"
                            >
                                {t("auth.forgotPassword")}
                            </Link>
                        </div>

                        <FormError>{error}</FormError>
                    </div>

                    <div
                        className="pd-rise mt-auto flex flex-col gap-4"
                        style={{ animationDelay: "160ms" }}
                    >
                        <PrimaryButton
                            type="submit"
                            loading={submitting}
                            loadingLabel={loginStage || t("auth.signingIn")}
                        >
                            {t("auth.signIn")}
                            <ArrowRight
                                className="h-5 w-5 transition-transform group-hover:translate-x-0.5"
                                strokeWidth={2.5}
                                aria-hidden="true"
                            />
                        </PrimaryButton>

                        <OrDivider />

                        <GoogleButton onClick={handleGoogleLogin} disabled={submitting}>
                            {t("auth.continueWithGoogle")}
                        </GoogleButton>

                        <p className="pt-2 text-center text-sm text-pd-muted">
                            {t("auth.noAccount")}{" "}
                            <Link
                                href="/signup"
                                className="rounded-md font-bold text-pd-accent-text outline-none focus-visible:ring-2 focus-visible:ring-pd-accent"
                            >
                                {t("auth.createAccount")}
                            </Link>
                        </p>
                    </div>
                </form>
            </div>
        </main>
    );

}
