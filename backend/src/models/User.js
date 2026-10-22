const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
    {
        firstName: {
            type: String,
            required: true,
            trim: true,
        },
        lastName: {
            type: String,
            required: true,
            trim: true,
        },
        email: {
            type: String,
            required: true,
            unique: true,
            lowercase: true,
            trim: true,
        },
        passwordHash: {
            type: String,
            required: true,
            select: false,
        },
        role: {
            type: String,
            enum: ["PASSENGER", "DRIVER", "ADMIN"],
            required: true,
        },
        activeMode: {
            type: String,
            enum: ["PASSENGER", "DRIVER"],
            default: "PASSENGER",
        },
        emailVerified: {
            type: Boolean,
            default: false,
        },
        status: {
            type: String,
            enum: ["ACTIVE", "PENDING", "SUSPENDED"],
            default: "PENDING",
        },
        rating: {
            type: Number,
            default: 0,
        },
        ratingCount: {
            type: Number,
            default: 0,
        },
        profileImage: {
            type: String,
            default: null,
        },
    },
    { timestamps: true }
);

module.exports = mongoose.model("User", userSchema);