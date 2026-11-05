const Driver = require("../models/Driver");
const Vehicle = require("../models/Vehicle");

// One-way car-tier matching rule (single source of truth):
// A car whose AC works can serve a non-AC request — the
// passenger gets a better car at the non-AC fare they chose.
// A non-AC car — its AC does not work at all — must NEVER
// serve an AC request: that would mislead a passenger who
// asked and paid for AC. Every other type serves only its
// own kind.
const servingVehicleTypes = (requestedType) =>
    requestedType === "CAR_NON_AC"
        ? ["CAR_NON_AC", "CAR_AC"]
        : [requestedType];

// Inverse view for a driver's own vehicle: which ride types
// it may serve.
const servableRideTypes = (vehicleType) =>
    vehicleType === "CAR_AC"
        ? ["CAR_AC", "CAR_NON_AC"]
        : [vehicleType];

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
            vehicleType: { $in: servingVehicleTypes(vehicleType) },
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
    servingVehicleTypes,
    servableRideTypes,
};
