const Driver = require("../models/Driver");
const Vehicle = require("../models/Vehicle");
const ParcelOrder = require("../models/ParcelOrder");

function distanceKm(lat1, lon1, lat2, lon2) {
    const rad = Math.PI / 180;
    const dLat = (lat2 - lat1) * rad;
    const dLon = (lon2 - lon1) * rad;

    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1 * rad) *
        Math.cos(lat2 * rad) *
        Math.sin(dLon / 2) ** 2;

    return 6371 * 2 * Math.atan2(
        Math.sqrt(a),
        Math.sqrt(1 - a)
    );
}

async function parcelDriverEligibility(req, res, next) {
    try {
        const driver = await Driver.findOne({
            userId: req.user._id,
            verificationStatus: "APPROVED",
            isOnline: true,
            isAvailable: true,
        });

        if (!driver) {
            return res.status(403).json({
                success: false,
                message: "Approved, online and available driver required",
            });
        }

        const vehicle = await Vehicle.findOne({
            _id: driver.currentVehicleId,
            driverId: driver._id,
            verificationStatus: "APPROVED",
            isActive: true,
        });

        if (!vehicle) {
            return res.status(403).json({
                success: false,
                message: "Approved active vehicle required",
            });
        }

        const coords = driver.currentLocation?.coordinates;

        if (
            !Array.isArray(coords) ||
            coords.length !== 2 ||
            !coords.every(Number.isFinite) ||
            (coords[0] === 0 && coords[1] === 0)
        ) {
            return res.status(403).json({
                success: false,
                message: "Fresh driver GPS location required",
            });
        }

        // Freshness window: 10 minutes. A stale (or never-reported)
        // fix is rejected with the machine-readable code GPS_STALE —
        // the client matches on `code`, not the message text.
        if (
            !driver.lastLocationUpdate ||
            Date.now() - new Date(driver.lastLocationUpdate).getTime() > 600000
        ) {
            return res.status(403).json({
                success: false,
                code: "GPS_STALE",
                message: "Fresh driver GPS location required",
            });
        }

        if (req.params.id) {
            const parcel = await ParcelOrder.findOne({
                _id: req.params.id,
                status: "REQUESTED",
                driverId: null,
            }).select("vehicleType pickup");

            if (!parcel) {
                return res.status(404).json({
                    success: false,
                    message: "Parcel request unavailable",
                });
            }

            if (parcel.vehicleType !== vehicle.vehicleType) {
                return res.status(403).json({
                    success: false,
                    message: "Vehicle type does not match parcel request",
                });
            }

            const pickupCoords = parcel.pickup?.coordinates;

            if (!Array.isArray(pickupCoords) || pickupCoords.length !== 2) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid parcel pickup coordinates",
                });
            }

            if (!pickupCoords.every(Number.isFinite)) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid parcel pickup coordinates",
                });
            }

            const distance = distanceKm(
                coords[1],
                coords[0],
                pickupCoords[1],
                pickupCoords[0]
            );

            if (distance > 15) {
                return res.status(403).json({
                    success: false,
                    message: "Parcel pickup is outside your 15 km service radius",
                });
            }
        }

        req.parcelDriver = driver;
        req.parcelVehicle = vehicle;

        return next();
    } catch (error) {
        console.error("Parcel eligibility error:", error.message);
        return res.status(500).json({
            success: false,
            message: "Driver eligibility verification failed",
        });
    }
}

module.exports = { parcelDriverEligibility };