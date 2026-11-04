"use client";

import useSWR from "swr";
import { useAuth } from "@/context/AuthContext";
import {
    fetchDriverStatus,
    getDriverStatusKey,
} from "@/components/driver/setup/setupData";
import DriverSetupGate from "@/components/driver/setup/DriverSetupGate";
import SafarLoader from "@/components/SafarLoader";

export default function DriverSetupBoundary({ children }) {
    const { user, token, loading: authLoading } = useAuth();
    const shouldCheck = Boolean(user);
    const statusKey = shouldCheck ? getDriverStatusKey(token) : null;
    const {
        data,
        error,
        isLoading,
        mutate,
    } = useSWR(statusKey, fetchDriverStatus, {
        revalidateOnFocus: true,
        shouldRetryOnError: false,
    });

    if (authLoading || !user) return children;

    if (!token) {
        return (
            <SetupStatusMessage
                title="We could not check your driver status"
                message="Please sign in again, then reopen the driver section."
            />
        );
    }

    if (isLoading) {
        return <SafarLoader />;
    }

    if (error?.status === 404) return children;

    if (error || !data?.driver) {
        return (
            <SetupStatusMessage
                title="We could not check your driver status"
                message={error?.message || "Your driver profile could not be loaded."}
                onRetry={() => mutate()}
            />
        );
    }

    const driver = data.driver;
    if (["APPROVED", "SUSPENDED"].includes(driver.verificationStatus)) return children;

    return (
        <DriverSetupGate
            key={user._id || user.id || "driver"}
            token={token}
            userId={user._id || user.id || "driver"}
            driver={driver}
        />
    );
}

function SetupStatusMessage({ title, message, onRetry }) {
    return (
        <main className="flex min-h-dvh flex-col items-center justify-center bg-pd-bg px-6 text-pd-text">
            <section className="w-full max-w-md rounded-3xl border border-pd-line bg-pd-surface p-6 shadow-pd">
                <h1 className="text-balance text-2xl font-extrabold">{title}</h1>
                <p className="mt-2 text-base leading-relaxed text-pd-muted">{message}</p>
                {onRetry && (
                    <button
                        type="button"
                        onClick={() => onRetry()}
                        className="mt-5 flex min-h-12 w-full items-center justify-center rounded-2xl bg-pd-accent px-5 text-base font-extrabold text-pd-accent-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pd-accent"
                    >
                        Try again
                    </button>
                )}
            </section>
        </main>
    );
}
