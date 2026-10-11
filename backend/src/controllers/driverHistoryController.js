const Driver = require("../models/Driver");
const Ride = require("../models/Ride");

const getDriverHistory = async (req, res) => {
    try {
        const driver = await Driver.findOne({
            userId: req.user._id,
        });

        if (!driver) {
            return res.status(404).json({
                success: false,
                message: "Driver profile not found",
            });
        }

        const page = Math.max(1, Number(req.query.page) || 1);
        const limit = 10;

        if (!Number.isSafeInteger(page) || page > 100000) {
            return res.status(400).json({
                success: false,
                message: "Invalid page",
            });
        }

        const filter = { driverId: driver._id };

        const [rides, total] = await Promise.all([
            Ride.find(filter)
                .sort({ createdAt: -1 })
                .skip((page - 1) * limit)
                .limit(limit)
                .select(
                    "status vehicleType requestedPrice finalPrice currency distance createdAt completedAt"
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
        return res.status(500).json({
            success: false,
            message: "Unable to load driver history",
        });
    }
};

module.exports = { getDriverHistory };