
const User = require("../models/User");
const PasswordResetOTP = require("../models/PasswordResetOTP");
const { generateOTP, hashOTP } = require("../services/otpService");
const { sendOTPEmail } = require("../integrations/email/emailService");

const sendResetOTP = async (req, res) => {
    const message = "If this email is registered, a reset OTP will be sent.";

    try {
        const email = String(req.body?.email || "").trim().toLowerCase();

        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return res.status(400).json({
                success: false,
                message: "Valid email required",
            });
        }

        const user = await User.findOne({ email });

        if (user && user.status !== "SUSPENDED") {
            const existing = await PasswordResetOTP.findOne({
                userId: user._id,
            });

            if (!existing || Date.now() - existing.createdAt.getTime() >= 60000) {
                const otp = generateOTP();

                await PasswordResetOTP.findOneAndUpdate(
                    { userId: user._id },
                    {
                        otpHash: await hashOTP(otp),
                        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
                        attempts: 0,
                        createdAt: new Date(),
                    },
                    { upsert: true }
                );

                await sendOTPEmail(user.email, otp);
            }
        }

        return res.json({ success: true, message });
    } catch (error) {
        console.error("Password reset OTP error:", error.message);
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.statusCode === 503
                ? "OTP email service is disabled by Admin. Please try again later."
                : "Unable to process reset request",
        });
    }
};

const bcrypt = require("bcryptjs");
const RefreshToken = require("../models/RefreshToken");
const { verifyOTPHash } = require("../services/otpService");

const resetPassword = async (req, res) => {
    try {
        const email = String(req.body?.email || "").trim().toLowerCase();
        const { otp, newPassword } = req.body;

        if (!/^\d{6}$/.test(String(otp || ""))) {
            return res.status(400).json({
                success: false,
                message: "Valid 6-digit OTP required",
            });
        }

        if (typeof newPassword !== "string" || newPassword.length < 8) {
            return res.status(400).json({
                success: false,
                message: "Password must be at least 8 characters",
            });
        }

        const user = await User.findOne({ email });

        if (!user || user.status === "SUSPENDED") {
            return res.status(400).json({
                success: false,
                message: "Invalid reset request",
            });
        }

        const record = await PasswordResetOTP.findOne({
            userId: user._id,
        });

        if (!record || record.expiresAt <= new Date() || record.attempts >= 5) {
            return res.status(400).json({
                success: false,
                message: "OTP expired or attempts exceeded",
            });
        }

        record.attempts += 1;
        await record.save();

        if (!(await verifyOTPHash(String(otp), record.otpHash))) {
            return res.status(400).json({
                success: false,
                message: "Invalid OTP",
            });
        }

        const consumed = await PasswordResetOTP.deleteOne({
            _id: record._id,
            otpHash: record.otpHash,
        });

        if (consumed.deletedCount !== 1) {
            return res.status(400).json({
                success: false,
                message: "OTP already used",
            });
        }

        user.passwordHash = await bcrypt.hash(newPassword, 12);
        await user.save();

        await RefreshToken.deleteMany({ userId: user._id });

        return res.json({
            success: true,
            message: "Password reset successful. Please login.",
        });
    } catch (error) {
        console.error("Password reset error:", error.message);
        return res.status(500).json({
            success: false,
            message: "Password reset failed",
        });
    }
};

module.exports = { sendResetOTP, resetPassword };
