const mongoose = require("mongoose");

// General feedback ABOUT THE SAFAR APP itself (suggestions for
// improvement, etc.) — not a rating of a driver, ride, rental or
// purchase. Those per-service ratings already exist and are untouched.
// The submitter's role comes from the logged-in user's active mode,
// never from a form field, so it cannot be spoofed by the client.
const feedbackSchema = new mongoose.Schema(
    {
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
            index: true,
        },
        userRole: {
            type: String,
            enum: ["PASSENGER", "DRIVER"],
            required: true,
        },
        category: {
            type: String,
            enum: [
                "APP",
                "RIDE",
                "PARCEL",
                "RENTAL",
                "BUY_DELIVER",
                "PAYMENT",
                "OTHER",
            ],
            default: "APP",
        },
        // Optional 1-5 star rating of the app; null means "not given".
        rating: {
            type: Number,
            min: 1,
            max: 5,
            default: null,
        },
        // The suggestion / improvement message — the main field.
        message: {
            type: String,
            required: true,
            trim: true,
            maxlength: 1000,
        },
        status: {
            type: String,
            enum: ["NEW", "REVIEWED"],
            default: "NEW",
            index: true,
        },
    },
    { timestamps: true }
);

feedbackSchema.index({ createdAt: -1 });

module.exports = mongoose.model("Feedback", feedbackSchema);
