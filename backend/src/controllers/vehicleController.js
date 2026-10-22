const Driver = require("../models/Driver");
const Vehicle = require("../models/Vehicle");

const registerVehicle = async (req, res) => {
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

        const {
            vehicleType,
            registrationNumber,
            make,
            model,
            color,
            modelYear,
            registrationExpiryDate,
        } = req.body || {};

        if (
            !["BIKE", "RICKSHAW", "CAR_AC", "CAR_NON_AC"].includes(vehicleType) ||
            typeof registrationNumber !== "string" ||
            !/^[A-Z0-9 -]{4,20}$/i.test(registrationNumber.trim()) ||
            (modelYear !== undefined &&
                (!Number.isInteger(modelYear) ||
                    modelYear < 1950 ||
                    modelYear > new Date().getFullYear() + 1))
        ) {
            return res.status(400).json({
                success: false,
                message: "Invalid vehicle details",
            });
        }

        const expiry = new Date(registrationExpiryDate);

        if (
            typeof registrationExpiryDate !== "string" ||
            !/^\d{4}-\d{2}-\d{2}$/.test(registrationExpiryDate) ||
            !Number.isFinite(expiry.getTime()) ||
            expiry <= new Date()
        ) {
            return res.status(400).json({
                success: false,
                message: "Valid future vehicle registration expiry date required",
            });
        }

        const vehicle = await Vehicle.create({
            driverId: driver._id,
            vehicleType,
            registrationNumber: registrationNumber.trim().toUpperCase(),
            make,
            model,
            color,
            modelYear,
            registrationExpiryDate: expiry,
            verificationStatus: "PENDING",
        });

        return res.status(201).json({
            success: true,
            vehicle,
        });
    } catch (error) {
        if (error.code === 11000) {
            return res.status(409).json({
                success: false,
                message: "Vehicle registration already exists",
            });
        }

        return res.status(500).json({
            success: false,
            message: "Vehicle registration failed",
        });
    }
};

const getMyVehicles = async (req, res) => {
    const driver = await Driver.findOne({
        userId: req.user._id,
    });

    if (!driver) {
        return res.status(404).json({
            success: false,
            message: "Driver profile not found",
        });
    }

    const vehicles = await Vehicle.find({
        driverId: driver._id,
    }).sort({ createdAt: -1 });

    return res.json({ success: true, vehicles });
};

module.exports = { registerVehicle, getMyVehicles };