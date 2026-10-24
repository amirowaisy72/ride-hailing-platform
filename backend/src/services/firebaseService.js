const { getApps, initializeApp, cert } = require("firebase-admin/app");
const { getMessaging } = require("firebase-admin/messaging");
const { getAuth } = require("firebase-admin/auth");
const path = require("path");

function getFirebaseApp() {
    const apps = getApps();

    if (apps.length) return apps[0];

    const serviceAccountPath = process.env.RENDER
        ? "/etc/secrets/firebase-service-account.json"
        : path.resolve(__dirname, "../../secrets/firebase-service-account.json");

    return initializeApp({
        credential: cert(require(serviceAccountPath)),
    });
}

function getFirebaseMessaging() {
    return getMessaging(getFirebaseApp());
}

function getFirebaseAuth() {
    return getAuth(getFirebaseApp());
}

module.exports = {
    getFirebaseMessaging,
    getFirebaseAuth,
};