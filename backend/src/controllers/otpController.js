const User = require("../models/User");
const EmailOTP = require("../models/EmailOTP");
const { generateOTP, hashOTP, verifyOTPHash } = require("../services/otpService");
const { sendOTPEmail } = require("../integrations/email/emailService");

const sendOTP = async (req, res) => {
    try {
        const { email } = req.body;

        if (typeof email !== "string" || !email.trim()) {
            return res.status(400).json({ success: false, message: "Valid email required" });
        }

        const user = await User.findOne({ email: email.trim().toLowerCase() });

        if (!user) {
            return res.status(404).json({ success: false, message: "User not found" });
        }

        if (user.emailVerified) {
            return res.status(400).json({ success: false, message: "Email already verified" });
        }

        const existing = await EmailOTP.findOne({ userId: user._id });

        if (existing && Date.now() - existing.createdAt.getTime() < 60000) {
            return res.status(429).json({ success: false, message: "Wait 60 seconds before requesting another OTP" });
        }

        const otp = generateOTP();

        await EmailOTP.findOneAndUpdate(
            { userId: user._id },
            {
                otpHash: await hashOTP(otp),
                expiresAt: new Date(Date.now() + 10 * 60 * 1000),
                attempts: 0,
                createdAt: new Date(),
            },
            { upsert: true, returnDocument: "after" }
        );

        await sendOTPEmail(user.email, otp);

        return res.json({ success: true, message: "OTP sent successfully" });
    } catch (error) {
        console.error("Send OTP error:", error.message);
        return res.status(500).json({ success: false, message: "Failed to send OTP" });
    }
};

const verifyOTP = async (req, res) => {
    try {
        const { email, otp } = req.body;

        if (typeof email !== "string" || typeof otp !== "string" || !/^\d{6}$/.test(otp)) {
            return res.status(400).json({ success: false, message: "Valid email and 6-digit OTP required" });
        }

        const user = await User.findOne({ email: email.trim().toLowerCase() });

        if (!user) {
            return res.status(400).json({ success: false, message: "Invalid verification request" });
        }

        const record = await EmailOTP.findOne({ userId: user._id });

        if (!record || record.expiresAt < new Date() || record.attempts >= 5) {
            return res.status(400).json({ success: false, message: "OTP expired or attempts exceeded" });
        }

        record.attempts += 1;
        await record.save();

        if (!(await verifyOTPHash(otp, record.otpHash))) {
            return res.status(400).json({ success: false, message: "Invalid OTP" });
        }

        user.emailVerified = true;
        user.status = "ACTIVE";
        await user.save();

        await EmailOTP.deleteOne({ _id: record._id });

        return res.json({ success: true, message: "Email verified successfully" });
    } catch (error) {
        console.error("Verify OTP error:", error.message);
        return res.status(500).json({ success: false, message: "OTP verification failed" });
    }
};

module.exports = { sendOTP, verifyOTP };