"use client";

import {
    createContext,
    useContext,
    useEffect,
    useState,
} from "react";

import { apiRequest } from "@/lib/api";
import {
    renewAccessToken,
    invalidateSession,
} from "@/lib/tokenManager";
import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";
import { registerPushNotifications } from "@/lib/pushNotifications";
import {
    saveRefreshToken,
    getRefreshToken,
    removeRefreshToken,
} from "@/lib/sessionStorage";
import {
    connectRealtime,
    disconnectRealtime,
    pauseRealtime,
} from "@/lib/socket";

const AuthContext = createContext(null);


export function AuthProvider({ children }) {
    const [user, setUser] = useState(null);
    const [token, setToken] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let active = true;
        let listenerHandle;

        const handlePaymentUrl = ({ url }) => {
            if (!url || !active) return;

            try {
                const incoming = new URL(url);

                if (
                    incoming.protocol !== "com.ridehailing.app:" ||
                    incoming.hostname !== "driver" ||
                    incoming.pathname !== "/earnings"
                ) return;

                const status = incoming.searchParams.get("paymentStatus");
                const orderId = incoming.searchParams.get("paymentOrderId");

                if (
                    !["success", "failed"].includes(status) ||
                    !/^[a-f0-9]{24}$/i.test(orderId || "")
                ) return;

                window.location.href =
                    `/driver/earnings?paymentStatus=${encodeURIComponent(status)}&paymentOrderId=${encodeURIComponent(orderId)}`;
            } catch {
                // Ignore malformed external URLs.
            }
        };

        App.addListener("appUrlOpen", handlePaymentUrl).then((handle) => {
            if (active) listenerHandle = handle;
            else handle.remove();
        }).catch(() => { });

        App.getLaunchUrl().then((launch) => {
            if (active && launch?.url) {
                handlePaymentUrl({ url: launch.url });
            }
        }).catch(() => { });

        return () => {
            active = false;
            listenerHandle?.remove();
        };
    }, []);

    useEffect(() => {
        let active = true;

        async function restoreSession() {
            try {
                const savedRefresh = await getRefreshToken();

                if (!savedRefresh) return;

                const accessToken = await renewAccessToken();

                const profile = await apiRequest("/auth/me", {
                    token: accessToken,
                });

                if (active) {
                    setToken(accessToken);
                    setUser(profile.user);
                    connectRealtime(accessToken);
                }
            } catch (error) {
                if (active) {
                    console.error(
                        "Session restoration failed:",
                        error.message
                    );
                }
            } finally {
                if (active) setLoading(false);
            }
        }

        restoreSession();

        return () => {
            active = false;
        };
    }, []);

    useEffect(() => {
        const handleTokenRenewed = (event) => {
            const newToken = event.detail?.accessToken;

            if (newToken) {
                setToken(newToken);
            }
        };

        window.addEventListener("auth:token-renewed", handleTokenRenewed);

        return () => {
            window.removeEventListener("auth:token-renewed", handleTokenRenewed);
        };
    }, []);

    useEffect(() => {
        if (!Capacitor.isNativePlatform()) return;

        let listener;
        let cancelled = false;

        App.addListener("appStateChange", async ({ isActive }) => {
            if (!isActive) {
                pauseRealtime();
                return;
            }

            try {
                const newToken = await renewAccessToken();

                if (!cancelled) {
                    setToken(newToken);
                    // renewAccessToken also updates and reconnects Socket.IO.
                }
            } catch (error) {
                console.error("App resume authentication failed:", error.message);
            }
        }).then((handle) => {
            if (cancelled) {
                handle.remove();
            } else {
                listener = handle;
            }
        });

        return () => {
            cancelled = true;
            listener?.remove();
        };
    }, []);

    useEffect(() => {
        if (!token || !Capacitor.isNativePlatform()) return;

        registerPushNotifications(async (fcmToken) => {
            try {
                await apiRequest("/account/push-device", {
                    method: "POST",
                    token,
                    body: JSON.stringify({
                        token: fcmToken,
                        platform: Capacitor.getPlatform(),
                    }),
                });

                console.log("FCM device registered with backend");
            } catch (error) {
                console.error("FCM device save failed:", error);
            }
        }).catch((error) => {
            console.error("Push registration:", error.message);
        });
    }, [token]);

    const login = async (accessToken, userData, refreshToken) => {
        invalidateSession();
        if (!refreshToken) {
            throw new Error("Refresh token is required");
        }

        await saveRefreshToken(refreshToken);

        setToken(accessToken);
        setUser(userData);
        connectRealtime(accessToken);
    };

    const switchMode = async (mode) => {
        if (!token) throw new Error("Login required");

        const result = await apiRequest("/account/me/mode", {
            method: "PATCH",
            token,
            body: JSON.stringify({ mode }),
        });

        setUser((previous) => ({
            ...previous,
            activeMode: result.activeMode,
        }));

        return result;
    };

    const logout = async () => {
        invalidateSession();
        let refreshToken = null;

        try {
            refreshToken = await getRefreshToken();
            await removeRefreshToken();
        } catch (error) {
            console.error("Token storage cleanup failed:", error.message);
        }
        disconnectRealtime();
        setToken(null);
        setUser(null);

        if (refreshToken) {
            try {
                await apiRequest("/auth/logout", {
                    method: "POST",
                    body: JSON.stringify({ refreshToken }),
                });
            } catch (error) {
                console.error("Server logout failed:", error.message);
            }
        }
    };

    return (
        <AuthContext.Provider
            value={{ user, token, loading, login, logout, switchMode }}
        >
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const context = useContext(AuthContext);

    if (!context) {
        throw new Error("useAuth must be used within AuthProvider");
    }

    return context;
}
