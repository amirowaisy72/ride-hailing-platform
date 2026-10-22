const { getApps, initializeApp, cert } = require("firebase-admin/app");
const { getMessaging } = require("firebase-admin/messaging");

function getFirebaseMessaging() {
    if (!getApps().length) {
        initializeApp({
            credential: cert(
                require("../../secrets/firebase-service-account.json")
            ),
        });
    }

    return getMessaging();
}

module.exports = { getFirebaseMessaging };