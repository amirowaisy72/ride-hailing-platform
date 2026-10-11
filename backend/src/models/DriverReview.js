const mongoose = require("mongoose");

const driverReviewSchema = new mongoose.Schema({
    rideId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Ride",
        required: true,
        unique: true,
    },
    passengerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
    },
    driverId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Driver",
        required: true,
        index: true,
    },
    rating: {
        type: Number,
        required: true,
        min: 1,
        max: 5,
    },
    comment: {
        type: String,
        trim: true,
        maxlength: 1000,
        default: "",
    },
    isHidden: {
        type: Boolean,
        default: false,
    },
}, { timestamps: true });

module.exports = mongoose.model("DriverReview", driverReviewSchema);