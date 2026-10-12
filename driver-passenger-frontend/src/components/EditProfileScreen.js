"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
    ArrowLeft,
    CheckCircle2,
    Mail,
    Save,
    ShieldCheck,
    UserRound,
} from "lucide-react";

import { useAuth } from "@/context/AuthContext";
import { apiRequest } from "@/lib/api";

export default function EditProfileScreen({ role }) {
    const { token } = useAuth();

    const backPath = role === "DRIVER"
        ? "/driver/account"
        : "/passenger/account";

    const [profile, setProfile] = useState(null);
    const [firstName, setFirstName] = useState("");
    const [lastName, setLastName] = useState("");
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState("");
    const [error, setError] = useState("");

    useEffect(() => {
        if (!token) return;

        let cancelled = false;

        apiRequest("/account/me", { token })
            .then((data) => {
                if (cancelled) return;

                setProfile(data.user);
                setFirstName(data.user?.firstName || "");
                setLastName(data.user?.lastName || "");
            })
            .catch((err) => {
                if (!cancelled) setError(err.message);
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [token]);

    async function saveProfile(event) {
        event.preventDefault();

        if (saving) return;

        const first = firstName.trim();
        const last = lastName.trim();

        if (!first || !last || first.length > 80 || last.length > 80) {
            setError("First and last names must be 1–80 characters.");
            return;
        }

        setSaving(true);
        setError("");
        setMessage("");

        try {
            const result = await apiRequest("/account/me", {
                method: "PATCH",
                token,
                body: JSON.stringify({
                    firstName: first,
                    lastName: last,
                }),
            });

            setProfile(result.user);
            setFirstName(result.user.firstName || "");
            setLastName(result.user.lastName || "");
            setMessage("Profile updated successfully.");
        } catch (err) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    }

    return (
        <main className="min-h-dvh bg-[#F8FAF9] pb-10 text-slate-900">
            <header className="bg-[#087F5B] px-5 pb-24 pt-[max(24px,env(safe-area-inset-top))] text-white">
                <div className="mx-auto flex max-w-xl items-center gap-4">
                    <Link
                        href={backPath}
                        aria-label="Back to account"
                        className="rounded-xl bg-white/15 p-3"
                    >
                        <ArrowLeft size={20} />
                    </Link>

                    <h1 className="text-lg font-bold">Edit Profile</h1>
                </div>

                <div className="mx-auto mt-8 max-w-xl">
                    <p className="text-sm text-white/75">Personal Information</p>
                    <h2 className="mt-1 text-3xl font-extrabold">
                        My Details
                    </h2>
                </div>
            </header>

            <div className="mx-auto -mt-16 max-w-xl px-4">
                <section className="rounded-[28px] bg-white p-6 shadow-lg shadow-slate-900/5">
                    {loading ? (
                        <p className="py-8 text-center text-sm text-slate-500">
                            Loading profile...
                        </p>
                    ) : !profile ? (
                        <p role="alert" className="text-sm text-red-600">
                            {error || "Unable to load profile."}
                        </p>
                    ) : (
                        <form onSubmit={saveProfile} className="space-y-5">
                            <div className="flex flex-col items-center border-b pb-6">
                                <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-emerald-100 text-[#087F5B]">
                                    <UserRound size={40} />
                                </div>

                                <h3 className="mt-3 text-lg font-extrabold">
                                    {[profile.firstName, profile.lastName]
                                        .filter(Boolean)
                                        .join(" ") || profile.name || "Account"}
                                </h3>

                                <p className="mt-1 flex items-center gap-1 text-xs font-semibold text-[#087F5B]">
                                    <ShieldCheck size={14} />
                                    {role === "DRIVER"
                                        ? "Driver Account"
                                        : "Passenger Account"}
                                </p>
                            </div>

                            <div>
                                <label
                                    htmlFor="firstName"
                                    className="mb-2 block text-sm font-bold"
                                >
                                    First Name
                                </label>

                                <input
                                    id="firstName"
                                    value={firstName}
                                    maxLength={80}
                                    onChange={(e) => setFirstName(e.target.value)}
                                    autoComplete="given-name"
                                    required
                                    disabled={saving}
                                    className="h-13 w-full rounded-xl border border-slate-200 px-4 py-3 outline-none focus:border-[#087F5B]"
                                    placeholder="Enter first name"
                                />
                            </div>

                            <div>
                                <label
                                    htmlFor="lastName"
                                    className="mb-2 block text-sm font-bold"
                                >
                                    Last Name
                                </label>

                                <input
                                    id="lastName"
                                    value={lastName}
                                    maxLength={80}
                                    onChange={(e) => setLastName(e.target.value)}
                                    autoComplete="family-name"
                                    required
                                    disabled={saving}
                                    className="w-full rounded-xl border border-slate-200 px-4 py-3 outline-none focus:border-[#087F5B]"
                                    placeholder="Enter last name"
                                />
                            </div>

                            <div>
                                <label className="mb-2 block text-sm font-bold">
                                    Email Address
                                </label>

                                <div className="flex min-h-12 items-center gap-3 rounded-xl bg-slate-50 px-4">
                                    <Mail size={18} className="text-slate-400" />
                                    <span className="min-w-0 truncate text-sm text-slate-600">
                                        {profile.email}
                                    </span>
                                </div>

                                <p className="mt-2 text-xs text-slate-500">
                                    Email changes require a separate verification process.
                                </p>
                            </div>

                            {error && (
                                <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-600">
                                    {error}
                                </p>
                            )}

                            {message && (
                                <p role="status" className="flex items-center gap-2 rounded-xl bg-emerald-50 p-3 text-sm text-[#065F46]">
                                    <CheckCircle2 size={18} />
                                    {message}
                                </p>
                            )}

                            <button
                                type="submit"
                                disabled={saving}
                                className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-[#087F5B] font-bold text-white disabled:opacity-50"
                            >
                                <Save size={19} />
                                {saving ? "Saving Changes..." : "Save Changes"}
                            </button>
                        </form>
                    )}
                </section>
            </div>
        </main>
    );
}
