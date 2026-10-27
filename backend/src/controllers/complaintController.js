const mongoose = require("mongoose");
const Complaint = require("../models/Complaint");
const Ride = require("../models/Ride");
const ParcelOrder = require("../models/ParcelOrder");
const Driver = require("../models/Driver");
const User = require("../models/User");

const CATEGORIES = [
    "BEHAVIOUR",
    "FARE",
    "SAFETY",
    "VEHICLE",
    "SERVICE",
    "OTHER",
];

const isObjectId = (value) =>
    typeof value === "string" && mongoose.isValidObjectId(value);

// Best-effort: work out who a complaint is about from its linked
// ride/parcel so admins see it without the app having to send it.
async function deriveAgainstUser({ ride, parcelOrder, complainantRole, complainantId }) {
    try {
        if (ride) {
            if (complainantRole === "DRIVER") {
                return ride.passengerId || null;
            }
            if (ride.driverId) {
                const driver = await Driver.findById(ride.driverId)
                    .select("userId")
                    .lean();
                return driver?.userId || null;
            }
        }

        if (parcelOrder) {
            if (complainantRole === "DRIVER") {
                return parcelOrder.customerId || null;
            }
            if (parcelOrder.driverId) {
                const driver = await Driver.findById(parcelOrder.driverId)
                    .select("userId")
                    .lean();
                return driver?.userId || null;
            }
        }
    } catch {
        // Derivation is a convenience only; never block filing.
    }

    return null;
}

async function createComplaint(req, res) {
    try {
        const { category, ride, parcelOrder, againstUser } = req.body || {};
        const description = String(req.body?.description || "").trim();

        if (!CATEGORIES.includes(category)) {
            return res.status(400).json({
                success: false,
                message: "Please choose a valid complaint category",
            });
        }

        if (!description) {
            return res.status(400).json({
                success: false,
                message: "Please describe your complaint",
            });
        }

        if (description.length > 1000) {
            return res.status(400).json({
                success: false,
                message: "Description must be 1000 characters or fewer",
            });
        }

        let rideDoc = null;
        if (ride != null && ride !== "") {
            if (!isObjectId(ride)) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid ride reference",
                });
            }
            rideDoc = await Ride.findById(ride).lean();
            if (!rideDoc) {
                return res.status(400).json({
                    success: false,
                    message: "Linked ride not found",
                });
            }
        }

        let parcelDoc = null;
        if (parcelOrder != null && parcelOrder !== "") {
            if (!isObjectId(parcelOrder)) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid parcel reference",
                });
            }
            parcelDoc = await ParcelOrder.findById(parcelOrder).lean();
            if (!parcelDoc) {
                return res.status(400).json({
                    success: false,
                    message: "Linked parcel order not found",
                });
            }
        }

        const complainantRole =
            req.user.activeMode === "DRIVER" ? "DRIVER" : "PASSENGER";

        let against = null;
        if (againstUser != null && againstUser !== "") {
            if (!isObjectId(againstUser)) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid user reference",
                });
            }
            const user = await User.findById(againstUser).select("_id").lean();
            if (!user) {
                return res.status(400).json({
                    success: false,
                    message: "Reported user not found",
                });
            }
            against = user._id;
        } else {
            against = await deriveAgainstUser({
                ride: rideDoc,
                parcelOrder: parcelDoc,
                complainantRole,
                complainantId: req.user._id,
            });
        }

        const complaint = await Complaint.create({
            complainant: req.user._id,
            complainantRole,
            againstUser: against,
            ride: rideDoc?._id || null,
            parcelOrder: parcelDoc?._id || null,
            category,
            description,
        });

        return res.status(201).json({ success: true, complaint });
    } catch (error) {
        console.error("Create complaint error:", error.message);
        return res.status(500).json({
            success: false,
            message: "Unable to file complaint",
        });
    }
}

async function getMyComplaints(req, res) {
    try {
        const complaints = await Complaint.find({
            complainant: req.user._id,
        })
            .sort({ createdAt: -1 })
            .limit(100)
            .lean();

        return res.json({ success: true, complaints });
    } catch (error) {
        console.error("My complaints error:", error.message);
        return res.status(500).json({
            success: false,
            message: "Unable to load complaints",
        });
    }
}

module.exports = { createComplaint, getMyComplaints };
