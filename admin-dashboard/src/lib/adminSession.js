
import { apiRequest } from "@/lib/api";

const SESSION_KEY = "admin_session";

export function getAdminSession() {
    if (typeof window === "undefined") return null;

    try {
        const raw = sessionStorage.getItem(SESSION_KEY);
        if (!raw) return null;

        const session = JSON.parse(raw);

        if (
            !session?.accessToken ||
            !session?.refreshToken ||
            session?.user?.role !== "ADMIN"
        ) {
            return null;
        }

        return session;
    } catch {
        return null;
    }
}

export function clearAdminSession() {
    if (typeof window !== "undefined") {
        sessionStorage.removeItem(SESSION_KEY);
    }
}

export async function authenticatedAdminRequest(path, options = {}) {
    const session = getAdminSession();

    if (!session) {
        throw new Error("Admin session expired. Please sign in again.");
    }

    try {
        return await apiRequest(path, {
            ...options,
            token: session.accessToken,
        });
    } catch (error) {
        if (!/401|unauthorized|expired|invalid token/i.test(error.message)) {
            throw error;
        }

        let refreshed;

        try {
            refreshed = await apiRequest("/auth/refresh", {
                method: "POST",
                body: JSON.stringify({
                    refreshToken: session.refreshToken,
                }),
            });
        } catch {
            clearAdminSession();
            throw new Error("Session expired. Please sign in again.");
        }

        if (!refreshed.accessToken || !refreshed.refreshToken) {
            clearAdminSession();
            throw new Error("Session refresh failed.");
        }

        const newSession = {
            ...session,
            accessToken: refreshed.accessToken,
            refreshToken: refreshed.refreshToken,
        };

        sessionStorage.setItem(SESSION_KEY, JSON.stringify(newSession));

        return apiRequest(path, {
            ...options,
            token: newSession.accessToken,
        });
    }
}
