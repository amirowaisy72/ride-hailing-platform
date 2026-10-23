const express = require("express");
const { protect } = require("../middleware/authMiddleware");
const { authorize } = require("../middleware/roleMiddleware");

const {
    createServiceArea,
    getServiceAreas,
    updateAreaStatus,
} = require("../controllers/serviceAreaController");

const router = express.Router();

const { isLocationSupported } = require("../services/serviceAreaService");

router.get("/check", protect, async (req, res) => {
    try {
        const { latitude, longitude } = req.query;

        if (
            latitude === undefined ||
            longitude === undefined ||
            String(latitude).trim() === "" ||
            String(longitude).trim() === ""
        ) {
            return res.status(400).json({
                success: false,
                message: "Coordinates required",
            });
        }

        const result = await isLocationSupported(
            latitude,
            longitude
        );

        return res.json({
            success: true,
            supported: result.supported,
            city: result.serviceArea?.city || null,
            areaName: result.serviceArea?.name || null,
        });
    } catch {
        return res.status(400).json({
            success: false,
            message: "Invalid coordinates",
        });
    }
});

router.get("/active", protect, async (req, res) => {
    try {
        const ServiceArea = require("../models/ServiceArea");

        const areas = await ServiceArea.find({ active: true })
            .select("name city polygon")
            .lean();

        return res.json({ success: true, areas });
    } catch {
        return res.status(500).json({
            success: false,
            message: "Failed to load active service areas",
        });
    }
});

const LocalAddress = require("../models/LocalAddress");

router.get("/local-addresses/search", protect, async (req, res) => {
    try {
        const q = String(req.query.q || "").trim();
        if (q.length < 3 || q.length > 100) {
            return res.json({ locations: [] });
        }

        const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

        const locations = await LocalAddress.find({
            active: true,
            $or: ["name", "street", "mohalla", "landmark"].map(
                (field) => ({ [field]: { $regex: escaped, $options: "i" } })
            ),
        }).limit(20).lean();

        return res.json({ locations });
    } catch {
        return res.status(500).json({ message: "Address search failed" });
    }
});

router.get("/local-addresses/map", protect, async (req, res) => {
    try {
        const { west, south, east, north } = req.query;
        const bounds = [west, south, east, north].map(Number);

        if (
            bounds.some((n) => !Number.isFinite(n)) ||
            bounds[0] >= bounds[2] ||
            bounds[1] >= bounds[3]
        ) {
            return res.status(400).json({ message: "Invalid map bounds" });
        }

        const addresses = await LocalAddress.find({
            active: true,
            longitude: { $gte: bounds[0], $lte: bounds[2] },
            latitude: { $gte: bounds[1], $lte: bounds[3] },
        })
            .select("name latitude longitude")
            .limit(300)
            .lean();

        return res.json({ success: true, addresses });
    } catch {
        return res.status(500).json({ message: "Unable to load map locations" });
    }
});

router.use(protect, authorize("ADMIN"));

router.post("/local-addresses/resolve-link", async (req, res) => {
    try {
        let url = new URL(req.body.url);

        const allowed = (host) =>
            host === "maps.app.goo.gl" ||
            host === "goo.gl" ||
            host === "google.com" ||
            host.endsWith(".google.com") ||
            host === "maps.google.com";

        for (let i = 0; i < 5; i++) {
            if (url.protocol !== "https:" || !allowed(url.hostname)) {
                return res.status(400).json({ message: "Invalid Google Maps link" });
            }

            const response = await fetch(url.href, {
                method: "GET",
                redirect: "manual",
                signal: AbortSignal.timeout(8000),
            });

            const location = response.headers.get("location");
            if (!location) break;

            url = new URL(location, url);
        }

        const decoded = decodeURIComponent(url.href);
        const match =
            decoded.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/) ||
            decoded.match(/[?&](?:q|ll)=(-?\d+\.\d+),(-?\d+\.\d+)/) ||
            decoded.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);

        if (!match) {
            return res.status(422).json({
                message: "Coordinates not found in this link",
            });
        }

        const latitude = Number(match[1]);
        const longitude = Number(match[2]);

        if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
            return res.status(422).json({ message: "Invalid coordinates" });
        }

        const placeMatch = url.pathname.match(/\/maps\/place\/([^/]+)/);

        let name = "";

        if (placeMatch) {
            name = decodeURIComponent(placeMatch[1])
                .replace(/\+/g, " ")
                .trim();

            if (/^[-\d.,\s]+$/.test(name)) name = "";
        }

        return res.json({ success: true, latitude, longitude, name });
    } catch {
        return res.status(400).json({
            message: "Unable to resolve Google Maps link",
        });
    }
});

router.get("/local-addresses", async (req, res) => {
    try {
        const addresses = await LocalAddress.find()
            .sort({ createdAt: -1 })
            .limit(200)
            .lean();

        return res.json({ success: true, addresses });
    } catch {
        return res.status(500).json({
            message: "Unable to load local addresses"
        });
    }
});

router.delete("/local-addresses/:id", async (req, res) => {
    try {
        const { id } = req.params;

        if (!require("mongoose").isValidObjectId(id)) {
            return res.status(400).json({ message: "Invalid address ID" });
        }

        const address = await LocalAddress.findByIdAndDelete(id);

        if (!address) {
            return res.status(404).json({ message: "Address not found" });
        }

        return res.json({ success: true });
    } catch {
        return res.status(500).json({ message: "Unable to delete address" });
    }
});

router.post("/local-addresses", async (req, res) => {
    try {
        const { name, city, street, mohalla, landmark, latitude, longitude } = req.body;

        const lat = Number(latitude);
        const lng = Number(longitude);

        if (
            typeof name !== "string" || !name.trim() ||
            typeof city !== "string" || !city.trim() ||
            latitude == null || longitude == null ||
            !Number.isFinite(lat) || !Number.isFinite(lng) ||
            Math.abs(lat) > 90 || Math.abs(lng) > 180
        ) {
            return res.status(400).json({ message: "Invalid address details" });
        }

        const escapeRegex = (value) =>
            String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

        const duplicate = await LocalAddress.findOne({
            city: {
                $regex: `^${escapeRegex(city.trim())}$`,
                $options: "i",
            },
            name: {
                $regex: `^${escapeRegex(name.trim())}$`,
                $options: "i",
            },
        });

        if (duplicate) {
            return res.status(409).json({
                message: `Location already exists: ${duplicate.name}`,
            });
        }

        const address = await LocalAddress.create({
            name, city, street, mohalla, landmark,
            latitude: lat, longitude: lng,
        });

        return res.status(201).json({ success: true, address });
    } catch (error) {
        return res.status(400).json({ message: error.message });
    }
});

router.post("/", createServiceArea);
router.get("/", getServiceAreas);
router.patch("/:id/status", updateAreaStatus);

module.exports = router;