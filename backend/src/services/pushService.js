const PushDevice = require("../models/PushDevice");
const { getFirebaseMessaging } = require("./firebaseService");

async function sendPushToUser(userId, title, body, data = {}) {
    try {
        const devices = await PushDevice.find({ userId }).lean();
        if (!devices.length) {
            console.log("FCM: No registered device for user", String(userId));
            return;
        }
        console.log("FCM: Registered devices found:", devices.length);

        const tokens = devices.map((device) => device.token);

        const result = await getFirebaseMessaging().sendEachForMulticast({
            tokens,
            notification: { title, body },
            data: Object.fromEntries(
                Object.entries(data).map(([key, value]) => [
                    key,
                    String(value ?? ""),
                ])
            ),
            android: {
                priority: "high",
                notification: {
                    channelId: "ride_alerts",
                    sound: "default",
                },
            },
        });

        const invalidTokens = [];

        result.responses.forEach((response, index) => {
            if (response.success) return;

            console.error("FCM delivery failed:", response.error?.code);

            if (
                [
                    "messaging/registration-token-not-registered",
                    "messaging/invalid-registration-token",
                ].includes(response.error?.code)
            ) {
                invalidTokens.push(tokens[index]);
            }
        });

        if (invalidTokens.length) {
            await PushDevice.deleteMany({
                token: { $in: invalidTokens },
            });
        }
    } catch (error) {
        console.error("Push notification error:", error.message);
    }
}

module.exports = { sendPushToUser };