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

// GET /admin/vehicles/active-summary — read-only, admin-only.
// Active vehicles by type (Vehicle.isActive) plus vehicles in use
// right now: an online driver (location within the last 2 minutes,
// the dashboard's own "online" rule) with that vehicle selected as
// currentVehicleId. No write, no existing endpoint touched.
const getActiveSummary = async (req, res) => {
    try {
        const onlineCutoff = new Date(Date.now() - 2 * 60 * 1000);
        const types = ["BIKE", "RICKSHAW", "CAR_AC", "CAR_NON_AC"];

        const [activeGroups, inUseGroups, totalActive] = await Promise.all([
            Vehicle.aggregate([
                { $match: { isActive: true } },
                { $group: { _id: "$vehicleType", count: { $sum: 1 } } },
            ]),
            Driver.aggregate([
                {
                    $match: {
                        isOnline: true,
                        currentVehicleId: { $ne: null },
                        lastLocationUpdate: { $gte: onlineCutoff },
                    },
                },
                {
                    $lookup: {
                        from: "vehicles",
                        localField: "currentVehicleId",
                        foreignField: "_id",
                        as: "vehicle",
                    },
                },
                { $unwind: "$vehicle" },
                { $group: { _id: "$vehicle.vehicleType", count: { $sum: 1 } } },
            ]),
            Vehicle.countDocuments({ isActive: true }),
        ]);

        const toMap = (groups) => {
            const map = {};
            types.forEach((type) => {
                map[type] = 0;
            });
            groups.forEach((row) => {
                if (types.includes(row._id)) map[row._id] = row.count;
            });
            return map;
        };

        const activeByType = toMap(activeGroups);
        const inUseNowByType = toMap(inUseGroups);
        const totalInUseNow = Object.values(inUseNowByType).reduce(
            (sum, count) => sum + count,
            0
        );

        res.json({
            success: true,
            activeByType,
            inUseNowByType,
            totalActive,
            totalInUseNow,
        });
    } catch {
        res.status(500).json({
            success: false,
            message: "Failed to load active vehicle summary",
        });
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

        if (status === "APPROVED") {
            const existingVehicle = await Vehicle.findById(vehicleId);

            if (!existingVehicle) {
                return res.status(404).json({
                    success: false,
                    message: "Vehicle not found",
                });
            }

            if (
                existingVehicle.registrationExpiryDate &&
                existingVehicle.registrationExpiryDate <= new Date()
            ) {
                return res.status(400).json({
                    success: false,
                    message: "Renew expired registration before approval",
                });
            }
        }

        const vehicle = await Vehicle.findByIdAndUpdate(
            vehicleId,
            { $set: { verificationStatus: status } },
            { new: true, runValidators: true }
        );

        if (!vehicle) {
            return res.status(404).json({ success: false, message: "Vehicle not found" });
        }

        if (
            status === "REJECTED" ||
            (vehicle.registrationExpiryDate &&
                vehicle.registrationExpiryDate <= new Date())
        ) {
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

module.exports = { getVehicles, getActiveSummary, reviewVehicle };