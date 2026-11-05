
const Vehicle = require("../models/Vehicle");
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

        // Home-map discovery cells, anonymous like the ride-scoped
        // endpoint (same grid rounding): only drivers with an
        // approved, active current vehicle are shown, with the
        // dominant vehicle type per cell so the map draws the right
        // vehicle. The legacy drivers/count fields below are
        // untouched; cells/onlineDrivers are additive.
        let cells = [];
        let onlineDrivers = 0;
        try {
            const vehicleIds = drivers
                .map((driver) => driver.currentVehicleId)
                .filter(Boolean);
            const vehicles = vehicleIds.length
                ? await Vehicle.find({
                    _id: { $in: vehicleIds },
                    verificationStatus: "APPROVED",
                    isActive: true,
                }).select("_id vehicleType").lean()
                : [];
            const typeByVehicle = new Map(
                vehicles.map((vehicle) => [String(vehicle._id), vehicle.vehicleType])
            );
            const byCell = new Map();
            for (const driver of drivers) {
                const type = typeByVehicle.get(String(driver.currentVehicleId));
                if (!type) continue;
                const [driverLng, driverLat] = driver.currentLocation?.coordinates || [];
                if (!Number.isFinite(driverLng) || !Number.isFinite(driverLat)) continue;
                const latitude = Math.round(driverLat * 200) / 200;
                const longitude = Math.round(driverLng * 200) / 200;
                const key = `${latitude}:${longitude}`;
                const cell = byCell.get(key) || { latitude, longitude, count: 0, types: {} };
                cell.count += 1;
                cell.types[type] = (cell.types[type] || 0) + 1;
                byCell.set(key, cell);
            }
            cells = [...byCell.values()].map((cell) => ({
                latitude: cell.latitude,
                longitude: cell.longitude,
                count: cell.count,
                vehicleType: Object.entries(cell.types).sort((a, b) => b[1] - a[1])[0][0],
            }));
            onlineDrivers = cells.reduce((sum, cell) => sum + cell.count, 0);
        } catch (cellError) {
            console.error("Nearby driver cells:", cellError.message);
        }

        return res.json({
            success: true,
            count: drivers.length,
            radiusKm,
            drivers,
            cells,
            onlineDrivers,
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
