const Driver = require("../models/Driver");
const Vehicle = require("../models/Vehicle");

const findNearbyDrivers = async (
    longitude,
    latitude,
    radiusKm = 5,
    vehicleType = null
) => {
    if (
        !Number.isFinite(longitude) ||
        !Number.isFinite(latitude) ||
        Math.abs(longitude) > 180 ||
        Math.abs(latitude) > 90
    ) {
        throw new Error("Invalid coordinates");
    }

    const filter = {
        verificationStatus: "APPROVED",
        isOnline: true,
        isAvailable: true,
        lastLocationUpdate: {
            $gte: new Date(Date.now() - 2 * 60 * 1000),
        },
        currentLocation: {
            $near: {
                $geometry: {
                    type: "Point",
                    coordinates: [longitude, latitude],
                },
                $maxDistance: radiusKm * 1000,
            },
        },
    };

    if (vehicleType) {
        const vehicleIds = await Vehicle.distinct("_id", {
            vehicleType,
            verificationStatus: "APPROVED",
            isActive: true,
        });

        filter.currentVehicleId = { $in: vehicleIds };
    }

    return Driver.find(filter)
        .limit(30)
        .select("_id userId currentLocation rating currentVehicleId");
};

const findDriversWithExpandedRadius = async (
    longitude,
    latitude,
    vehicleType = null
) => {
    for (const radiusKm of [5, 10, 15]) {
        const drivers = await findNearbyDrivers(
            longitude,
            latitude,
            radiusKm,
            vehicleType
        );

        if (drivers.length > 0 || radiusKm === 15) {
            return { drivers, radiusKm };
        }
    }
};

module.exports = {
    findNearbyDrivers,
    findDriversWithExpandedRadius,
};