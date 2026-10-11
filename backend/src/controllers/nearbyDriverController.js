const mongoose = require("mongoose");
const Ride = require("../models/Ride");
const Driver = require("../models/Driver");
const Vehicle = require("../models/Vehicle");

// Approximate, anonymous markers only. Never expose exact driver GPS on a public discovery map.
async function nearbyDriversForRide(req, res) {
    try {
        if (!mongoose.isValidObjectId(req.params.rideId)) {
            return res.status(400).json({ success: false, message: "Invalid ride ID" });
        }
        const ride = await Ride.findOne({
            _id: req.params.rideId,
            passengerId: req.user._id,
            status: { $in: ["REQUESTED", "SEARCHING", "BIDDING"] },
            driverId: null,
        }).select("pickup vehicleType").lean();
        if (!ride) return res.status(404).json({ success: false, message: "Active ride not found" });

        const vehicleIds = await Vehicle.distinct("_id", {
            vehicleType: ride.vehicleType, verificationStatus: "APPROVED", isActive: true,
        });
        const drivers = await Driver.find({
            verificationStatus: "APPROVED", isOnline: true, isAvailable: true,
            currentVehicleId: { $in: vehicleIds },
            lastLocationUpdate: { $gte: new Date(Date.now() - 120000) },
            currentLocation: {
                $near: { $geometry: ride.pickup, $maxDistance: 15000 },
            },
        }).limit(30).select("currentLocation").lean();

        // Grid aggregation removes individual precise GPS and protects driver identity.
        const cells = new Map();
        for (const driver of drivers) {
            const [lng, lat] = driver.currentLocation?.coordinates || [];
            if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
            const latitude = Math.round(lat * 100) / 100;
            const longitude = Math.round(lng * 100) / 100;
            const key = `${latitude}:${longitude}`;
            const previous = cells.get(key) || { latitude, longitude, count: 0 };
            previous.count += 1;
            cells.set(key, previous);
        }
        res.set("Cache-Control", "private, no-store");
        return res.json({
            success: true, approximate: true, radiusKm: 15,
            onlineDrivers: drivers.length, cells: [...cells.values()]
        });
    } catch (error) {
        console.error("Nearby driver discovery:", error.message);
        return res.status(500).json({ success: false, message: "Unable to find nearby drivers" });
    }
}
module.exports = { nearbyDriversForRide };
