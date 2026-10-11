const jwt = require("jsonwebtoken");

const generateAccessToken = (user) => {
    return jwt.sign(
        {
            userId: user._id.toString(),
            role: user.role,
        },
        process.env.JWT_SECRET,
        {
            expiresIn: "15m",
            algorithm: "HS256",
        }
    );
};

const crypto = require("crypto");

const generateRefreshToken = () => {
    return crypto.randomBytes(32).toString("hex");
};

const hashRefreshToken = (token) => {
    return crypto.createHash("sha256").update(token).digest("hex");
};

module.exports = {
    generateAccessToken,
    generateRefreshToken,
    hashRefreshToken,
};