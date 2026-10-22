import { Capacitor } from "@capacitor/core";
import { Preferences } from "@capacitor/preferences";

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
        await Preferences.set({ key: REFRESH_KEY, value: token });
        return;
    }

    window.sessionStorage.setItem(REFRESH_KEY, token);
}

export async function getRefreshToken() {
    if (Capacitor.isNativePlatform()) {
        const result = await Preferences.get({ key: REFRESH_KEY });
        return result.value;
    }

    return window.sessionStorage.getItem(REFRESH_KEY);
}

export async function removeRefreshToken() {
    if (Capacitor.isNativePlatform()) {
        await Preferences.remove({ key: REFRESH_KEY });
        return;
    }

    window.sessionStorage.removeItem(REFRESH_KEY);
}
