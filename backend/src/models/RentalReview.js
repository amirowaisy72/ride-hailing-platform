const mongoose = require("mongoose");

// Phase 5 — passenger's rating of a rental partner for one completed
// rental booking. Mirrors PurchaseReview; kept as its own collection
// because PurchaseReview keys on a Driver ref. Ratings maintain the
// aggregates on BOTH the RentalVehicle listing and the RentalPartner
// (see rentalBookingController.rateRentalPartner).
const rentalReviewSchema = new mongoose.Schema({
    rentalBookingId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "RentalBooking",
        required: true,
        unique: true,
    },
    passengerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
    },
    rentalPartnerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "RentalPartner",
        required: true,
        index: true,
    },
    vehicleId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "RentalVehicle",
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

module.exports = mongoose.model("RentalReview", rentalReviewSchema);
