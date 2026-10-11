
import { apiRequest } from "@/lib/api";
import { updateRealtimeToken } from "@/lib/socket";

import {
    getRefreshToken,
    saveRefreshToken,
} from "@/lib/sessionStorage";

let pendingRefresh = null;
let sessionVersion = 0;

export function invalidateSession() {
    sessionVersion += 1;
    pendingRefresh = null;
}

export function renewAccessToken() {
    if (pendingRefresh) return pendingRefresh;

    const currentVersion = sessionVersion;

    const request = (async () => {
        const refreshToken = await getRefreshToken();

        if (!refreshToken) {
            throw new Error("Session expired");
        }

        const data = await apiRequest("/auth/refresh", {
            method: "POST",
            body: JSON.stringify({ refreshToken }),
        });

        if (!data.accessToken || !data.refreshToken) {
            throw new Error("Invalid refresh response");
        }

        if (currentVersion !== sessionVersion) {
            throw new Error("Session changed during refresh");
        }

        await saveRefreshToken(data.refreshToken);

        if (currentVersion !== sessionVersion) {
            await import("@/lib/sessionStorage").then(
                ({ removeRefreshToken }) => removeRefreshToken()
            );
            throw new Error("Session changed during refresh");
        }

        updateRealtimeToken(data.accessToken);

        if (typeof window !== "undefined") {
            window.dispatchEvent(
                new CustomEvent("auth:token-renewed", {
                    detail: { accessToken: data.accessToken },
                })
            );
        }

        return data.accessToken;
    })();

    pendingRefresh = request;

    request.then(
        () => {
            if (pendingRefresh === request) pendingRefresh = null;
        },
        () => {
            if (pendingRefresh === request) pendingRefresh = null;
        }
    );

    return request;
}
