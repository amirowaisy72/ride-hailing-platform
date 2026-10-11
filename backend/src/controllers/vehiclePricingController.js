const VehiclePricing = require("../models/VehiclePricing");
const { calculateSuggestedFare } = require("../services/fareService");

const TYPES = ["BIKE", "RICKSHAW", "CAR_AC", "CAR_NON_AC"];

const getPricing = async (req, res) => {
    try {
        const pricing = await VehiclePricing.find().sort({ vehicleType: 1 });
        res.json({ success: true, pricing });
    } catch {
        res.status(500).json({ success: false, message: "Pricing unavailable" });
    }
};

const updatePricing = async (req, res) => {
    try {
        const { vehicleType } = req.params;
        if (!TYPES.includes(vehicleType)) {
            return res.status(400).json({ success: false, message: "Invalid vehicle type" });
        }

        const { baseFare, perKmRate, minimumFare, isActive } = req.body;

        if (
            [baseFare, perKmRate, minimumFare].some(
                value => typeof value !== "number" || !Number.isFinite(value) || value < 0
            ) ||
            typeof isActive !== "boolean"
        ) {
            return res.status(400).json({ success: false, message: "Invalid pricing values" });
        }

        const pricing = await VehiclePricing.findOneAndUpdate(
            { vehicleType },
            { $set: { baseFare, perKmRate, minimumFare, isActive } },
            { upsert: true, new: true, runValidators: true }
        );

        res.json({ success: true, pricing });
    } catch {
        res.status(500).json({ success: false, message: "Pricing update failed" });
    }
};

const getSuggestedFare = async (req, res) => {
    try {
        const { vehicleType, distanceKm } = req.body;

        if (!TYPES.includes(vehicleType)) {
            return res.status(400).json({ success: false, message: "Invalid vehicle type" });
        }

        const fare = await calculateSuggestedFare(vehicleType, distanceKm);
        res.json({ success: true, fare });
    } catch (error) {
        const invalid = ["Invalid distance", "Vehicle pricing unavailable"].includes(error.message);
        res.status(invalid ? 400 : 500).json({
            success: false,
            message: invalid ? error.message : "Fare calculation failed",
        });
    }
};

module.exports = { getPricing, updatePricing, getSuggestedFare };