const bcrypt = require("bcryptjs");
const {
    generateAccessToken,
    generateRefreshToken,
    hashRefreshToken,
} = require("../services/tokenService");

const crypto = require("crypto");
const RefreshToken = require("../models/RefreshToken");
const User = require("../models/User");

const register = async (req, res) => {
    try {
        const { firstName, lastName, email, password, role } = req.body;

        if (role !== undefined && !["PASSENGER", "DRIVER"].includes(role)) {
            return res.status(400).json({
                success: false,
                message: "Invalid registration role",
            });
        }

        if (!firstName || !lastName || !email || !password) {
            return res.status(400).json({
                success: false,
                message: "All required fields must be provided",
            });
        }

        if (typeof password !== "string" || password.length < 8) {
            return res.status(400).json({
                success: false,
                message: "Password must be at least 8 characters",
            });
        }

        const normalizedEmail = String(email).trim().toLowerCase();

        const existingUser = await User.findOne({ email: normalizedEmail });

        if (existingUser) {
            return res.status(409).json({
                success: false,
                message: "Email already registered",
            });
        }

        return res.status(200).json({
            success: true,
            available: true,
            message: "Email available",
        });
    } catch (error) {
        if (error.code === 11000) {
            return res.status(409).json({
                success: false,
                message: "Email already registered",
            });
        }

        console.error("Registration error:", error.message);

        return res.status(500).json({
            success: false,
            message: "Registration failed",
        });
    }
};

const login = async (req, res) => {
    try {
        const { email, password } = req.body;

        if (typeof email !== "string" || typeof password !== "string") {
            return res.status(400).json({
                success: false,
                message: "Valid email and password are required",
            });
        }

        const user = await User.findOne({
            email: email.trim().toLowerCase(),
        }).select("+passwordHash");

        if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
            return res.status(401).json({
                success: false,
                message: "Invalid email or password",
            });
        }

        if (!user.emailVerified || user.status !== "ACTIVE") {
            return res.status(403).json({
                success: false,
                message: "Account is not verified or active",
            });
        }

        const token = generateAccessToken(user);
        const refreshToken = generateRefreshToken();

        await RefreshToken.create({
            userId: user._id,
            tokenHash: hashRefreshToken(refreshToken),
            familyId: crypto.randomUUID(),
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        });

        return res.status(200).json({
            success: true,
            message: "Login successful",
            accessToken: token,
            refreshToken,
            user: {
                id: user._id,
                firstName: user.firstName,
                lastName: user.lastName,
                email: user.email,
                role: user.role,
                activeMode: user.activeMode || "PASSENGER",
            },
        });
    } catch (error) {
        console.error("Login error:", error.message);

        return res.status(500).json({
            success: false,
            message: "Login failed",
        });
    }
};

module.exports = { register, login };