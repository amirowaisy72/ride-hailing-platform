const mongoose = require("mongoose");

const driverDocumentSchema = new mongoose.Schema(
    {
        driverId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Driver",
            required: true,
            index: true,
        },
        documentType: {
            type: String,
            enum: [
                "CNIC_FRONT",
                "CNIC_BACK",
                "DRIVING_LICENSE",
                "VEHICLE_REGISTRATION",
                "INSURANCE",
                "VEHICLE_PHOTO",
                "PROFILE_PHOTO",
            ],
            required: true,
        },
        imageUrl: {
            type: String,
            required: true,
        },
        cloudinaryPublicId: {
            type: String,
            required: true,
        },
        verificationStatus: {
            type: String,
            enum: ["PENDING", "APPROVED", "REJECTED"],
            default: "PENDING",
        },
        rejectionReason: {
            type: String,
            default: null,
        },
    },
    { timestamps: true }
);

module.exports = mongoose.model("DriverDocument", driverDocumentSchema);