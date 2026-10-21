const Ride = require("../models/Ride");
const Driver = require("../models/Driver");
const Vehicle = require("../models/Vehicle");

const getAvailableRides = async (req, res) => {
    try {
        const driver = await Driver.findOne({
            userId: req.user._id,
            verificationStatus: "APPROVED",
            isOnline: true,
            isAvailable: true,
        });

        if (!driver) {
            return res.json({ success: true, rides: [] });
        }

        const vehicle = await Vehicle.findOne({
            _id: driver.currentVehicleId,
            driverId: driver._id,
            verificationStatus: "APPROVED",
            isActive: true,
        });

        if (!vehicle) {
            return res.json({ success: true, rides: [] });
        }

        if (
            !Array.isArray(driver.currentLocation?.coordinates) ||
            driver.currentLocation.coordinates.length !== 2 ||
            driver.currentLocation.coordinates.every((value) => value === 0)
        ) {
            return res.json({
                success: true,
                rides: [],
                message: "Accurate driver location required",
            });
        }

        if (
            !driver.lastLocationUpdate ||
            Date.now() - new Date(driver.lastLocationUpdate).getTime() > 120000
        ) {
            return res.json({
                success: true,
                rides: [],
                message: "Fresh GPS location required",
            });
        }

        const rides = await Ride.find({
            vehicleType: vehicle.vehicleType,
            status: { $in: ["REQUESTED", "SEARCHING", "BIDDING"] },
            driverId: null,
            pickup: {
                $near: {
                    $geometry: driver.currentLocation,
                    $maxDistance: 15000,
                },
            },
        })
            .limit(30)
            .sort({ createdAt: -1 })
            .select("pickup destination stops requestedPrice vehicleType tripType distance estimatedDuration status createdAt");

        return res.json({ success: true, rides });
    } catch (error) {
        console.error("Available rides error:", error.message);
        return res.status(500).json({
            success: false,
            message: "Failed to load available rides",
        });
    }
};

const getMyActiveRide = async (req, res) => {
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

        const ride = await Ride.findOne({
            driverId: driver._id,
            status: {
                $in: [
                    "DRIVER_SELECTED",
                    "DRIVER_EN_ROUTE",
                    "DRIVER_ARRIVED",
                    "TRIP_STARTED",
                ],
            },
        }).sort({ createdAt: -1 });

        return res.json({ success: true, ride });
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: "Failed to restore active ride",
        });
    }
};

module.exports = { getAvailableRides, getMyActiveRide };