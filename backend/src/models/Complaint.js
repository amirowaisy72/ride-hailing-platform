const mongoose = require("mongoose");

// A complaint filed by a passenger or driver, optionally linked to a
// ride or parcel order, and handled by admins from the dashboard.
const complaintSchema = new mongoose.Schema(
    {
        complainant: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
            index: true,
        },
        complainantRole: {
            type: String,
            enum: ["PASSENGER", "DRIVER"],
            required: true,
        },
        againstUser: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            default: null,
        },
        ride: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Ride",
            default: null,
        },
        parcelOrder: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "ParcelOrder",
            default: null,
        },
        category: {
            type: String,
            enum: [
                "BEHAVIOUR",
                "FARE",
                "SAFETY",
                "VEHICLE",
                "SERVICE",
                "OTHER",
            ],
            required: true,
        },
        description: {
            type: String,
            required: true,
            trim: true,
            maxlength: 1000,
        },
        status: {
            type: String,
            enum: ["OPEN", "IN_REVIEW", "RESOLVED", "REJECTED"],
            default: "OPEN",
            index: true,
        },
        adminNote: {
            type: String,
            trim: true,
            maxlength: 1000,
            default: "",
        },
    },
    { timestamps: true }
);

complaintSchema.index({ createdAt: -1 });

module.exports = mongoose.model("Complaint", complaintSchema);
