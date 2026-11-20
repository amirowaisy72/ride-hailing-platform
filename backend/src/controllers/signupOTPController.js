const bcrypt = require("bcryptjs");
const User = require("../models/User");
const { normalizePkPhone } = require("../utils/pakistaniPhone");
const { isNewClient } = require("../utils/clientVersion");
const Driver = require("../models/Driver");
const { generateOTP, hashOTP, verifyOTPHash } =
    require("../services/otpService");
const {
    resolveInviteCode,
    ensureInviteCode,
} = require("../services/inviteService");
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
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.statusCode === 503
                ? "OTP email service is disabled by Admin. Please try again later."
                : "Unable to send OTP",
        });
    }
}

async function verifySignupOTP(req, res) {
    const { firstName, lastName, password, otp } = req.body;
    const email = String(req.body.email || "").trim().toLowerCase();
    // BACKWARD COMPAT: mobile is mandatory ONLY for new-version
    // clients (X-App-Version-Code >= 10). Old apps (no version
    // header) keep the old behaviour — phone optional, any
    // international format — so they keep working exactly as today.
    // New clients must send a valid Pakistani number, no bypass.
    let normalizedPhone = null;
    if (isNewClient(req)) {
        normalizedPhone = normalizePkPhone(req.body.phone);
        if (!normalizedPhone) {
            return res.status(400).json({
                message:
                    "A valid Pakistani mobile number is required (e.g. 0301-2345678)",
            });
        }
    } else {
        const legacyPhone =
            typeof req.body.phone === "string"
                ? req.body.phone.replace(/[\s-]/g, "").trim()
                : "";
        if (legacyPhone && !/^\+?\d{10,15}$/.test(legacyPhone)) {
            return res.status(400).json({
                message: "Invalid phone number",
            });
        }
        normalizedPhone = legacyPhone || null;
    }

    // Optional role from signup: only DRIVER is accepted as an
    // alternative; anything else (including a missing role) keeps the
    // long-standing PASSENGER default, so existing clients are
    // completely unaffected.
    const requestedRole = req.body.role === "DRIVER" ? "DRIVER" : "PASSENGER";

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

        // Invite System (To-Do #6): an optional inviteCode in the
        // signup form attributes the inviter. Invalid/unknown codes
        // are ignored silently — a bad code must never block signup.
        let invitedBy = null;
        if (typeof req.body.inviteCode === "string" && req.body.inviteCode.trim()) {
            try {
                const inviter = await resolveInviteCode(req.body.inviteCode);
                if (inviter) invitedBy = inviter._id;
            } catch {
                // Ignore — signup proceeds unattributed.
            }
        }

        const user = await User.create({
            firstName: firstName.trim(),
            lastName: lastName.trim(),
            email,
            phone: normalizedPhone,
            passwordHash: await bcrypt.hash(password, 12),
            role: requestedRole,
            activeMode: requestedRole,
            emailVerified: true,
            status: "ACTIVE",
            invitedBy,
            invitedAt: invitedBy ? new Date() : null,
        });

        // Every account gets its own invite code from day one.
        // Best-effort: a failure here never fails the signup.
        try {
            await ensureInviteCode(user);
        } catch {
            // The code is generated lazily on first /invites/me call.
        }

        // A driver signup also creates the Driver profile the driver
        // setup gate expects (verification PENDING, so the guided
        // setup flow opens on first login). Profile creation must
        // never fail signup itself: if it errors, the account still
        // stands and the profile can be created later via the
        // existing driver registration endpoint.
        if (requestedRole === "DRIVER") {
            try {
                await Driver.create({ userId: user._id });
            } catch (driverError) {
                console.error(
                    "Driver profile creation at signup failed:",
                    driverError.message
                );
            }
        }

        return res.status(201).json({
            success: true,
            message: "Account created successfully",
            userId: user._id,
        });
    } catch (error) {
        // A duplicate key is NOT always the email: any unique index
        // (e.g. inviteCode) throws 11000 too. Only an actual email
        // duplicate is "already registered" — anything else must say
        // so in the logs, or the real cause stays hidden (Nov 2026:
        // inviteCode nulls 11000'd every signup while the user saw
        // "Email already registered").
        if (error.code === 11000) {
            console.error("Verify signup OTP duplicate key:", {
                keyPattern: error.keyPattern,
                keyValue: error.keyValue,
            });
            const emailDup =
                error.keyPattern && error.keyPattern.email;
            return res.status(emailDup ? 409 : 500).json({
                message: emailDup
                    ? "Email already registered"
                    : "Account creation failed. Please restart signup.",
            });
        }
        return res.status(500).json({
            message: "Account creation failed. Please restart signup.",
        });
    } finally {
        record.verifying = false;
    }
}

module.exports = { sendSignupOTP, verifySignupOTP };