const mongoose = require("mongoose");
const Driver = require("../models/Driver");
const Vehicle = require("../models/Vehicle");
const Ride = require("../models/Ride");
const ParcelOrder = require("../models/ParcelOrder");

const selectActiveVehicle = async (req, res) => {
    try {
        const { vehicleId } = req.body || {};

        if (!mongoose.isValidObjectId(vehicleId)) {
            return res.status(400).json({
                success: false,
                message: "Invalid vehicle ID",
            });
        }

        const driver = await Driver.findOne({
            userId: req.user._id,
        });

        if (!driver) {
            return res.status(404).json({
                success: false,
                message: "Driver not found",
            });
        }

        if (driver.isOnline || driver.isAvailable) {
            return res.status(409).json({
                success: false,
                message: "Go offline before changing vehicle",
            });
        }

        const [activeRide, activeParcel] = await Promise.all([
            Ride.exists({
                driverId: driver._id,
                status: {
                    $in: [
                        "REQUESTED", "SEARCHING", "BIDDING",
                        "DRIVER_SELECTED", "DRIVER_EN_ROUTE",
                        "DRIVER_ARRIVED", "TRIP_STARTED",
                        "REASSIGNING",
                    ],
                },
            }),
            ParcelOrder.exists({
                driverId: driver._id,
                status: {
                    $in: [
                        "REQUESTED", "DRIVER_ASSIGNED",
                        "DRIVER_EN_ROUTE", "ARRIVED_AT_PICKUP",
                        "PICKED_UP", "OUT_FOR_DELIVERY",
                    ],
                },
            }),
        ]);

        if (activeRide || activeParcel) {
            return res.status(409).json({
                success: false,
                message: "Complete active Ride/Parcel before changing vehicle",
            });
        }

        const vehicle = await Vehicle.findOne({
            _id: vehicleId,
            driverId: driver._id,
            verificationStatus: "APPROVED",
            isActive: true,
        });

        if (!vehicle) {
            return res.status(403).json({
                success: false,
                message: "Approved vehicle required",
            });
        }

        if (vehicle.registrationExpiryDate &&
            vehicle.registrationExpiryDate <= new Date()) {
            return res.status(403).json({
                success: false,
                message: "Vehicle registration expired. Renewal and Admin Approval required.",
            });
        }

        driver.currentVehicleId = vehicle._id;
        await driver.save();

        return res.json({
            success: true,
            message: "Active vehicle updated",
            vehicle,
        });
    } catch (error) {
        console.error("Vehicle selection error:", error.message);
        return res.status(500).json({
            success: false,
            message: "Vehicle selection failed",
        });
    }
};

module.exports = { selectActiveVehicle };