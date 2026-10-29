const mongoose = require("mongoose");

// ---------------------------------------------------------------------
// GPS eligibility gate (Phase 8 finding fix).
//
// The realtime trees run without the backend's Mongoose models, so the
// socket location handler cannot require the backend's
// services/eligibilityService. The pure helpers below therefore mirror
// eligibilityService.evaluateServiceEligibility EXACTLY — same status
// derivation, same required-document lists, same vehicle rules — over
// raw driver/vehicle/document records, so both location paths apply
// one and the same eligibility standard (the backend service remains
// the source of truth; backend/tests/locationEligibility.test.js pins
// this mirror to the service's verdicts over a shared fixture matrix).
// ---------------------------------------------------------------------

const LOCATION_SERVICES = ["RIDE", "PARCEL", "BUY_DELIVER"];

const LOCATION_REQUIRED_DOCUMENTS = {
    RIDE: [
        "CNIC_FRONT",
        "CNIC_BACK",
        "DRIVING_LICENSE",
        "VEHICLE_REGISTRATION",
    ],
    PARCEL: [
        "CNIC_FRONT",
        "CNIC_BACK",
        "DRIVING_LICENSE",
        "VEHICLE_REGISTRATION",
    ],
    BUY_DELIVER: [
        "CNIC_FRONT",
        "CNIC_BACK",
        "PROFILE_PHOTO",
        "DRIVING_LICENSE",
        "VEHICLE_REGISTRATION",
    ],
};

const LOCATION_VEHICLE_TYPES_BY_TRANSPORT_MODE = {
    MOTORBIKE: ["BIKE"],
    CAR: ["CAR_AC", "CAR_NON_AC"],
};

function locationServiceRecord(driver, service) {
    const record = driver?.services?.[service] || {};

    return {
        status: record.status || "NOT_APPLIED",
        enabled: record.enabled !== false,
        transportMode: record.transportMode || null,
        policyAcknowledgedAt: record.policyAcknowledgedAt || null,
    };
}

// Mirrors eligibilityService.getEffectiveServiceStatus.
function locationEffectiveServiceStatus(driver, service) {
    const globalStatus = driver?.verificationStatus || "PENDING";

    if (globalStatus === "SUSPENDED") {
        return "SUSPENDED";
    }

    const record = locationServiceRecord(driver, service);

    if (service === "BUY_DELIVER") {
        return record.status;
    }

    if (globalStatus === "REJECTED") {
        return "REJECTED";
    }

    if (record.status !== "NOT_APPLIED") {
        return record.status;
    }

    return globalStatus;
}

// Boolean mirror of eligibilityService.evaluateServiceEligibility:
// eligible exactly when the service would produce zero reasons.
// `vehicle` is the driver's APPROVED + active current vehicle record
// (or null) and `documents` the driver's full document list.
function locationServiceEligible(driver, service, vehicle, documents, now) {
    const record = locationServiceRecord(driver, service);

    if (locationEffectiveServiceStatus(driver, service) !== "APPROVED") {
        return false;
    }

    if (!record.enabled) {
        return false;
    }

    const transportMode =
        service === "BUY_DELIVER" ? record.transportMode : null;

    if (service === "BUY_DELIVER") {
        if (!transportMode) {
            return false;
        }

        if (!record.policyAcknowledgedAt) {
            return false;
        }
    }

    const approved = new Set();

    for (const doc of documents || []) {
        if (doc.verificationStatus !== "APPROVED") {
            continue;
        }

        if (doc.expiryDate && new Date(doc.expiryDate) <= now) {
            continue;
        }

        approved.add(doc.documentType);
    }

    for (const type of LOCATION_REQUIRED_DOCUMENTS[service]) {
        if (!approved.has(type)) {
            return false;
        }
    }

    if (!vehicle) {
        return false;
    }

    if (
        service === "BUY_DELIVER" &&
        transportMode &&
        LOCATION_VEHICLE_TYPES_BY_TRANSPORT_MODE[transportMode] &&
        !LOCATION_VEHICLE_TYPES_BY_TRANSPORT_MODE[transportMode].includes(
            vehicle.vehicleType
        )
    ) {
        return false;
    }

    if (
        vehicle.registrationExpiryDate &&
        new Date(vehicle.registrationExpiryDate) <= now
    ) {
        return false;
    }

    return true;
}

// True when at least one service is fully eligible — the same verdict
// eligibilityService.hasAnyEligibleService returns for the snapshot.
function driverHasAnyEligibleService(driver, vehicle, documents, now = new Date()) {
    return LOCATION_SERVICES.some((service) =>
        locationServiceEligible(driver, service, vehicle, documents, now)
    );
}

const registerDriverLocationHandler = (io, socket) => {
    if (socket.user.role !== "DRIVER") return;

    socket.on("driver:location", async (data, callback) => {
        try {
            const { latitude, longitude } = data || {};

            if (
                typeof latitude !== "number" ||
                typeof longitude !== "number" ||
                !Number.isFinite(latitude) ||
                !Number.isFinite(longitude) ||
                Math.abs(latitude) > 90 ||
                Math.abs(longitude) > 180
            ) {
                return callback?.({ success: false, message: "Invalid coordinates" });
            }

            const db = mongoose.connection.db;

            const driver = await db.collection("drivers").findOne({
                userId: new mongoose.Types.ObjectId(socket.user.id),
                isOnline: true,
            });

            if (!driver) {
                return callback?.({
                    success: false,
                    message: "Approved online driver required",
                });
            }

            // GPS fix (Phase 8 finding): legacy APPROVED drivers keep
            // the exact pre-fix behaviour. Anyone else — e.g. a Buy &
            // Deliver-only partner, whose global status stays PENDING
            // by design — must be eligible for at least one service
            // (same standard as the REST location path); a driver
            // eligible for nothing is still refused, unchanged.
            if (driver.verificationStatus !== "APPROVED") {
                const [vehicle, documents] = await Promise.all([
                    driver.currentVehicleId
                        ? db.collection("vehicles").findOne({
                              _id: driver.currentVehicleId,
                              driverId: driver._id,
                              verificationStatus: "APPROVED",
                              isActive: true,
                          })
                        : null,
                    db
                        .collection("driverdocuments")
                        .find({ driverId: driver._id })
                        .toArray(),
                ]);

                if (!driverHasAnyEligibleService(driver, vehicle, documents)) {
                    return callback?.({
                        success: false,
                        message: "Approved online driver required",
                    });
                }
            }

            // Temporary location update.
            // Redis-based live location storage will be added later.
            const now = new Date();

            const updateResult = await db.collection("drivers").updateOne(
                { _id: driver._id, isOnline: true },
                {
                    $set: {
                        currentLocation: {
                            type: "Point",
                            coordinates: [longitude, latitude],
                        },
                        // The purchase/parcel freshness gates read
                        // lastLocationUpdate (120-second window) — the
                        // socket path must write THAT field (it
                        // previously wrote only lastLocationAt, which
                        // no gate reads, so socket-only drivers went
                        // stale). lastLocationAt is still written
                        // alongside for backward compatibility with
                        // this handler's historical writes.
                        lastLocationUpdate: now,
                        lastLocationAt: now,
                    },
                }
            );

            if (updateResult.matchedCount !== 1) {
                return callback?.({
                    success: false,
                    message: "Driver is no longer online",
                });
            }

            const activeRide = await db
                .collection("rides")
                .findOne({
                    driverId: driver._id,
                    status: {
                        $in: [
                            "DRIVER_SELECTED",
                            "DRIVER_EN_ROUTE",
                            "DRIVER_ARRIVED",
                            "TRIP_STARTED",
                        ],
                    },
                });

            if (activeRide) {
                const passengerRoom = `passenger:${activeRide.passengerId}`;

                io.to(passengerRoom).emit("ride:driver:location", {
                    rideId: activeRide._id.toString(),
                    driverId: driver._id.toString(),
                    latitude,
                    longitude,
                    updatedAt: new Date().toISOString(),
                });
            }


            callback?.({ success: true });
        } catch (error) {
            console.error("Driver location socket error:", error.message);
            callback?.({ success: false, message: "Location update failed" });
        }
    });
};

module.exports = { registerDriverLocationHandler, driverHasAnyEligibleService };
