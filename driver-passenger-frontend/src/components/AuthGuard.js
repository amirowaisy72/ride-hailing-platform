"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";

export default function AuthGuard({ role, children }) {
    const { user, loading } = useAuth();
    const router = useRouter();

    useEffect(() => {
        if (!loading && (!user || (user.activeMode || "PASSENGER") !== role)) {
            router.replace("/login");
        }
    }, [user, loading, role, router]);

    if (loading || !user || (user.activeMode || "PASSENGER") !== role) {
        return (
            <div className="flex min-h-screen items-center justify-center">
                Loading...
            </div>
        );
    }

    return children;
}
