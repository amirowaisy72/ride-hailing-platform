const { getApps, initializeApp, cert } = require("firebase-admin/app");
const { getMessaging } = require("firebase-admin/messaging");

function getFirebaseMessaging() {
    if (!getApps().length) {
        initializeApp({
            credential: cert(
                require(process.env.RENDER
                    ? "/etc/secrets/firebase-service-account.json"
                    : "../../secrets/firebase-service-account.json")
            ),
        });
    }

    return getMessaging();
}

module.exports = { getFirebaseMessaging };