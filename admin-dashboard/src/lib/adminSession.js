import { apiRequest } from "@/lib/api";

const SESSION_KEY = "admin_session";

// The admin session must live in THIS BROWSER until logout:
// localStorage is shared across tabs and survives a browser
// restart, while the old sessionStorage copy died with its tab
// — and every tab held its own copy, so one tab's token
// rotation revoked the other tab's token and the whole token
// family got logged out. That, plus the 15-minute access token,
// is why the dashboard kept asking for login again.
function isValidSession(session) {
    return Boolean(
        session?.accessToken &&
        session?.refreshToken &&
        session?.user?.role === "ADMIN"
    );
}

function readFrom(storage) {
    try {
        const raw = storage.getItem(SESSION_KEY);
        if (!raw) return null;
        const session = JSON.parse(raw);
        return isValidSession(session) ? session : null;
    } catch {
        return null;
    }
}

export function getAdminSession() {
    if (typeof window === "undefined") return null;

    // localStorage first; a leftover sessionStorage copy from
    // before this fix is moved here once, never left behind.
    const stored = readFrom(window.localStorage);
    if (stored) return stored;

    const legacy = readFrom(window.sessionStorage);
    if (legacy) {
        saveAdminSession(legacy);
        return legacy;
    }

    return null;
}

export function saveAdminSession(session) {
    if (typeof window === "undefined") return;
    try {
        window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    } catch {
        // Storage full/blocked: keep the tab-only copy as fallback.
        window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
        return;
    }
    try {
        window.sessionStorage.removeItem(SESSION_KEY);
    } catch {
        // Non-fatal: the localStorage copy is authoritative.
    }
}

export function clearAdminSession() {
    if (typeof window === "undefined") return;
    try {
        window.localStorage.removeItem(SESSION_KEY);
    } catch {
        // Ignore: logout must never fail on storage.
    }
    try {
        window.sessionStorage.removeItem(SESSION_KEY);
    } catch {
        // Ignore.
    }
}

// One in-flight refresh per tab, shared by every request that
// hits a 401 at the same time — two simultaneous refreshes of
// the same token would rotate it twice and revoke the family.
let refreshPromise = null;

async function doRefresh(oldSession) {
    const refreshed = await apiRequest("/auth/refresh", {
        method: "POST",
        body: JSON.stringify({
            refreshToken: oldSession.refreshToken,
        }),
    });

    if (!refreshed.accessToken || !refreshed.refreshToken) {
        throw new Error("Session refresh failed.");
    }

    const newSession = {
        ...oldSession,
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken,
    };

    saveAdminSession(newSession);
    return newSession;
}

async function refreshSession(session) {
    if (!refreshPromise) {
        refreshPromise = doRefresh(session).finally(() => {
            refreshPromise = null;
        });
    }

    try {
        return await refreshPromise;
    } catch (error) {
        // Another tab may have rotated already: retry once with
        // the newer token now in storage instead of logging out.
        const current = getAdminSession();
        if (current && current.refreshToken !== session.refreshToken) {
            return doRefresh(current);
        }
        throw error;
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
            refreshed = await refreshSession(session);
        } catch {
            clearAdminSession();
            throw new Error("Session expired. Please sign in again.");
        }

        return apiRequest(path, {
            ...options,
            token: refreshed.accessToken,
        });
    }
}
