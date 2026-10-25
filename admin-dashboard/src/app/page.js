"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ShieldCheck,
  Mail,
  LockKeyhole,
  ArrowRight,
  LoaderCircle,
} from "lucide-react";
import { apiRequest } from "@/lib/api";

export default function AdminLogin() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleLogin(event) {
    event.preventDefault();
    if (loading) return;

    setLoading(true);
    setError("");

    try {
      const data = await apiRequest("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });

      const accessToken = data.accessToken;
      const refreshToken = data.refreshToken;

      if (!accessToken || !refreshToken) {
        throw new Error("Login response is missing session tokens.");
      }

      const profile = await apiRequest("/auth/me", {
        token: accessToken,
      });

      const user = profile.user;

      if (user?.role !== "ADMIN") {
        throw new Error("This account does not have admin access.");
      }

      sessionStorage.setItem(
        "admin_session",
        JSON.stringify({
          accessToken,
          refreshToken,
          user,
        })
      );

      router.replace("/dashboard");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#F4F8F6] px-5 py-12">
      <div className="text-slate-900 placeholder:text-slate-400 w-full max-w-md">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[#087F5B] text-white shadow-lg shadow-emerald-900/20">
            <ShieldCheck size={34} />
          </div>

          <h1 className="mt-5 text-3xl font-extrabold tracking-tight text-slate-900">
            Admin Portal
          </h1>

          <p className="mt-2 text-sm text-slate-500">
            Ride-Hailing Platform Management
          </p>
        </div>

        <form
          onSubmit={handleLogin}
          className="rounded-[28px] border border-slate-100 bg-white p-7 shadow-xl shadow-slate-900/5"
        >
          <h2 className="text-xl font-extrabold text-slate-900">
            Welcome back
          </h2>

          <p className="mt-2 text-sm text-slate-500">
            Sign in with your administrator account.
          </p>

          <div className="mt-7 space-y-5">
            <div>
              <label
                htmlFor="email"
                className="mb-2 block text-sm font-semibold text-slate-700"
              >
                Email Address
              </label>

              <div className="flex items-center gap-3 rounded-xl border border-slate-200 px-4 focus-within:border-[#087F5B]">
                <Mail size={19} className="text-slate-400" />

                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="username"
                  placeholder="admin@example.com"
                  required
                  className="h-13 min-w-0 flex-1 bg-transparent py-3 text-sm outline-none"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="password"
                className="mb-2 block text-sm font-semibold text-slate-700"
              >
                Password
              </label>

              <div className="flex items-center gap-3 rounded-xl border border-slate-200 px-4 focus-within:border-[#087F5B]">
                <LockKeyhole size={19} className="text-slate-400" />

                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  required
                  className="h-13 min-w-0 flex-1 bg-transparent py-3 text-sm outline-none"
                />
              </div>
            </div>
          </div>

          {error && (
            <p
              role="alert"
              className="mt-5 rounded-xl bg-red-50 p-3 text-sm text-red-600"
            >
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="mt-7 flex h-13 w-full items-center justify-center gap-2 rounded-xl bg-[#087F5B] px-5 py-4 font-bold text-white transition hover:bg-[#066C4D] disabled:opacity-50"
          >
            {loading ? (
              <>
                <LoaderCircle size={19} className="animate-spin" />
                Signing in...
              </>
            ) : (
              <>
                Sign In to Dashboard
                <ArrowRight size={19} />
              </>
            )}
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-slate-400">
          Authorized administrators only
        </p>
      </div>
    </main>
  );
}