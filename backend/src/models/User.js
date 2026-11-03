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
        // ADDITIVE: users previously had no way to enter a phone
        // number anywhere, so support could not call them and the
        // dashboard could not show one. Optional, so existing
        // accounts (including Google signups) keep working.
        phone: {
            type: String,
            trim: true,
            default: null,
        },
        passwordHash: {
            type: String,
            required: function () {
                return !this.googleUid;
            },
            select: false,
        },
        googleUid: {
            type: String,
            unique: true,
            sparse: true,
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