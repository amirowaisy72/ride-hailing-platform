const Feedback = require("../models/Feedback");

const CATEGORIES = [
    "APP",
    "RIDE",
    "PARCEL",
    "RENTAL",
    "BUY_DELIVER",
    "PAYMENT",
    "OTHER",
];

// General feedback about the Safar app itself. The role is derived
// from the logged-in user's active mode, exactly like complaints:
// DRIVER mode -> DRIVER, anything else -> PASSENGER. The client
// never supplies the role.
async function createFeedback(req, res) {
    try {
        const message = String(req.body?.message || "").trim();

        if (!message) {
            return res.status(400).json({
                success: false,
                message: "Please write your suggestion first",
            });
        }

        if (message.length > 1000) {
            return res.status(400).json({
                success: false,
                message: "Feedback must be 1000 characters or fewer",
            });
        }

        const category = CATEGORIES.includes(req.body?.category)
            ? req.body.category
            : "APP";

        let rating = null;
        if (req.body?.rating !== undefined && req.body?.rating !== null && req.body?.rating !== "") {
            rating = Number(req.body.rating);
            if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
                return res.status(400).json({
                    success: false,
                    message: "Rating must be between 1 and 5",
                });
            }
        }

        const feedback = await Feedback.create({
            user: req.user._id,
            userRole: req.user.activeMode === "DRIVER" ? "DRIVER" : "PASSENGER",
            category,
            rating,
            message,
        });

        return res.status(201).json({ success: true, feedback });
    } catch (error) {
        console.error("Create feedback error:", error.message);
        return res.status(500).json({
            success: false,
            message: "Unable to send feedback",
        });
    }
}

async function getMyFeedback(req, res) {
    try {
        const feedback = await Feedback.find({ user: req.user._id })
            .sort({ createdAt: -1 })
            .limit(100)
            .lean();

        return res.json({ success: true, feedback });
    } catch (error) {
        console.error("My feedback error:", error.message);
        return res.status(500).json({
            success: false,
            message: "Unable to load feedback",
        });
    }
}

module.exports = { createFeedback, getMyFeedback };
