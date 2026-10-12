import { Capacitor } from "@capacitor/core";

const REFRESH_KEY = "ride_refresh_token";

async function nativeStorage() {
    const { SecureStoragePlugin } = await import(
        "capacitor-secure-storage-plugin"
    );

    return SecureStoragePlugin;
}

export async function saveRefreshToken(token) {
    if (!token) throw new Error("Refresh token missing");

    if (Capacitor.isNativePlatform()) {
        const storage = await nativeStorage();
        await storage.set({ key: REFRESH_KEY, value: token });
        return;
    }

    window.sessionStorage.setItem(REFRESH_KEY, token);
}

export async function getRefreshToken() {
    if (Capacitor.isNativePlatform()) {
        const storage = await nativeStorage();

        try {
            const result = await storage.get({ key: REFRESH_KEY });
            return result.value;
        } catch {
            return null;
        }
    }

    return window.sessionStorage.getItem(REFRESH_KEY);
}

export async function removeRefreshToken() {
    if (Capacitor.isNativePlatform()) {
        const storage = await nativeStorage();
        await storage.remove({ key: REFRESH_KEY });
        return;
    }

    window.sessionStorage.removeItem(REFRESH_KEY);
}
