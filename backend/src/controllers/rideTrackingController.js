const mongoose = require("mongoose");
const Ride = require("../models/Ride");
const Driver = require("../models/Driver");
async function getRideDriverLocation(req, res) {
    try {
        if (!mongoose.isValidObjectId(req.params.rideId)) return res.status(400).json({ success: false, message: "Invalid ride ID" });
        const ride = await Ride.findOne({
            _id: req.params.rideId,
            passengerId: req.user._id,
            status: { $in: ["DRIVER_SELECTED", "DRIVER_EN_ROUTE", "DRIVER_ARRIVED", "TRIP_STARTED"] },
        }).select("driverId");
        if (!ride?.driverId) return res.status(404).json({ success: false, message: "Active assigned ride not found" });
        const driver = await Driver.findById(ride.driverId).select("currentLocation lastLocationUpdate");
        const coords = driver?.currentLocation?.coordinates;
        const fresh = driver?.lastLocationUpdate && (Date.now() - new Date(driver.lastLocationUpdate).getTime() < 120000);
        if (!fresh || !Array.isArray(coords) || coords.length !== 2 || !coords.every(Number.isFinite)) {
            return res.json({ success: true, location: null, updatedAt: null });
        }
        return res.json({ success: true, location: { longitude: coords[0], latitude: coords[1] }, updatedAt: driver.lastLocationUpdate });
    } catch (error) { console.error("Get assigned driver location", error); return res.status(500).json({ success: false, message: "Location unavailable" }); }
}
module.exports = { getRideDriverLocation };
