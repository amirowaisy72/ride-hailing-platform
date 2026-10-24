
const express = require("express");
const mongoose = require("mongoose");
const IntegrationSetting = require("../models/IntegrationSetting");
const IntegrationAuditLog = require("../models/IntegrationAuditLog");
const { getFirebaseAuth } = require("../services/firebaseService");
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
            configured: configured(
                "SMTP_HOST",
                "SMTP_USER",
                "EMAIL_USER"
            ),
        },
        {
            id: "cloudinary",
            name: "Cloudinary",
            category: "File Storage",
            configured: configured(
                "CLOUDINARY_CLOUD_NAME"
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

module.exports = router;
