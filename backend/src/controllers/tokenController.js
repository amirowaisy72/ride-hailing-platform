const mongoose = require("mongoose");
const RefreshToken = require("../models/RefreshToken");
const User = require("../models/User");

const {
    generateAccessToken,
    generateRefreshToken,
    hashRefreshToken,
} = require("../services/tokenService");

const refresh = async (req, res) => {
    const { refreshToken } = req.body || {};

    if (
        typeof refreshToken !== "string" ||
        !/^[a-f0-9]{64}$/.test(refreshToken)
    ) {
        return res.status(400).json({
            success: false,
            message: "Invalid refresh token",
        });
    }

    const tokenHash = hashRefreshToken(refreshToken);
    const now = new Date();
    const newRefreshToken = generateRefreshToken();

    try {
        const result = await mongoose.connection.transaction(
            async (session) => {
                const oldToken = await RefreshToken.findOne({
                    tokenHash,
                }).session(session);

                if (!oldToken) {
                    return { status: "INVALID" };
                }

                if (oldToken.revokedAt) {
                    if (oldToken.familyId) {
                        await RefreshToken.updateMany(
                            { familyId: oldToken.familyId },
                            { $set: { revokedAt: now } },
                            { session }
                        );
                    }

                    return { status: "INVALID" };
                }

                if (oldToken.expiresAt <= now) {
                    return { status: "INVALID" };
                }

                const user = await User.findById(
                    oldToken.userId
                ).session(session);

                if (
                    !user ||
                    !user.emailVerified ||
                    user.status !== "ACTIVE"
                ) {
                    return { status: "UNAUTHORIZED" };
                }

                const updated = await RefreshToken.updateOne(
                    {
                        _id: oldToken._id,
                        revokedAt: null,
                        expiresAt: { $gt: now },
                    },
                    { $set: { revokedAt: now } },
                    { session }
                );

                if (updated.modifiedCount !== 1) {
                    throw new Error("Concurrent token rotation");
                }


                await RefreshToken.create(
                    [{
                        userId: user._id,
                        tokenHash: hashRefreshToken(newRefreshToken),
                        familyId: oldToken.familyId,
                        expiresAt: new Date(
                            now.getTime() + 7 * 24 * 60 * 60 * 1000
                        ),
                    }],
                    { session }
                );

                return {
                    status: "SUCCESS",
                    user,
                };
            }
        );

        if (result.status === "INVALID") {
            return res.status(401).json({
                success: false,
                message: "Invalid or expired refresh token",
            });
        }

        if (result.status === "UNAUTHORIZED") {
            return res.status(401).json({
                success: false,
                message: "Unauthorized account",
            });
        }

        return res.json({
            success: true,
            accessToken: generateAccessToken(result.user),
            refreshToken: newRefreshToken,
        });
    } catch (error) {
        console.error("Token refresh error:", error.message);

        return res.status(500).json({
            success: false,
            message: "Token refresh failed",
        });
    }
};

const logout = async (req, res) => {
    try {
        const { refreshToken } = req.body || {};

        if (
            typeof refreshToken !== "string" ||
            !/^[a-f0-9]{64}$/.test(refreshToken)
        ) {
            return res.status(400).json({
                success: false,
                message: "Invalid refresh token",
            });
        }

        await RefreshToken.updateOne(
            { tokenHash: hashRefreshToken(refreshToken) },
            { $set: { revokedAt: new Date() } }
        );

        return res.status(200).json({
            success: true,
            message: "Logged out successfully",
        });
    } catch (error) {
        console.error("Logout error:", error.message);

        return res.status(500).json({
            success: false,
            message: "Logout failed",
        });
    }
};

module.exports = { refresh, logout };