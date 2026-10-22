import { Capacitor } from "@capacitor/core";
import { PushNotifications } from "@capacitor/push-notifications";

export async function registerPushNotifications(onToken) {
    if (!Capacitor.isNativePlatform()) return;

    const permission = await PushNotifications.requestPermissions();

    if (permission.receive !== "granted") {
        throw new Error("Notification permission denied");
    }

    await PushNotifications.createChannel({
        id: "ride_alerts",
        name: "Ride & Parcel Alerts",
        description: "Ride requests, offers and trip updates",
        importance: 5,
        visibility: 1,
        sound: "default",
        vibration: true,
    });

    await PushNotifications.removeAllListeners();

    await PushNotifications.addListener("registration", (token) => {
        onToken(token.value);
    });

    await PushNotifications.addListener("registrationError", (error) => {
        console.error("FCM registration failed:", error);
    });

    await PushNotifications.register();
}