const Feedback = require("../models/Feedback");

const STATUSES = ["NEW", "REVIEWED"];

const POPULATE = [
    { path: "user", select: "firstName lastName email role" },
];

async function listFeedback(req, res) {
    try {
        const filter = {};

        if (req.query.status) {
            if (!STATUSES.includes(req.query.status)) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid feedback status",
                });
            }
            filter.status = req.query.status;
        }

        if (req.query.category) {
            filter.category = req.query.category;
        }

        const page = Math.max(1, parseInt(req.query.page, 10) || 1);
        const limit = 20;

        const [feedback, total] = await Promise.all([
            Feedback.find(filter)
                .populate(POPULATE)
                .sort({ createdAt: -1 })
                .skip((page - 1) * limit)
                .limit(limit)
                .lean(),
            Feedback.countDocuments(filter),
        ]);

        return res.json({
            success: true,
            feedback,
            total,
            page,
            totalPages: Math.ceil(total / limit),
        });
    } catch (error) {
        console.error("Admin feedback error:", error.message);
        return res.status(500).json({
            success: false,
            message: "Failed to load feedback",
        });
    }
}

async function updateFeedback(req, res) {
    try {
        const { status } = req.body || {};
        const updates = {};

        if (status !== undefined) {
            if (!STATUSES.includes(status)) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid feedback status",
                });
            }
            updates.status = status;
        }

        if (Object.keys(updates).length === 0) {
            return res.status(400).json({
                success: false,
                message: "Nothing to update",
            });
        }

        const feedback = await Feedback.findByIdAndUpdate(
            req.params.id,
            updates,
            { new: true }
        )
            .populate(POPULATE)
            .lean();

        if (!feedback) {
            return res.status(404).json({
                success: false,
                message: "Feedback not found",
            });
        }

        return res.json({ success: true, feedback });
    } catch (error) {
        console.error("Admin feedback update error:", error.message);
        return res.status(500).json({
            success: false,
            message: "Failed to update feedback",
        });
    }
}

module.exports = { listFeedback, updateFeedback };
