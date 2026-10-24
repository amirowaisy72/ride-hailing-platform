
import { initializeApp, getApps, getApp } from "firebase/app";

const firebaseConfig = {
    apiKey: "AIzaSyAlEyfEdxXOCrLRtM8U9Wi9ttjk8sbkBIA",
    authDomain: "ride-hailing-8313f.firebaseapp.com",
    projectId: "ride-hailing-8313f",
    storageBucket: "ride-hailing-8313f.firebasestorage.app",
    messagingSenderId: "366309218630",
    appId: "1:366309218630:web:c4e0971f4175076a83ad47",
    measurementId: "G-4BHGSQYK32",
};

const firebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig);

export default firebaseApp;
