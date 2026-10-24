const bcrypt = require("bcryptjs");
const User = require("../models/User");
const { generateOTP, hashOTP, verifyOTPHash } =
    require("../services/otpService");
const { sendOTPEmail } =
    require("../integrations/email/emailService");

const pendingOTPs = new Map();

async function sendSignupOTP(req, res) {
    const email = String(req.body.email || "").trim().toLowerCase();

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ message: "Invalid email" });
    }

    if (await User.exists({ email })) {
        return res.status(409).json({ message: "Email already registered" });
    }

    const existing = pendingOTPs.get(email);

    if (existing && Date.now() - existing.sentAt < 60000) {
        return res.status(429).json({
            message: "Wait 60 seconds before requesting another OTP",
        });
    }

    try {
        const otp = generateOTP();
        const otpHash = await hashOTP(otp);

        pendingOTPs.set(email, {
            otpHash,
            attempts: 0,
            sentAt: Date.now(),
            expiresAt: Date.now() + 600000,
            verifying: false,
        });

        await sendOTPEmail(email, otp);

        return res.json({
            success: true,
            message: "OTP sent successfully",
        });
    } catch (error) {
        pendingOTPs.delete(email);
        return res.status(500).json({
            message: "Unable to send OTP",
        });
    }
}

async function verifySignupOTP(req, res) {
    const { firstName, lastName, password, otp } = req.body;
    const email = String(req.body.email || "").trim().toLowerCase();

    if (
        typeof firstName !== "string" ||
        firstName.trim().length < 2 ||
        firstName.trim().length > 50 ||
        typeof lastName !== "string" ||
        lastName.trim().length < 2 ||
        lastName.trim().length > 50 ||
        typeof password !== "string" ||
        password.length < 8 ||
        password.length > 128 ||
        typeof otp !== "string" ||
        !/^\d{6}$/.test(otp)
    ) {
        return res.status(400).json({
            message: "Invalid registration details",
        });
    }

    const record = pendingOTPs.get(email);

    if (!record || Date.now() > record.expiresAt ||
        record.attempts >= 5) {
        return res.status(400).json({
            message: "OTP expired or attempts exceeded",
        });
    }

    if (record.verifying) {
        return res.status(409).json({
            message: "Verification already in progress",
        });
    }

    record.verifying = true;

    try {
        record.attempts++;

        if (!(await verifyOTPHash(otp, record.otpHash))) {
            return res.status(400).json({ message: "Invalid OTP" });
        }

        // Single-use OTP: consume before account creation.
        pendingOTPs.delete(email);

        if (await User.exists({ email })) {
            return res.status(409).json({
                message: "Email already registered",
            });
        }

        const user = await User.create({
            firstName: firstName.trim(),
            lastName: lastName.trim(),
            email,
            passwordHash: await bcrypt.hash(password, 12),
            role: "PASSENGER",
            activeMode: "PASSENGER",
            emailVerified: true,
            status: "ACTIVE",
        });

        return res.status(201).json({
            success: true,
            message: "Account created successfully",
            userId: user._id,
        });
    } catch (error) {
        return res.status(error.code === 11000 ? 409 : 500).json({
            message: error.code === 11000
                ? "Email already registered"
                : "Account creation failed. Please restart signup.",
        });
    } finally {
        record.verifying = false;
    }
}

module.exports = { sendSignupOTP, verifySignupOTP };