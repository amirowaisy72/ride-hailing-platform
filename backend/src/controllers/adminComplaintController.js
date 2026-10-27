const Complaint = require("../models/Complaint");

const STATUSES = ["OPEN", "IN_REVIEW", "RESOLVED", "REJECTED"];

const POPULATE = [
    { path: "complainant", select: "firstName lastName email role" },
    { path: "againstUser", select: "firstName lastName email role" },
    { path: "ride", select: "vehicleType status createdAt" },
    { path: "parcelOrder", select: "vehicleType status createdAt" },
];

async function listComplaints(req, res) {
    try {
        const filter = {};

        if (req.query.status) {
            if (!STATUSES.includes(req.query.status)) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid complaint status",
                });
            }
            filter.status = req.query.status;
        }

        const page = Math.max(1, parseInt(req.query.page, 10) || 1);
        const limit = 20;

        const [complaints, total] = await Promise.all([
            Complaint.find(filter)
                .populate(POPULATE)
                .sort({ createdAt: -1 })
                .skip((page - 1) * limit)
                .limit(limit)
                .lean(),
            Complaint.countDocuments(filter),
        ]);

        return res.json({
            success: true,
            complaints,
            total,
            page,
            totalPages: Math.ceil(total / limit),
        });
    } catch (error) {
        console.error("Admin complaints error:", error.message);
        return res.status(500).json({
            success: false,
            message: "Failed to load complaints",
        });
    }
}

async function updateComplaint(req, res) {
    try {
        const { status, adminNote } = req.body || {};
        const updates = {};

        if (status !== undefined) {
            if (!STATUSES.includes(status)) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid complaint status",
                });
            }
            updates.status = status;
        }

        if (adminNote !== undefined) {
            const note = String(adminNote || "").trim();
            if (note.length > 1000) {
                return res.status(400).json({
                    success: false,
                    message: "Admin note must be 1000 characters or fewer",
                });
            }
            updates.adminNote = note;
        }

        if (Object.keys(updates).length === 0) {
            return res.status(400).json({
                success: false,
                message: "Nothing to update",
            });
        }

        const complaint = await Complaint.findByIdAndUpdate(
            req.params.id,
            updates,
            { new: true }
        )
            .populate(POPULATE)
            .lean();

        if (!complaint) {
            return res.status(404).json({
                success: false,
                message: "Complaint not found",
            });
        }

        return res.json({ success: true, complaint });
    } catch (error) {
        console.error("Admin complaint update error:", error.message);
        return res.status(500).json({
            success: false,
            message: "Failed to update complaint",
        });
    }
}

module.exports = { listComplaints, updateComplaint };
