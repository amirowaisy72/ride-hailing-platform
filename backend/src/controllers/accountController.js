
const User = require("../models/User");
const Driver = require("../models/Driver");
const Ride = require("../models/Ride");
const ParcelOrder = require("../models/ParcelOrder");
const { uploadProfileImage } = require("../integrations/cloudinary/uploadService");

const getAccount = async (req, res) => {
    try {
        const user = await User.findById(req.user._id)
            .select("firstName lastName name email phone role activeMode profileImage createdAt")
            .lean();

        if (!user) {
            return res.status(404).json({
                success: false,
                message: "Account not found",
            });
        }

        return res.json({ success: true, user });
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: "Unable to load account",
        });
    }
};

const updateAccount = async (req, res) => {
    try {
        const allowed = ["firstName", "lastName", "name"];
        const updates = {};

        for (const field of allowed) {
            if (!Object.prototype.hasOwnProperty.call(req.body || {}, field)) {
                continue;
            }

            const value = req.body[field];

            if (
                typeof value !== "string" ||
                value.trim().length < 1 ||
                value.trim().length > 80
            ) {
                return res.status(400).json({
                    success: false,
                    message: `Invalid ${field}`,
                });
            }

            updates[field] = value.trim();
        }

        if (Object.keys(updates).length === 0) {
            return res.status(400).json({
                success: false,
                message: "No valid profile changes supplied",
            });
        }

        const user = await User.findByIdAndUpdate(
            req.user._id,
            { $set: updates },
            {
                new: true,
                runValidators: true,
            }
        )
            .select("firstName lastName name email phone role activeMode profileImage createdAt")
            .lean();

        if (!user) {
            return res.status(404).json({
                success: false,
                message: "Account not found",
            });
        }

        return res.json({
            success: true,
            message: "Profile updated successfully",
            user,
        });
    } catch (error) {
        console.error("Account update error:", error.message);

        return res.status(500).json({
            success: false,
            message: "Unable to update profile",
        });
    }
};

const updateProfilePicture = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: "Profile picture required",
            });
        }

        const user = await User.findById(req.user._id);
        if (!user || !["DRIVER", "PASSENGER"].includes(user.role)) {
            return res.status(403).json({
                success: false,
                message: "Account unavailable",
            });
        }

        const uploaded = await uploadProfileImage(
            req.file.buffer,
            String(user._id)
        );

        user.profileImage = uploaded.imageUrl;
        await user.save();

        return res.json({
            success: true,
            message: "Profile picture updated",
            profileImage: user.profileImage,
        });
    } catch (error) {
        console.error("Profile picture upload:", error.message);
        return res.status(500).json({
            success: false,
            message: "Profile picture upload failed",
        });
    }
};

const switchMode = async (req, res) => {
    try {
        const { mode } = req.body || {};

        if (!["PASSENGER", "DRIVER"].includes(mode) ||
            req.user.role === "ADMIN") {
            return res.status(400).json({
                success: false,
                message: "Invalid account mode",
            });
        }

        if (req.user.activeMode === mode) {
            return res.json({
                success: true,
                activeMode: mode,
            });
        }

        const driver = await Driver.findOne({
            userId: req.user._id,
        });

        if (mode === "DRIVER" &&
            driver?.verificationStatus !== "APPROVED") {
            return res.status(403).json({
                success: false,
                message: "Driver approval required",
            });
        }

        const activeRideStatuses = [
            "REQUESTED", "SEARCHING", "BIDDING",
            "DRIVER_SELECTED", "DRIVER_EN_ROUTE",
            "DRIVER_ARRIVED", "TRIP_STARTED",
            "REASSIGNING",
        ];

        const activeParcelStatuses = [
            "REQUESTED", "DRIVER_ASSIGNED",
            "DRIVER_EN_ROUTE", "ARRIVED_AT_PICKUP",
            "PICKED_UP", "OUT_FOR_DELIVERY",
        ];

        const [activeRide, activeParcel] = await Promise.all([
            Ride.exists({
                $or: [
                    { passengerId: req.user._id },
                    ...(driver ? [{ driverId: driver._id }] : []),
                ],
                status: { $in: activeRideStatuses },
            }),
            ParcelOrder.exists({
                $or: [
                    { customerId: req.user._id },
                    ...(driver ? [{ driverId: driver._id }] : []),
                ],
                status: { $in: activeParcelStatuses },
            }),
        ]);

        if (activeRide || activeParcel) {
            return res.status(409).json({
                success: false,
                message: "Complete active Ride/Parcel before switching",
            });
        }

        if (mode !== "DRIVER" && (driver?.isOnline || driver?.isAvailable)) {
            return res.status(409).json({
                success: false,
                message: "Go offline before switching modes",
            });
        }

        const user = await User.findOneAndUpdate(
            {
                _id: req.user._id,
                status: "ACTIVE",
                role: { $ne: "ADMIN" },
            },
            { $set: { activeMode: mode } },
            { new: true, runValidators: true }
        );

        if (!user) {
            return res.status(403).json({
                success: false,
                message: "Active account required",
            });
        }
        return res.json({
            success: true,
            activeMode: user.activeMode,
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: "Mode switching failed",
        });
    }
};

module.exports = {
    getAccount,
    updateAccount,
    updateProfilePicture,
    switchMode,
};
