"use client";

import Link from "next/link";
import { ArrowLeft, LifeBuoy } from "lucide-react";

import AuthGuard from "@/components/AuthGuard";
import { useAuth } from "@/context/AuthContext";
import { BRAND } from "@/config/brand";
import MobileBottomNav from "@/components/MobileBottomNav";
import ComplaintsSection from "@/components/ComplaintsSection";

export default function PassengerComplaintsPage() {
    return (
        <AuthGuard role="PASSENGER">
            <ComplaintsScreen />
        </AuthGuard>
    );
}

function ComplaintsScreen() {
    const { token } = useAuth();

    return (
        <main className="min-h-dvh bg-[#F8FAF9] pb-[calc(100px+env(safe-area-inset-bottom))] text-slate-900">
            <MobileBottomNav role="PASSENGER" />
            <header className="bg-[#087F5B] px-5 pb-24 pt-[max(24px,env(safe-area-inset-top))] text-white">
                <div className="mx-auto flex max-w-xl items-center justify-between">
                    <Link
                        href="/passenger/account"
                        aria-label="Back to account"
                        className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/15"
                    >
                        <ArrowLeft size={21} />
                    </Link>

                    <h1 className="text-lg font-bold">Help & Complaints</h1>

                    <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/15">
                        <LifeBuoy size={21} />
                    </div>
                </div>

                <div className="mx-auto mt-8 max-w-xl">
                    <p className="text-sm text-white/75">{BRAND.name}</p>
                    <h2 className="mt-1 text-3xl font-extrabold">
                        We are here to help
                    </h2>
                    <p className="mt-1 text-sm text-white/75">
                        File a complaint and track how we handle it.
                    </p>
                </div>
            </header>

            <div className="mx-auto -mt-16 max-w-xl px-4">
                <ComplaintsSection token={token} role="PASSENGER" />
            </div>
        </main>
    );
}
