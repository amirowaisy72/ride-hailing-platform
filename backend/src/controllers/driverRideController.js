const Ride = require("../models/Ride");
const Driver = require("../models/Driver");
const Vehicle = require("../models/Vehicle");
const DriverMissedRide = require("../models/DriverMissedRide");
const RideOffer = require("../models/RideOffer");
const { canReceiveRideRequests } = require("../services/eligibilityService");
const { servableRideTypes } = require("../services/driverMatchingService");

const getAvailableRides = async (req, res) => {
    try {
        const driver = await Driver.findOne({
            userId: req.user._id,
            isOnline: true,
            isAvailable: true,
        });

        // Same eligibility source of truth as the offer/select gates:
        // a per-service RIDE approval (global status PENDING) counts,
        // the legacy global APPROVED derives it, no approval = no feed.
        if (!driver || !(await canReceiveRideRequests(driver))) {
            return res.json({ success: true, rides: [] });
        }

        const vehicle = await Vehicle.findOne({
            _id: driver.currentVehicleId,
            driverId: driver._id,
            verificationStatus: "APPROVED",
            isActive: true,
        });

        if (!vehicle) {
            return res.json({ success: true, rides: [] });
        }

        if (
            !Array.isArray(driver.currentLocation?.coordinates) ||
            driver.currentLocation.coordinates.length !== 2 ||
            driver.currentLocation.coordinates.every((value) => value === 0)
        ) {
            return res.json({
                success: true,
                rides: [],
                message: "Accurate driver location required",
            });
        }

        if (
            !driver.lastLocationUpdate ||
            Date.now() - new Date(driver.lastLocationUpdate).getTime() > 120000
        ) {
            return res.json({
                success: true,
                rides: [],
                message: "Fresh GPS location required",
            });
        }

        // Missed rides never come back for this driver, and rides older
        // than the auto-expiry window are hidden here even before the
        // periodic expiry job runs, so drivers never see stale work.
        const missedRideIds = await DriverMissedRide.distinct("rideId", {
            driverId: driver._id,
        });

        const rides = await Ride.find({
            vehicleType: { $in: servableRideTypes(vehicle.vehicleType) },
            status: { $in: ["REQUESTED", "SEARCHING", "BIDDING"] },
            driverId: null,
            _id: { $nin: missedRideIds },
            createdAt: { $gte: new Date(Date.now() - 15 * 60 * 1000) },
            pickup: {
                $near: {
                    $geometry: driver.currentLocation,
                    $maxDistance: 15000,
                },
            },
        })
            .limit(30)
            .sort({ createdAt: -1 })
            .select("pickup destination stops requestedPrice vehicleType tripType distance estimatedDuration status createdAt");

        // The driver's own live offers ride along with the feed, so a
        // reload still shows their bid instead of the original fare.
        // Additive only: one optional field on rides the driver has
        // offered on; every other ride is unchanged.
        let myOffers = [];
        if (rides.length > 0) {
            myOffers = await RideOffer.find({
                driverId: driver._id,
                rideId: { $in: rides.map((ride) => ride._id) },
                status: "PENDING",
            }).select("rideId price status");
        }
        const offersByRide = new Map(
            myOffers.map((offer) => [String(offer.rideId), offer])
        );
        const ridesWithOffers = rides.map((ride) => {
            const plain = ride.toObject();
            const offer = offersByRide.get(String(ride._id));
            if (offer) plain.myOffer = { price: offer.price, status: offer.status };
            return plain;
        });

        return res.json({ success: true, rides: ridesWithOffers });
    } catch (error) {
        console.error("Available rides error:", error.message);
        return res.status(500).json({
            success: false,
            message: "Failed to load available rides",
        });
    }
};

const getMyActiveRide = async (req, res) => {
    try {
        const driver = await Driver.findOne({
            userId: req.user._id,
        });

        if (!driver) {
            return res.status(404).json({
                success: false,
                message: "Driver profile not found",
            });
        }

        const ride = await Ride.findOne({
            driverId: driver._id,
            status: {
                $in: [
                    "DRIVER_SELECTED",
                    "DRIVER_EN_ROUTE",
                    "DRIVER_ARRIVED",
                    "TRIP_STARTED",
                ],
            },
        }).sort({ createdAt: -1 })
            .populate("passengerId", "firstName lastName profileImage");

        return res.json({ success: true, ride });
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: "Failed to restore active ride",
        });
    }
};

const missRide = async (req, res) => {
    try {
        const driver = await Driver.findOne({ userId: req.user._id });
        if (!driver) {
            return res.status(404).json({
                success: false,
                message: "Driver profile not found",
            });
        }

        const { rideId } = req.body || {};
        if (!rideId) {
            return res.status(400).json({
                success: false,
                message: "rideId is required",
            });
        }

        // Idempotent: missing the same ride twice is still just missed.
        await DriverMissedRide.updateOne(
            { driverId: driver._id, rideId },
            { $setOnInsert: { driverId: driver._id, rideId } },
            { upsert: true }
        );

        return res.json({ success: true, message: "Ride missed." });
    } catch (error) {
        console.error("Miss ride error:", error.message);
        return res.status(500).json({
            success: false,
            message: "Unable to miss ride.",
        });
    }
};

module.exports = { getAvailableRides, getMyActiveRide, missRide };