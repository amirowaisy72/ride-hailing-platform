const express = require("express");
const ParcelOrder = require("../models/ParcelOrder");
const { protect } = require("../middleware/authMiddleware");
const { authorize } = require("../middleware/roleMiddleware");

const router = express.Router();

router.use(protect, authorize("ADMIN"));

router.get("/", async (req, res) => {
    try {
        const allowedStatuses = [
            "REQUESTED",
            "DRIVER_ASSIGNED",
            "DRIVER_EN_ROUTE",
            "ARRIVED_AT_PICKUP",
            "PICKED_UP",
            "OUT_FOR_DELIVERY",
            "DELIVERED",
            "CANCELLED",
            "FAILED",
        ];

        const filter = {};

        if (req.query.status) {
            if (!allowedStatuses.includes(req.query.status)) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid parcel status",
                });
            }
            filter.status = req.query.status;
        }

        const page = Math.max(1, parseInt(req.query.page, 10) || 1);
        const limit = 20;

        const [orders, total] = await Promise.all([
            ParcelOrder.find(filter)
                .select("-pickupOtpHash -deliveryOtpHash")
                .populate("driverId", "userId verificationStatus")
                .sort({ createdAt: -1 })
                .skip((page - 1) * limit)
                .limit(limit)
                .lean(),
            ParcelOrder.countDocuments(filter),
        ]);

        return res.json({
            success: true,
            orders,
            total,
            page,
            totalPages: Math.ceil(total / limit),
        });
    } catch (error) {
        console.error("Admin parcels error:", error.message);
        return res.status(500).json({
            success: false,
            message: "Failed to load parcel orders",
        });
    }
});

module.exports = router;