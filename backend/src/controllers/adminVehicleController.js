const mongoose = require("mongoose");
const Vehicle = require("../models/Vehicle");
const Driver = require("../models/Driver");

const getVehicles = async (req, res) => {
    try {
        const vehicles = await Vehicle.find()
            .populate({
                path: "driverId",
                select: "userId verificationStatus",
                populate: {
                    path: "userId",
                    select: "firstName lastName email",
                },
            })
            .sort({ createdAt: -1 });

        res.json({ success: true, vehicles });
    } catch {
        res.status(500).json({ success: false, message: "Failed to load vehicles" });
    }
};

const reviewVehicle = async (req, res) => {
    try {
        const { vehicleId } = req.params;
        const { status } = req.body || {};

        if (!mongoose.isValidObjectId(vehicleId) ||
            !["APPROVED", "REJECTED"].includes(status)) {
            return res.status(400).json({ success: false, message: "Invalid request" });
        }

        const vehicle = await Vehicle.findByIdAndUpdate(
            vehicleId,
            { $set: { verificationStatus: status } },
            { new: true, runValidators: true }
        );

        if (!vehicle) {
            return res.status(404).json({ success: false, message: "Vehicle not found" });
        }

        if (status === "REJECTED") {
            await Driver.updateOne(
                { _id: vehicle.driverId, currentVehicleId: vehicle._id },
                { $set: { currentVehicleId: null, isOnline: false, isAvailable: false } }
            );
        }

        res.json({ success: true, vehicle });
    } catch {
        res.status(500).json({ success: false, message: "Vehicle review failed" });
    }
};

module.exports = { getVehicles, reviewVehicle };