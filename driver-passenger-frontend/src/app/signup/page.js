"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiRequest } from "@/lib/api";
import { BRAND } from "@/config/brand";

export default function SignupPage() {
    const router = useRouter();
    const [form, setForm] = useState({
        firstName: "",
        lastName: "",
        email: "",
        password: "",
    });
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);

    async function submit(e) {
        e.preventDefault();
        if (loading) return;
        setLoading(true);
        setError("");

        try {
            const email = form.email.trim().toLowerCase();

            await apiRequest("/auth/register", {
                method: "POST",
                body: JSON.stringify({
                    ...form,
                    email,
                    role: "PASSENGER",
                }),
            });

            await apiRequest("/auth/send-otp", {
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
                        {loading ? "Creating Account..." : "Create Account →"}
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