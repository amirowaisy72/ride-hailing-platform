"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { ArrowRight } from "lucide-react";
import { BRAND } from "@/config/brand";
import RouteHeroCard from "@/components/landing/RouteHeroCard";
import SafarLoader from "@/components/SafarLoader";

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
      <SafarLoader
        label={user ? "Taking you to your ride" : "Getting your ride ready"}
      />
    );
  }

  return (
    <main className="relative flex h-dvh flex-col overflow-hidden bg-pd-bg text-pd-text">
      <div className="mx-auto flex h-full w-full max-w-md flex-col">
        <header className="flex items-center gap-2.5 px-6 pt-[max(24px,env(safe-area-inset-top))]">
          <img
            src="/safar-icon.png"
            alt=""
            className="h-10 w-10 shrink-0 rounded-xl object-cover shadow-pd"
          />
          <span className="text-lg font-bold tracking-tight">
            {BRAND.name}
          </span>
        </header>

        <section className="flex min-h-0 flex-1 flex-col justify-center gap-6 overflow-y-auto px-6 py-5 pd-no-scrollbar">
          <RouteHeroCard />

          <div
            className="pd-rise flex flex-col gap-3"
            style={{ animationDelay: "80ms" }}
          >
            <span className="flex w-fit items-center gap-2 rounded-full border border-pd-line bg-pd-surface px-3 py-1.5 text-[11px] font-bold tracking-[0.14em] text-pd-text-2">
              <span className="h-1.5 w-1.5 rounded-full bg-pd-accent" />
              MOVE SMARTER
            </span>

            <h1 className="text-balance text-[clamp(32px,9vw,42px)] font-extrabold leading-[1.08] tracking-tight">
              Your ride.
              <span className="block text-pd-accent dark:text-pd-accent-text">
                Your choice.
              </span>
            </h1>

            <p className="text-pretty text-base leading-relaxed text-pd-muted">
              Find your ride, choose your fare, and travel
              comfortably with drivers around you.
            </p>
          </div>
        </section>

        <footer
          className="pd-rise flex flex-col gap-4 px-6 pb-[max(24px,env(safe-area-inset-bottom))] pt-2"
          style={{ animationDelay: "160ms" }}
        >
          <Link
            href="/login"
            className="group flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-pd-accent text-base font-bold text-pd-accent-ink shadow-pd transition-transform outline-none focus-visible:ring-2 focus-visible:ring-pd-accent focus-visible:ring-offset-2 focus-visible:ring-offset-pd-bg active:scale-[0.98]"
          >
            Get Started
            <ArrowRight
              className="h-5 w-5 transition-transform group-hover:translate-x-0.5"
              strokeWidth={2.5}
              aria-hidden="true"
            />
          </Link>

          <p className="text-center text-sm text-pd-muted">
            Passenger or driver?{" "}
            <span className="font-semibold text-pd-text-2">
              Sign in to continue.
            </span>
          </p>
        </footer>
      </div>
    </main>
  );
}
