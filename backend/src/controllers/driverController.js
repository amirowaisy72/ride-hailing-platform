
const Driver = require("../models/Driver");
const Vehicle = require("../models/Vehicle");
const DriverDocument = require("../models/DriverDocument");
const Ride = require("../models/Ride");
const ParcelOrder = require("../models/ParcelOrder");
const { publishEvent } = require("../services/socketService");
const {
    hasAnyEligibleService,
} = require("../services/eligibilityService");

const registerDriver = async (req, res) => {
    try {
        if (!["PASSENGER", "DRIVER"].includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                message: "Only driver accounts can register",
            });
        }

        const existingDriver = await Driver.findOne({
            userId: req.user._id,
        });

        if (existingDriver) {
            return res.status(409).json({
                success: false,
                message: "Driver profile already exists",
            });
        }

        const driver = await Driver.create({
            userId: req.user._id,
        });

        return res.status(201).json({
            success: true,
            message: "Driver profile created. Verification pending.",
            driver,
        });
    } catch (error) {
        if (error.code === 11000) {
            return res.status(409).json({
                success: false,
                message: "Driver profile already exists",
            });
        }

        console.error("Driver registration error:", error.message);

        return res.status(500).json({
            success: false,
            message: "Driver registration failed",
        });
    }
};

const updateOnlineStatus = async (req, res) => {
    try {
        const { isOnline } = req.body;

        if (isOnline && req.user.activeMode !== "DRIVER") {
            return res.status(403).json({
                success: false,
                message: "Switch to Driver mode first",
            });
        }

        if (isOnline && req.user.activeMode !== "DRIVER") {
            return res.status(403).json({
                success: false,
                message: "Switch to Driver mode first",
            });
        }

        if (typeof isOnline !== "boolean") {
            return res.status(400).json({
                success: false,
                message: "isOnline must be true or false",
            });
        }

        const driver = await Driver.findOne({
            userId: req.user._id,
        });

        if (!driver) {
            return res.status(404).json({
                success: false,
                message: "Driver profile not found",
            });
        }

        if (isOnline) {
            // Phase 2 — service-aware online gate. A driver may go
            // online when AT LEAST ONE enabled service is fully eligible
            // (eligibilityService is the single source of truth). Every
            // service — RIDE, PARCEL and BUY_DELIVER alike — requires
            // the full vehicle + document verification (Amir
            // correction, 2026-10-29); only WHICH service qualifies the
            // driver differs, never the standard.
            const { eligible, evaluations, context } =
                await hasAnyEligibleService(driver);

            if (!eligible) {
                // Preserve the pre-Phase-2 error behaviour for drivers
                // whose only path online is the legacy ride/parcel one.
                if (
                    driver.verificationStatus !== "APPROVED" &&
                    evaluations.BUY_DELIVER.status !== "APPROVED"
                ) {
                    return res.status(403).json({
                        success: false,
                        message: "Driver approval required",
                    });
                }

                if (
                    evaluations.RIDE.status === "APPROVED" ||
                    evaluations.PARCEL.status === "APPROVED"
                ) {
                    const vehicle = context.vehicle;

                    if (!vehicle) {
                        return res.status(403).json({
                            success: false,
                            message:
                                "Select an approved vehicle before going online",
                        });
                    }

                    const expiredDocument = await DriverDocument.exists({
                        driverId: driver._id,
                        documentType: {
                            $in: ["DRIVING_LICENSE", "VEHICLE_REGISTRATION"],
                        },
                        verificationStatus: "APPROVED",
                        expiryDate: { $lte: new Date() },
                    });

                    if (expiredDocument) {
                        driver.isOnline = false;
                        driver.isAvailable = false;
                        await driver.save();

                        return res.status(403).json({
                            success: false,
                            message:
                                "Document expired. Renewal and Admin Approval required.",
                        });
                    }

                    if (
                        vehicle.registrationExpiryDate &&
                        vehicle.registrationExpiryDate <= new Date()
                    ) {
                        driver.isOnline = false;
                        driver.isAvailable = false;
                        await driver.save();

                        return res.status(403).json({
                            success: false,
                            message:
                                "Vehicle registration expired. Renew and obtain Admin Approval.",
                        });
                    }

                    return res.status(403).json({
                        success: false,
                        message:
                            "All services are turned off or suspended",
                    });
                }

                const firstReason =
                    evaluations.BUY_DELIVER.reasons[0] ||
                    evaluations.RIDE.reasons[0] ||
                    "No eligible service available";

                return res.status(403).json({
                    success: false,
                    message: firstReason,
                });
            }
        }

        const activeTrip = await Ride.exists({
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

        const activeParcel = await ParcelOrder.exists({
            driverId: driver._id,
            status: {
                $in: [
                    "DRIVER_ASSIGNED",
                    "DRIVER_EN_ROUTE",
                    "ARRIVED_AT_PICKUP",
                    "PICKED_UP",
                    "OUT_FOR_DELIVERY",
                ],
            },
        });

        if (!isOnline && (activeTrip || activeParcel)) {
            return res.status(409).json({
                success: false,
                message: "Complete active Ride/Parcel before going offline",
            });
        }

        driver.isOnline = isOnline;
        driver.isAvailable = isOnline && !activeTrip && !activeParcel;

        await driver.save();

        return res.json({
            success: true,
            isOnline: driver.isOnline,
            isAvailable: driver.isAvailable,
        });
    } catch (error) {
        console.error("Driver status error:", error.message);

        return res.status(500).json({
            success: false,
            message: "Failed to update driver status",
        });
    }
};

const updateDriverLocation = async (req, res) => {
    try {
        const { latitude, longitude } = req.body;

        if (
            typeof latitude !== "number" ||
            typeof longitude !== "number" ||
            !Number.isFinite(latitude) ||
            !Number.isFinite(longitude) ||
            Math.abs(latitude) > 90 ||
            Math.abs(longitude) > 180
        ) {
            return res.status(400).json({
                success: false,
                message: "Invalid GPS coordinates",
            });
        }

        const driver = await Driver.findOne({
            userId: req.user._id,
            isOnline: true,
        });

        if (!driver) {
            return res.status(403).json({
                success: false,
                message: "Approved online driver required",
            });
        }

        // GPS fix (Phase 8 finding): a partner approved ONLY for a
        // service (e.g. Buy & Deliver) keeps the legacy global status
        // PENDING by design, yet must be able to refresh GPS — the
        // purchase/parcel freshness gates read lastLocationUpdate with
        // a 120-second window, so the old global-APPROVED-only filter
        // locked BD-only partners out of offers ~2 minutes after any
        // fix. Legacy APPROVED drivers take the exact pre-fix path
        // (no extra evaluation, zero behaviour change); anyone else
        // must be eligible for at least one service via
        // eligibilityService, the single source of truth. A driver
        // eligible for nothing is still refused, with the same
        // response as before.
        if (driver.verificationStatus !== "APPROVED") {
            const { eligible } = await hasAnyEligibleService(driver);

            if (!eligible) {
                return res.status(403).json({
                    success: false,
                    message: "Approved online driver required",
                });
            }
        }

        driver.currentLocation = {
            type: "Point",
            coordinates: [longitude, latitude],
        };

        driver.lastLocationUpdate = new Date();

        await driver.save();

        // Only the passenger assigned to an active ride receives this driver's GPS.
        const ride = await Ride.findOne({
            driverId: driver._id,
            status: { $in: ["DRIVER_SELECTED", "DRIVER_EN_ROUTE", "DRIVER_ARRIVED", "TRIP_STARTED"] },
        }).select("_id passengerId status").lean();
        if (ride) {
            publishEvent("ride:driver:location", `passenger:${ride.passengerId}`, {
                rideId: String(ride._id),
                location: { latitude, longitude },
                updatedAt: driver.lastLocationUpdate.toISOString(),
            });
        }

        // Share GPS only with the customer assigned to an active parcel.
        const parcel = await ParcelOrder.findOne({
            driverId: driver._id,
            status: {
                $in: [
                    "DRIVER_ASSIGNED",
                    "DRIVER_EN_ROUTE",
                    "ARRIVED_AT_PICKUP",
                    "PICKED_UP",
                    "OUT_FOR_DELIVERY",
                ],
            },
        }).select("_id customerId").lean();

        if (parcel) {
            publishEvent(
                "parcel:driver:location",
                `passenger:${parcel.customerId}`,
                {
                    parcelId: String(parcel._id),
                    location: { latitude, longitude },
                    updatedAt: driver.lastLocationUpdate.toISOString(),
                }
            );
        }

        return res.json({
            success: true,
            message: "Driver location updated",
        });
    } catch (error) {
        console.error("Driver location error:", error.message);

        return res.status(500).json({
            success: false,
            message: "Location update failed",
        });
    }
};

const getMyDriverStatus = async (req, res) => {
    try {
        const driver = await Driver.findOne({
            userId: req.user._id,
        }).select(
            "verificationStatus rejectionReason isOnline isAvailable currentVehicleId currentLocation rating ratingCount services"
        );

        if (!driver) {
            return res.status(404).json({
                success: false,
                message: "Driver profile not found",
            });
        }

        return res.json({ success: true, driver });
    } catch {
        return res.status(500).json({
            success: false,
            message: "Failed to load driver status",
        });
    }
};

module.exports = {
    getMyDriverStatus,
    registerDriver,
    updateOnlineStatus,
    updateDriverLocation,
};


