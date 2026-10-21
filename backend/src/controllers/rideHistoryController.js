
const Ride = require("../models/Ride");

const getMyRideHistory = async (req, res) => {
    try {
        const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
        const limit = 10;

        if (!Number.isSafeInteger(page) || page > 100000) {
            return res.status(400).json({
                success: false,
                message: "Invalid page",
            });
        }

        const filter = { passengerId: req.user._id };

        const [rides, total] = await Promise.all([
            Ride.find(filter)
                .sort({ createdAt: -1 })
                .skip((page - 1) * limit)
                .limit(limit)
                .select(
                    "status vehicleType tripType requestedPrice finalPrice currency distance estimatedDuration createdAt completedAt"
                )
                .lean(),
            Ride.countDocuments(filter),
        ]);

        return res.json({
            success: true,
            rides,
            pagination: {
                page,
                total,
                pages: Math.ceil(total / limit),
            },
        });
    } catch (error) {
        console.error("Ride history error:", error.message);
        return res.status(500).json({
            success: false,
            message: "Unable to load ride history",
        });
    }
};

module.exports = { getMyRideHistory };
