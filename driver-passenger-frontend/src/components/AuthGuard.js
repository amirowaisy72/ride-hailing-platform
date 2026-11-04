"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import SafarLoader from "@/components/SafarLoader";

// AuthGuard now accepts either a single `role` (existing call sites
// unchanged) or a `roles` array. With neither, it only requires a
// logged-in user. This matters for pages a user can legitimately open
// in more than one mode — e.g. /driver/documents, which a PENDING
// driver must open from their passenger account before they are ever
// approved for DRIVER mode. Previously that page required DRIVER mode
// only, so a pending driver was bounced straight to /login.
export default function AuthGuard({ role, roles, children }) {
    const { user, loading } = useAuth();
    const router = useRouter();

    const allowedRoles = roles || (role ? [role] : null);
    const allowed =
        !allowedRoles ||
        allowedRoles.includes(user?.activeMode || "PASSENGER");

    useEffect(() => {
        if (!loading && (!user || !allowed)) {
            router.replace("/login");
        }
    }, [user, loading, allowed, router]);

    if (loading || !user || !allowed) {
        return <SafarLoader />;
    }

    return children;
}
