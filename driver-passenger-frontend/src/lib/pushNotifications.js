import { Capacitor } from "@capacitor/core";
import { PushNotifications } from "@capacitor/push-notifications";

export async function registerPushNotifications(onToken, onAction) {
    if (!Capacitor.isNativePlatform()) return;

    const permission = await PushNotifications.requestPermissions();

    if (permission.receive !== "granted") {
        throw new Error("Notification permission denied");
    }

    await PushNotifications.createChannel({
        id: "ride_alerts_v2",
        name: "Ride & Parcel Alerts",
        description: "Ride requests, offers and trip updates",
        importance: 5,
        visibility: 1,
        sound: "ride_alert.wav",
        vibration: true,
    });

    await PushNotifications.removeAllListeners();

    await PushNotifications.addListener("registration", (token) => {
        onToken(token.value);
    });

    await PushNotifications.addListener("registrationError", (error) => {
        console.error("FCM registration failed:", error);
    });

    // T-17: a tap on a push (e.g. a chat message that arrived while
    // the app was closed) hands its data payload to the app, which
    // routes straight to the relevant screen/chat.
    if (onAction) {
        await PushNotifications.addListener(
            "pushNotificationActionPerformed",
            (action) => {
                const data = action?.notification?.data || {};
                try {
                    onAction(data);
                } catch (error) {
                    console.error("Push action handling failed:", error);
                }
            }
        );
    }

    await PushNotifications.register();
}