
const {
    findDriversWithExpandedRadius,
} = require("../services/driverMatchingService");

const getNearbyDrivers = async (req, res) => {
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
                message: "Latitude and longitude required",
            });
        }

        const lat = Number(latitude);
        const lng = Number(longitude);

        if (
            !Number.isFinite(lat) ||
            !Number.isFinite(lng) ||
            Math.abs(lat) > 90 ||
            Math.abs(lng) > 180
        ) {
            return res.status(400).json({
                success: false,
                message: "Invalid coordinates",
            });
        }

        const { drivers, radiusKm } =
            await findDriversWithExpandedRadius(lng, lat);

        return res.json({
            success: true,
            count: drivers.length,
            radiusKm,
            drivers,
        });
    } catch (error) {
        console.error("Driver matching error:", error.message);

        return res.status(500).json({
            success: false,
            message: "Failed to find nearby drivers",
        });
    }
};

module.exports = { getNearbyDrivers };
