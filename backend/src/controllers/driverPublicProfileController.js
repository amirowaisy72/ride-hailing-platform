const mongoose = require("mongoose");
const Driver = require("../models/Driver");
const Vehicle = require("../models/Vehicle");
const User = require("../models/User");
const DriverReview = require("../models/DriverReview");

const getDriverPublicProfile = async (req, res) => {
    try {
        const { driverId } = req.params;

        if (!mongoose.isValidObjectId(driverId)) {
            return res.status(400).json({
                success: false,
                message: "Invalid driver ID",
            });
        }

        const driver = await Driver.findById(driverId)
            .select("verificationStatus rating ratingCount currentVehicleId userId")
            .lean();

        if (!driver || driver.verificationStatus !== "APPROVED") {
            return res.status(404).json({
                success: false,
                message: "Verified driver not found",
            });
        }

        const driverUser = await User.findById(driver.userId)
            .select("firstName lastName profileImage")
            .lean();

        const vehicle = driver.currentVehicleId
            ? await Vehicle.findOne({
                _id: driver.currentVehicleId,
                driverId: driverId,
                verificationStatus: "APPROVED",
                isActive: true,
            })
                .select("vehicleType make model color modelYear")
                .lean()
            : null;

        const reviews = await DriverReview.find({
            driverId,
            isHidden: false,
        })
            .sort({ createdAt: -1 })
            .limit(5)
            .select("rating comment createdAt -_id")
            .lean();

        return res.json({
            success: true,
            driver: {
                id: driver._id,
                name: [driverUser?.firstName, driverUser?.lastName].filter(Boolean).join(" "),
                profileImage: driverUser?.profileImage || "",
                verified: true,
                rating: driver.ratingCount ? driver.rating : null,
                ratingCount: driver.ratingCount || 0,
                vehicle,
                reviews,
            },
        });
    } catch (error) {
        console.error("Driver profile error:", error.message);

        return res.status(500).json({
            success: false,
            message: "Unable to load driver profile",
        });
    }
};

module.exports = { getDriverPublicProfile };