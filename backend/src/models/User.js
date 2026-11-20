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
        // Passenger No-Show Fix (To-Do #1): repeat no-show
        // warning/counter on the passenger record. Counts rides the
        // driver cancelled as a passenger no-show after the 5-minute
        // arrival wait; the warning timestamp marks when the passenger
        // was last warned about repeat no-shows.
        rideNoShowCount: {
            type: Number,
            default: 0,
            min: 0,
        },
        rideNoShowWarningAt: {
            type: Date,
            default: null,
        },
        // Invite System (To-Do #6): per-user unique invite code.
        // ADDITIVE optional — existing users have none until one is
        // generated on first use. invitedBy records who invited this
        // user (signup attribution only); NO reward logic attached.
        inviteCode: {
            type: String,
            trim: true,
            uppercase: true,
            unique: true,
            sparse: true,
            default: null,
        },
        invitedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            default: null,
        },
        invitedAt: {
            type: Date,
            default: null,
        },
    },
    { timestamps: true }
);

module.exports = mongoose.model("User", userSchema);