"use client";

import { useLanguage } from "@/components/i18n/LanguageProvider";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
    House,
    CarFront,
    History,
    LayoutGrid,
    UserRound,
    Wallet,
} from "lucide-react";

const passengerLinks = [
    { labelKey: "nav.home", href: "/passenger", icon: House },
    { labelKey: "nav.myRides", href: "/passenger/trips", icon: History },
    { labelKey: "nav.account", href: "/passenger/account", icon: UserRound },
];

const driverLinks = [
    { labelKey: "nav.home", href: "/driver", icon: House },
    { labelKey: "nav.trips", href: "/driver/trips", icon: CarFront },
    { labelKey: "nav.services", href: "/driver/services", icon: LayoutGrid },
    { labelKey: "nav.earnings", href: "/driver/earnings", icon: Wallet },
    { labelKey: "nav.account", href: "/driver/account", icon: UserRound },
];

export default function MobileBottomNav({ role }) {
    const { t } = useLanguage();
    const pathname = usePathname();

    const links = role === "DRIVER" ? driverLinks : passengerLinks;

    return (
        <nav
            aria-label={t("nav.main")}
            className="fixed inset-x-0 bottom-0 z-50 border-t border-pd-line bg-pd-elevated pb-[env(safe-area-inset-bottom)] shadow-[0_-4px_25px_rgba(0,0,0,0.06)] backdrop-blur-xl"
        >
            <div className="mx-auto flex h-[68px] max-w-xl items-center justify-around">
                {links.map(({ labelKey, href, icon: Icon, pending }) => {
                    const active =
                        pathname === href ||
                        (labelKey === "nav.services" &&
                            (pathname.startsWith("/driver/services") ||
                                pathname.startsWith("/driver/rentals"))) ||
                        (labelKey === "nav.account" &&
                            pathname.startsWith(`${role === "DRIVER" ? "/driver" : "/passenger"}/profile`));

                    return (
                        <Link
                            key={labelKey}
                            href={pending ? "#" : href}
                            onClick={pending ? (e) => e.preventDefault() : undefined}
                            aria-current={active ? "page" : undefined}
                            className={`flex min-w-0 flex-1 flex-col items-center justify-center gap-1 py-2 text-[11px] font-semibold ${active
                                ? "text-[#087F5B]"
                                : pending
                                    ? "text-pd-faint"
                                    : "text-pd-muted"
                                }`}
                        >
                            <Icon size={21} strokeWidth={active ? 2.5 : 1.8} />
                            <span>{t(labelKey)}</span>
                        </Link>
                    );
                })}
            </div>
        </nav>
    );
}
