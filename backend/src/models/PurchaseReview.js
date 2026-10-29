const mongoose = require("mongoose");

// Phase 4 — passenger's rating of the Buy & Deliver partner for one
// completed purchase order. Mirrors DriverReview; kept as its own
// collection because DriverReview.rideId is a required Ride ref. The
// Driver.rating aggregates are maintained from BOTH review collections
// (see purchaseController.ratePurchasePartner).
const purchaseReviewSchema = new mongoose.Schema({
    purchaseOrderId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "PurchaseOrder",
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

module.exports = mongoose.model("PurchaseReview", purchaseReviewSchema);
