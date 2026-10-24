const { getApps, initializeApp, cert } = require("firebase-admin/app");
const { getMessaging } = require("firebase-admin/messaging");
const { getAuth } = require("firebase-admin/auth");

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

function getFirebaseAuth() {
    getFirebaseMessaging();
    return getAuth();
}

module.exports = { getFirebaseMessaging, getFirebaseAuth };