
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
    LayoutDashboard, Users, CarFront, Route, Wallet,
    SlidersHorizontal, ShieldCheck, Menu, X,
    LogOut, ChevronRight, PanelLeftClose,
    Bell, CircleDollarSign, Plug, Flag,
    ShoppingBag, KeyRound,
} from "lucide-react";

import {
    getAdminSession,
    clearAdminSession,
    authenticatedAdminRequest,
} from "@/lib/adminSession";

const navigation = [
    { label: "Overview", href: "/dashboard", icon: LayoutDashboard },
    { label: "Drivers", href: "/dashboard/drivers", icon: CarFront },
    { label: "Vehicles", href: "/dashboard/vehicles", icon: CarFront },
    { label: "Cities", href: "/dashboard/cities", icon: CarFront },
    { label: "Fare Settings", href: "/dashboard/fares", icon: CarFront },
    { label: "Passengers", href: "/dashboard/passengers", icon: Users },
    { label: "Custom Notifications", href: "/dashboard/notifications", icon: Bell },
    { label: "Rides", href: "/dashboard/rides", icon: Route },
    { label: "Parcels", href: "/dashboard/parcels", icon: Route },
    { label: "Buy & Deliver", href: "/dashboard/buy-deliver", icon: ShoppingBag },
    { label: "Rentals", href: "/dashboard/rentals", icon: KeyRound },
    { label: "Complaints", href: "/dashboard/complaints", icon: Flag },
    { label: "Wallets", href: "/dashboard/wallets", icon: Wallet },
    { label: "Settlements", href: "/dashboard/settlements", icon: CircleDollarSign },
    { label: "Commission Settings", href: "/dashboard/commission", icon: SlidersHorizontal },
    { label: "Integrations", href: "/dashboard/integrations", icon: Plug },
    { label: "Payment Gateways", href: "/dashboard/payment-gateways", icon: CircleDollarSign },
    { label: "Bank Transfers", href: "/dashboard/bank-transfers", icon: Wallet },
];

export default function AdminShell({ children, title = "Dashboard" }) {
    const router = useRouter();
    const pathname = usePathname();

    const [session, setSession] = useState(null);
    const [checking, setChecking] = useState(true);
    const [menuOpen, setMenuOpen] = useState(false);

    useEffect(() => {
        let cancelled = false;

        async function verify() {
            const stored = getAdminSession();

            if (!stored) {
                router.replace("/");
                return;
            }

            try {
                const result = await authenticatedAdminRequest("/auth/me");

                if (result.user?.role !== "ADMIN") {
                    throw new Error("Administrator access required");
                }

                if (!cancelled) {
                    setSession({ ...stored, user: result.user });
                }
            } catch {
                clearAdminSession();
                router.replace("/");
            } finally {
                if (!cancelled) setChecking(false);
            }
        }

        verify();

        return () => {
            cancelled = true;
        };
    }, [router]);

    async function logout() {
        const stored = getAdminSession();

        try {
            if (stored?.refreshToken) {
                await authenticatedAdminRequest("/auth/logout", {
                    method: "POST",
                    body: JSON.stringify({
                        refreshToken: stored.refreshToken,
                    }),
                });
            }
        } catch {
            // Local session still needs to be cleared.
        } finally {
            clearAdminSession();
            router.replace("/");
        }
    }

    if (checking || !session) {
        return (
            <main className="flex min-h-screen items-center justify-center bg-[#F4F8F6]">
                <div className="text-center">
                    <ShieldCheck
                        size={38}
                        className="mx-auto animate-pulse text-[#087F5B]"
                    />
                    <p className="mt-4 text-sm font-semibold text-slate-500">
                        Verifying administrator session...
                    </p>
                </div>
            </main>
        );
    }

    return (
        <div className="min-h-screen bg-[#F5F7F6] text-slate-900">
            {menuOpen && (
                <button
                    type="button"
                    aria-label="Close navigation"
                    onClick={() => setMenuOpen(false)}
                    className="fixed inset-0 z-40 bg-black/40 lg:hidden"
                />
            )}

            <aside
                className={`fixed inset-y-0 left-0 z-50 flex w-[270px] flex-col bg-[#102B26] text-white transition-transform lg:translate-x-0 ${menuOpen ? "translate-x-0" : "-translate-x-full"
                    }`}
            >
                <div className="flex h-20 items-center justify-between border-b border-white/10 px-6">
                    <Link href="/dashboard" className="flex items-center gap-3">
                        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#087F5B]">
                            <ShieldCheck size={25} />
                        </div>
                        <div>
                            <p className="text-lg font-extrabold">Ride Platform</p>
                            <p className="text-[11px] text-white/50">
                                ADMIN CONTROL CENTRE
                            </p>
                        </div>
                    </Link>

                    <button
                        type="button"
                        aria-label="Close menu"
                        onClick={() => setMenuOpen(false)}
                        className="lg:hidden"
                    >
                        <X size={22} />
                    </button>
                </div>

                <div className="px-5 pb-2 pt-7 text-[11px] font-bold uppercase tracking-[0.16em] text-white/35">
                    Management
                </div>

                <nav className="flex-1 space-y-1 overflow-y-auto px-3 pb-6">
                    {navigation.map(({ label, href, icon: Icon }) => {
                        const active =
                            pathname === href ||
                            (href !== "/dashboard" && pathname.startsWith(`${href}/`));

                        return (
                            <Link
                                key={href}
                                href={href}
                                onClick={() => setMenuOpen(false)}
                                aria-current={active ? "page" : undefined}
                                className={`flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold transition ${active
                                    ? "bg-[#087F5B] text-white"
                                    : "text-white/65 hover:bg-white/10 hover:text-white"
                                    }`}
                            >
                                <Icon size={19} />
                                <span className="flex-1">{label}</span>
                                {active && <ChevronRight size={15} />}
                            </Link>
                        );
                    })}
                </nav>

                <div className="border-t border-white/10 p-4">
                    <div className="mb-4 flex items-center gap-3 px-2">
                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 font-bold">
                            {(session.user?.firstName || "A").charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                            <p className="truncate text-sm font-bold">
                                {[session.user?.firstName, session.user?.lastName]
                                    .filter(Boolean).join(" ") || "Administrator"}
                            </p>
                            <p className="truncate text-xs text-white/45">
                                {session.user?.email}
                            </p>
                        </div>
                    </div>

                    <button
                        type="button"
                        onClick={logout}
                        className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold text-white/70 hover:bg-red-500/15 hover:text-red-300"
                    >
                        <LogOut size={19} />
                        Sign Out
                    </button>
                </div>
            </aside>

            <div className="min-h-screen lg:pl-[270px]">
                <header className="sticky top-0 z-30 flex h-[76px] items-center justify-between border-b border-slate-200 bg-white px-5 lg:px-8">
                    <div className="flex items-center gap-4">
                        <button
                            type="button"
                            aria-label="Open navigation"
                            onClick={() => setMenuOpen(true)}
                            className="rounded-xl border border-slate-200 p-2 lg:hidden"
                        >
                            <Menu size={22} />
                        </button>

                        <div>
                            <p className="text-xs text-slate-400">
                                Administration / {title}
                            </p>
                            <h1 className="text-xl font-extrabold">{title}</h1>
                        </div>
                    </div>

                    <div className="flex items-center gap-3">
                        <span className="hidden rounded-full bg-emerald-50 px-4 py-2 text-xs font-bold text-[#087F5B] sm:block">
                            Administrator
                        </span>
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-100 font-extrabold text-[#087F5B]">
                            {(session.user?.firstName || "A").charAt(0).toUpperCase()}
                        </div>
                    </div>
                </header>

                <div className="mx-auto max-w-[1500px] p-5 lg:p-8">
                    {children}
                </div>
            </div>
        </div>
    );
}
