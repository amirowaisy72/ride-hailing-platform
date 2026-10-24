
const crypto = require("crypto");
const User = require("../models/User");
const RefreshToken = require("../models/RefreshToken");
const { getFirebaseAuth } = require("../services/firebaseService");
const {
    generateAccessToken,
    generateRefreshToken,
    hashRefreshToken,
} = require("../services/tokenService");

const googleLogin = async (req, res) => {
    const { idToken } = req.body || {};

    if (typeof idToken !== "string" || !idToken) {
        return res.status(400).json({
            success: false,
            message: "Google ID token required",
        });
    }

    try {
        const decoded = await getFirebaseAuth().verifyIdToken(idToken);

        if (
            decoded.firebase?.sign_in_provider !== "google.com" ||
            !decoded.email ||
            !decoded.email_verified
        ) {
            return res.status(401).json({
                success: false,
                message: "Verified Google account required",
            });
        }

        const email = decoded.email.trim().toLowerCase();

        let user = await User.findOne({
            googleUid: decoded.uid,
        });

        if (!user) {
            const existing = await User.findOne({ email });

            if (existing) {
                if (existing.status !== "ACTIVE" || !existing.emailVerified) {
                    return res.status(403).json({
                        success: false,
                        message: "Account is not verified or active",
                    });
                }

                existing.googleUid = decoded.uid;
                await existing.save();

                user = existing;
            } else {
                const name = (decoded.name || "").trim().split(/\s+/);

                user = await User.create({
                    firstName: name[0] || "Google",
                    lastName: name.slice(1).join(" ") || "User",
                    email,
                    googleUid: decoded.uid,
                    role: "PASSENGER",
                    activeMode: "PASSENGER",
                    emailVerified: true,
                    status: "ACTIVE",
                });
            }

        }

        if (user.status !== "ACTIVE" || !user.emailVerified) {
            return res.status(403).json({
                success: false,
                message: "Account is not active",
            });
        }

        const accessToken = generateAccessToken(user);
        const refreshToken = generateRefreshToken();

        await RefreshToken.create({
            userId: user._id,
            tokenHash: hashRefreshToken(refreshToken),
            familyId: crypto.randomUUID(),
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        });

        return res.json({
            success: true,
            accessToken,
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
        console.error("Google login error:", error.message);

        if (error.code === 11000) {
            return res.status(409).json({
                success: false,
                message: "Account already exists. Please retry or use your existing login.",
            });
        }

        return res.status(401).json({
            success: false,
            message: "Google authentication failed",
        });
    }
};

module.exports = { googleLogin };
