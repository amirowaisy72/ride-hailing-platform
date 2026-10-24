import { Capacitor } from "@capacitor/core";
import { BackgroundGeolocation } from "@capgo/background-geolocation";
const API_URL = process.env.NEXT_PUBLIC_API_URL;

let running = false;
let starting = false;
let currentToken = "";

export async function startDriverBackgroundGPS(token) {
    if (!Capacitor.isNativePlatform() || !token) return;

    if (running) {
        if (currentToken !== token) {
            await BackgroundGeolocation.updateHeaders({
                headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/json",
                },
            });
            currentToken = token;
        }
        return;
    }

    if (starting) return;
    starting = true;

    try {
        if (!API_URL?.startsWith("https://")) {
            throw new Error("Production HTTPS API URL required for native GPS");
        }

        await BackgroundGeolocation.start(
            {
                backgroundTitle: "Safar - Driver Online",
                backgroundMessage: "Location active to receive nearby ride requests",
                requestPermissions: false,
                stale: false,
                distanceFilter: 0,
                minIntervalMs: 30000,
                url: `${API_URL}/drivers/me/location`,
                headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/json",
                },
            },
            (location, error) => {
                if (error) {
                    console.error("Background GPS:", error.message);
                }
            }
        );

        running = true;
        currentToken = token;
    } finally {
        starting = false;
    }
}

export async function stopDriverBackgroundGPS() {
    if (!Capacitor.isNativePlatform()) return;
    await BackgroundGeolocation.stop();
    running = false;
    currentToken = "";
}