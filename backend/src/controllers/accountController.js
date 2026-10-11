
const User = require("../models/User");

const getAccount = async (req, res) => {
    try {
        const user = await User.findById(req.user._id)
            .select("firstName lastName name email phone role createdAt")
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
            .select("firstName lastName name email phone role createdAt")
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

module.exports = { getAccount, updateAccount };
