
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
    House,
    CarFront,
    History,
    UserRound,
    Wallet,
} from "lucide-react";

const passengerLinks = [
    { label: "Home", href: "/passenger", icon: House },
    { label: "My Rides", href: "/passenger/trips", icon: History },
    { label: "Account", href: "/passenger/account", icon: UserRound },
];

const driverLinks = [
    { label: "Home", href: "/driver", icon: House },
    { label: "Trips", href: "/driver/trips", icon: CarFront },
    { label: "Earnings", href: "/driver/earnings", icon: Wallet },
    { label: "Account", href: "/driver/account", icon: UserRound },
];

export default function MobileBottomNav({ role }) {
    const pathname = usePathname();

    const links = role === "DRIVER" ? driverLinks : passengerLinks;

    return (
        <nav
            aria-label="Main navigation"
            className="fixed inset-x-0 bottom-0 z-50 border-t border-slate-100 bg-white/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-4px_25px_rgba(0,0,0,0.06)] backdrop-blur-xl"
        >
            <div className="mx-auto flex h-[68px] max-w-xl items-center justify-around">
                {links.map(({ label, href, icon: Icon, pending }) => {
                    const active =
                        pathname === href ||
                        (label === "Account" &&
                            pathname.startsWith(`${role === "DRIVER" ? "/driver" : "/passenger"}/profile`));

                    return (
                        <Link
                            key={label}
                            href={pending ? "#" : href}
                            onClick={pending ? (e) => e.preventDefault() : undefined}
                            aria-current={active ? "page" : undefined}
                            className={`flex min-w-0 flex-1 flex-col items-center justify-center gap-1 py-2 text-[11px] font-semibold ${active
                                ? "text-[#087F5B]"
                                : pending
                                    ? "text-slate-300"
                                    : "text-slate-500"
                                }`}
                        >
                            <Icon size={21} strokeWidth={active ? 2.5 : 1.8} />
                            <span>{label}</span>
                        </Link>
                    );
                })}
            </div>
        </nav>
    );
}
