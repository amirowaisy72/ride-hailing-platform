"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { BRAND } from "@/config/brand";

export default function Home() {
  const router = useRouter();
  const { user, loading } = useAuth();

  useEffect(() => {
    if (loading || !user) return;

    router.replace(
      user.activeMode === "DRIVER"
        ? "/driver"
        : "/passenger"
    );
  }, [user, loading, router]);

  if (loading || user) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-pd-bg">
        <p className="text-sm font-semibold text-[#087F5B]">
          Loading account...
        </p>
      </main>
    );
  }

  return (
    <main className="relative flex h-dvh flex-col overflow-hidden bg-pd-bg text-pd-text">
      <header className="flex items-center gap-1.5 px-6 pt-8">
        <img
          src="/safar-icon.png"
          alt="Safar"
          className="h-15 w-15 shrink-0 rounded-2xl object-cover"
        />
        <span className="text-xl font-bold tracking-tight">
          {BRAND.name}
        </span>
      </header>

      <section className="flex min-h-0 flex-1 flex-col justify-evenly px-7 py-3">
        <div className="relative mx-auto mb-3 flex h-[clamp(140px,30dvh,260px)] w-full max-w-sm shrink items-center justify-center overflow-hidden rounded-[36px] bg-gradient-to-br from-[#D1FAE5] via-[#E8F7EF] to-white">
          <div className="absolute left-[-20%] top-[30%] h-24 w-[150%] rotate-[-28deg] border-y-[14px] border-white/80" />
          <div className="absolute left-[40%] top-[-20%] h-[150%] w-20 rotate-[33deg] border-x-[12px] border-white/80" />

          <div className="absolute left-10 top-12 flex h-12 w-12 items-center justify-center rounded-2xl bg-pd-surface text-2xl shadow-lg">
            📍
          </div>

          <div className="absolute bottom-10 right-9 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#087F5B] text-3xl text-white shadow-xl">
            🚘
          </div>

          <div className="relative z-10 rounded-2xl border border-white/80 bg-pd-elevated px-6 py-4 text-center shadow-xl">
            <div className="mb-1 text-sm font-semibold text-[#087F5B]">
              YOUR CITY, YOUR WAY
            </div>
            <div className="text-sm text-pd-muted">
              Easy rides. Better journeys.
            </div>
          </div>
        </div>

        <span className="mb-2 w-fit rounded-full !bg-[#D1FAE5] px-4 py-2 text-xs font-bold tracking-wide !text-pd-accent-text">
          MOVE SMARTER
        </span>

        <h1 className="max-w-md text-[40px] font-extrabold leading-[1.13] tracking-tight">
          Your ride.
          <span className="block text-[#087F5B]">
            Your choice.
          </span>
        </h1>

        <p className="mt-5 max-w-sm text-base leading-7 text-pd-muted">
          Find your ride, choose your fare, and travel
          comfortably with drivers around you.
        </p>
      </section>

      <footer className="rounded-t-[32px] bg-pd-surface px-6 pb-[max(28px,env(safe-area-inset-bottom))] pt-7 shadow-[0_-10px_40px_rgba(0,0,0,0.04)]">
        <Link
          href="/login"
          className="flex h-14 w-full items-center justify-center rounded-2xl bg-[#087F5B] text-base font-bold text-white shadow-lg shadow-emerald-900/15 active:scale-[0.98]"
        >
          Get Started →
        </Link>

        <p className="mt-5 text-center text-sm text-pd-muted">
          Passenger or driver? Sign in to continue.
        </p>
      </footer>
    </main>
  );
}
