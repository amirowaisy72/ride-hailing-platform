"use client";

import Link from "next/link";
import { ArrowLeft, LifeBuoy } from "lucide-react";

import AuthGuard from "@/components/AuthGuard";
import { useAuth } from "@/context/AuthContext";
import { BRAND } from "@/config/brand";
import MobileBottomNav from "@/components/MobileBottomNav";
import ComplaintsSection from "@/components/ComplaintsSection";

export default function DriverComplaintsPage() {
    return (
        <AuthGuard role="DRIVER">
            <ComplaintsScreen />
        </AuthGuard>
    );
}

function ComplaintsScreen() {
    const { token } = useAuth();

    return (
        <main className="driver-subpage min-h-dvh bg-[#F8FAF9] pb-[calc(100px+env(safe-area-inset-bottom))] text-slate-900">
            <MobileBottomNav role="DRIVER" />
            <header className="bg-[#087F5B] px-5 pb-8 pt-[max(24px,env(safe-area-inset-top))] text-white">
                <div className="mx-auto flex max-w-xl items-center justify-between">
                    <Link
                        href="/driver/account"
                        aria-label="Back to account"
                        className="rounded-xl bg-white/15 p-3"
                    >
                        <ArrowLeft size={20} />
                    </Link>
                    <h1 className="font-bold">Help & Complaints</h1>
                    <LifeBuoy size={22} />
                </div>
                <div className="mx-auto mt-8 max-w-xl">
                    <p className="text-sm text-white/75">{BRAND.name}</p>
                    <h2 className="text-3xl font-extrabold">We are here to help</h2>
                    <p className="mt-1 text-sm text-white/75">
                        File a complaint and track how we handle it.
                    </p>
                </div>
            </header>

            <div className="relative z-10 mx-auto mt-4 max-w-xl px-4">
                <ComplaintsSection token={token} role="DRIVER" />
            </div>
        </main>
    );
}
