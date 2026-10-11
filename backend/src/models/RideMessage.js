const mongoose = require("mongoose");
const schema = new mongoose.Schema({
    rideId: { type: mongoose.Schema.Types.ObjectId, ref: "Ride", required: true, index: true },
    senderId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    body: { type: String, required: true, trim: true, minlength: 1, maxlength: 1000 },
    readAt: { type: Date, default: null },
}, { timestamps: true });
schema.index({ rideId: 1, createdAt: -1 });
module.exports = mongoose.model("RideMessage", schema);
