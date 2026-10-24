
const express = require("express");
const mongoose = require("mongoose");
const { getSocket } = require("../services/socketService");
const IntegrationSetting = require("../models/IntegrationSetting");
const IntegrationAuditLog = require("../models/IntegrationAuditLog");
const {
    getFirebaseAuth,
    getFirebaseMessaging,
} = require("../services/firebaseService");
const fs = require("fs");
const path = require("path");
const { protect } = require("../middleware/authMiddleware");
const { authorize } = require("../middleware/roleMiddleware");

const router = express.Router();

router.use(protect, authorize("ADMIN"));

router.get("/", (req, res) => {
    let firebaseReady = false;
    let firebaseError = null;

    try {
        getFirebaseAuth();
        firebaseReady = true;
    } catch (error) {
        firebaseError = "Firebase initialization failed";
    }
    const configured = (...keys) =>
        keys.some((key) => Boolean(process.env[key]));

    const integrations = [
        {
            id: "socketio",
            name: "Socket.IO / WebSockets",
            category: "Real-time Communication",
            configured: true,
            healthy: null,
            healthNote: "Local WebSocket server; test connection to verify",
        },
        {
            id: "background-geolocation",
            name: "Background Geolocation",
            category: "Android Location",
            configured: null,
            healthy: null,
            healthNote: "Native plugin; device-level test required",
        },
        {
            id: "github",
            name: "GitHub",
            category: "Source Control",
            configured: null,
            healthy: null,
            healthNote: "Repository connection not checked",
        },
        {
            id: "capacitor",
            name: "Capacitor / Android",
            category: "Mobile Platform",
            configured: null,
            healthy: null,
            healthNote: "Native build status not checked",
        },
        {
            id: "maplibre",
            name: "MapLibre",
            category: "Maps",
            configured: null,
            healthy: null,
            healthNote: "Frontend integration; runtime status not checked",
        },
        {
            id: "search-console",
            name: "Google Search Console",
            category: "Website Verification",
            configured: null,
            healthy: null,
            healthNote: "Website ownership verified; API connectivity not tested",
        },
        {
            id: "osrm",
            name: "OSRM Routing",
            category: "Maps & Routing",
            configured: null,
            healthy: null,
            healthNote: "External connectivity not tested",
        },
        {
            id: "nominatim",
            name: "OpenStreetMap Nominatim",
            category: "Geocoding",
            configured: null,
            healthy: null,
            healthNote: "External connectivity not tested",
        },
        {
            id: "fcm",
            name: "Firebase Cloud Messaging",
            category: "Push Notifications",
            configured: firebaseReady,
            initialized: firebaseReady,
            healthy: null,
            healthNote: firebaseReady
                ? "Firebase initialized; message delivery not tested"
                : firebaseError,
        },
        {
            id: "firebase",
            initialized: firebaseReady,
            healthy: null,
            healthNote: firebaseReady
                ? "Firebase Admin initialized; external connectivity not tested"
                : firebaseError,
            name: "Firebase",
            category: "Authentication & Notifications",
            configured: fs.existsSync(
                process.env.RENDER
                    ? "/etc/secrets/firebase-service-account.json"
                    : path.resolve(__dirname, "../../secrets/firebase-service-account.json")
            ),
        },
        {
            id: "mongodb",
            name: "MongoDB",
            category: "Database",
            configured: true,
            healthy: mongoose.connection.readyState === 1,
        },
        {
            id: "smtp",
            name: "SMTP Email",
            category: "Email & OTP",
            configured: Boolean(
                process.env.SMTP_HOST &&
                process.env.SMTP_USER &&
                process.env.SMTP_PASS &&
                process.env.SMTP_FROM
            ),
        },
        {
            id: "cloudinary",
            name: "Cloudinary",
            category: "File Storage",
            configured: Boolean(
                process.env.CLOUDINARY_CLOUD_NAME &&
                process.env.CLOUDINARY_API_KEY &&
                process.env.CLOUDINARY_API_SECRET
            ),
        },
        {
            id: "google-oauth",
            name: "Google OAuth",
            category: "Authentication",
            configured: firebaseReady,
            initialized: firebaseReady,
            healthy: null,
            healthNote: firebaseReady
                ? "Firebase Admin initialized; Google Sign-In not tested"
                : "Firebase Admin initialization failed",
        },
        {
            id: "render",
            name: "Render",
            category: "Hosting",
            configured: Boolean(process.env.RENDER),
        },
    ];

    res.json({
        success: true,
        integrations,
        checkedAt: new Date().toISOString(),
    });
});

router.get("/settings", async (req, res) => {
    try {
        const saved = await IntegrationSetting.find().lean();

        const keys = [
            "google-login",
            "push-notifications",
            "otp-email",
            "maps-routing",
            "cloudinary-uploads",
        ];

        const settings = keys.map((key) => {
            const record = saved.find((item) => item.key === key);

            return {
                key,
                enabled: record?.enabled ?? true,
            };
        });

        res.json({ success: true, settings });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Unable to load integration settings",
        });
    }
});

router.patch("/settings/:key", async (req, res) => {
    try {
        const allowedKeys = [
            "google-login",
            "push-notifications",
            "otp-email",
            "maps-routing",
            "cloudinary-uploads",
        ];

        const { key } = req.params;
        const { enabled } = req.body || {};

        if (!allowedKeys.includes(key)) {
            return res.status(400).json({
                success: false,
                message: "Invalid integration",
            });
        }

        if (typeof enabled !== "boolean") {
            return res.status(400).json({
                success: false,
                message: "enabled must be boolean",
            });
        }

        const previous = await IntegrationSetting.findOne({ key }).lean();

        const setting = await IntegrationSetting.findOneAndUpdate(
            { key },
            {
                $set: {
                    enabled,
                    updatedBy: req.user._id,
                },
            },
            {
                new: true,
                upsert: true,
                runValidators: true,
            }
        );

        if ((previous?.enabled ?? true) !== enabled) {
            await IntegrationAuditLog.create({
                integration: key,
                action: "TOGGLE",
                previousValue: previous?.enabled ?? true,
                newValue: enabled,
                performedBy: req.user._id,
            });
        }

        return res.json({
            success: true,
            setting: {
                key: setting.key,
                enabled: setting.enabled,
            },
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: "Unable to update integration setting",
        });
    }
});

router.get("/audit-logs", async (req, res) => {
    try {
        const logs = await IntegrationAuditLog.find()
            .sort({ createdAt: -1 })
            .limit(100)
            .populate("performedBy", "firstName lastName email")
            .lean();

        return res.json({
            success: true,
            logs,
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: "Unable to load integration audit logs",
        });
    }
});

router.post("/:id/test", async (req, res) => {
    const { id } = req.params;

    try {
        let healthy = null;
        let message = "Manual verification required";

        if (id === "mongodb") {
            healthy = mongoose.connection.readyState === 1;
            message = healthy ? "MongoDB connected" : "MongoDB disconnected";
        } else if (id === "fcm") {
            getFirebaseMessaging();
            healthy = null;
            message = "Firebase Messaging initialized; actual delivery not tested";
        } else if (id === "firebase" || id === "google-oauth") {
            await getFirebaseAuth().listUsers(1);
            healthy = true;
            message = "Firebase Authentication API reachable";
        } else if (id === "smtp") {
            const nodemailer = require("nodemailer");
            const transporter = nodemailer.createTransport({
                host: process.env.SMTP_HOST,
                port: Number(process.env.SMTP_PORT || 587),
                secure: process.env.SMTP_PORT === "465",
                auth: {
                    user: process.env.SMTP_USER,
                    pass: process.env.SMTP_PASS,
                },
            });

            await transporter.verify();
            healthy = true;
            message = "SMTP connection successful";
        } else if (id === "cloudinary") {
            const cloudinary = require("../integrations/cloudinary/cloudinary");
            await cloudinary.api.ping();
            healthy = true;
            message = "Cloudinary API reachable";
        } else if (id === "nominatim") {
            const response = await fetch(
                "https://nominatim.openstreetmap.org/status.php",
                { signal: AbortSignal.timeout(10000) }
            );

            healthy = response.ok;
            message = healthy
                ? "Nominatim service reachable"
                : "Nominatim connection failed";
        } else if (id === "osrm") {
            const response = await fetch(
                "https://router.project-osrm.org/route/v1/driving/75.8577,30.9000;75.8600,30.9100?overview=false",
                { signal: AbortSignal.timeout(10000) }
            );
            const data = await response.json();
            healthy = response.ok && data.code === "Ok";
            message = healthy ? "Routing service reachable" : "Routing test failed";
        } else if (id === "render") {
            healthy = true;
            message = "Backend API responding";
        } else if (id === "background-geolocation" || id === "capacitor") {
            healthy = null;
            message = "Requires testing on a real Android device";
        } else if (id === "socketio") {
            healthy = Boolean(getSocket());
            message = healthy
                ? "Socket.IO server initialized"
                : "Socket.IO server unavailable";
        } else if (id === "github") {
            const response = await fetch("https://api.github.com", {
                signal: AbortSignal.timeout(10000),
            });
            healthy = response.ok;
            message = healthy
                ? "GitHub public API reachable; repository access not verified"
                : "GitHub API unavailable";
        } else if (id === "maplibre") {
            const response = await fetch("https://unpkg.com/maplibre-gl/dist/maplibre-gl.js", {
                method: "HEAD",
                signal: AbortSignal.timeout(10000),
            });
            healthy = response.ok;
            message = healthy ? "MapLibre CDN reachable" : "MapLibre CDN unavailable";
        }

        return res.json({
            success: true,
            id,
            healthy,
            message,
            checkedAt: new Date().toISOString(),
        });
    } catch (error) {
        return res.status(200).json({
            success: true,
            id,
            healthy: false,
            message: "Connection test failed",
            checkedAt: new Date().toISOString(),
        });
    }
});

module.exports = router;
