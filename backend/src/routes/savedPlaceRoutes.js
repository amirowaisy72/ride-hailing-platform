const express = require("express");
const mongoose = require("mongoose");
const { protect } = require("../middleware/authMiddleware");
const SavedPlace = require("../models/SavedPlace");

const router = express.Router();

router.use(protect);

router.use((req, res, next) => {
    if (req.user.activeMode !== "PASSENGER" &&
        req.user.role !== "PASSENGER") {
        return res.status(403).json({
            success: false,
            message: "Passenger access required",
        });
    }
    next();
});

function validatePlace(body) {
    const type = String(body.type || "").toUpperCase();
    const name = String(body.name || "").trim();
    const address = String(body.address || "").trim();
    const latitude = Number(body.latitude);
    const longitude = Number(body.longitude);

    if (!["HOME", "WORK", "FAVORITE"].includes(type)) {
        return { error: "Invalid place type" };
    }

    if (!name || name.length > 100 || address.length > 300) {
        return { error: "Invalid place name or address" };
    }

    if (
        body.latitude == null ||
        body.longitude == null ||
        !Number.isFinite(latitude) ||
        !Number.isFinite(longitude) ||
        Math.abs(latitude) > 90 ||
        Math.abs(longitude) > 180
    ) {
        return { error: "Invalid coordinates" };
    }

    return {
        place: { type, name, address, latitude, longitude },
    };
}

// GET all saved places
router.get("/", async (req, res) => {
    try {
        const places = await SavedPlace.find({
            userId: req.user._id,
        }).sort({ createdAt: -1 });

        res.json({ success: true, places });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Failed to load saved places",
        });
    }
});

// POST create or replace HOME / WORK
router.post("/", async (req, res) => {
    const { error, place } = validatePlace(req.body);

    if (error) {
        return res.status(400).json({
            success: false,
            message: error,
        });
    }

    try {
        let saved;

        if (place.type === "FAVORITE") {
            const count = await SavedPlace.countDocuments({
                userId: req.user._id,
                type: "FAVORITE",
            });

            if (count >= 30) {
                return res.status(400).json({
                    success: false,
                    message: "Maximum 30 favorite places allowed",
                });
            }

            saved = await SavedPlace.create({
                ...place,
                userId: req.user._id,
            });
        } else {
            saved = await SavedPlace.findOneAndUpdate(
                {
                    userId: req.user._id,
                    type: place.type,
                },
                { $set: place },
                { upsert: true, new: true, runValidators: true }
            );
        }

        res.status(201).json({
            success: true,
            place: saved,
        });
    } catch (error) {
        res.status(error.code === 11000 ? 409 : 500).json({
            success: false,
            message: "Unable to save place",
        });
    }
});

// PATCH edit existing place
router.patch("/:id", async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) {
        return res.status(400).json({
            success: false,
            message: "Invalid place ID",
        });
    }

    try {
        const existing = await SavedPlace.findOne({
            _id: req.params.id,
            userId: req.user._id,
        });

        if (!existing) {
            return res.status(404).json({
                success: false,
                message: "Place not found",
            });
        }

        const { error, place } = validatePlace({
            ...existing.toObject(),
            ...req.body,
            type: existing.type,
        });

        if (error) {
            return res.status(400).json({
                success: false,
                message: error,
            });
        }

        Object.assign(existing, place);
        await existing.save();

        res.json({ success: true, place: existing });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Unable to update place",
        });
    }
});

// DELETE saved place
router.delete("/:id", async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) {
        return res.status(400).json({
            success: false,
            message: "Invalid place ID",
        });
    }

    try {
        const deleted = await SavedPlace.findOneAndDelete({
            _id: req.params.id,
            userId: req.user._id,
        });

        if (!deleted) {
            return res.status(404).json({
                success: false,
                message: "Place not found",
            });
        }

        res.json({
            success: true,
            message: "Saved place deleted",
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Unable to delete place",
        });
    }
});

module.exports = router;