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
        // ADDITIVE thread: previously a complaint was a single
        // description plus one adminNote, so once the admin replied
        // the conversation was dead — the user had no way to answer
        // back on the same complaint. Messages keep the whole
        // back-and-forth on the complaint until it is resolved.
        // adminNote is kept (mirroring the latest admin message) so
        // older app/dashboard versions still show a reply.
        messages: [
            {
                sender: {
                    type: String,
                    enum: ["USER", "ADMIN"],
                    required: true,
                },
                message: {
                    type: String,
                    required: true,
                    trim: true,
                    maxlength: 1000,
                },
                createdAt: {
                    type: Date,
                    default: Date.now,
                },
            },
        ],
    },
    { timestamps: true }
);

complaintSchema.index({ createdAt: -1 });

module.exports = mongoose.model("Complaint", complaintSchema);
