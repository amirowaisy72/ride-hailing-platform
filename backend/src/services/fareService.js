const VehiclePricing = require("../models/VehiclePricing");

const calculateSuggestedFare = async (vehicleType, distanceKm) => {
    if (!Number.isFinite(distanceKm) || distanceKm <= 0) {
        throw new Error("Invalid distance");
    }

    const pricing = await VehiclePricing.findOne({
        vehicleType,
        isActive: true,
    });

    if (!pricing) {
        throw new Error("Vehicle pricing unavailable");
    }

    const fare = Math.max(
        pricing.minimumFare,
        pricing.baseFare + distanceKm * pricing.perKmRate
    );

    return {
        vehicleType,
        currency: "PKR",
        distanceKm,
        suggestedFare: Math.ceil(fare),
    };
};

module.exports = { calculateSuggestedFare };