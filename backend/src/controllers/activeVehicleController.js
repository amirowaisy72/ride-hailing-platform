const mongoose = require("mongoose");
const Driver = require("../models/Driver");
const Vehicle = require("../models/Vehicle");

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