
const Ride = require("../models/Ride");
const { publishEvent } = require("../services/socketService");
const { sendPushToUser } = require("../services/pushService");
const { findDriversWithExpandedRadius } = require("../services/driverMatchingService");
const { isLocationSupported } = require("../services/serviceAreaService");
const { getRoute } = require("../integrations/maps/mapService");
const { calculateSuggestedFare } = require("../services/fareService");

const createRide = async (req, res) => {
    try {
        const {
            pickup,
            destination,
            stops = [],
            requestedPrice,
            vehicleType,
            tripType = "ONE_WAY",
            passengerCount = 1,
            notes = "",
        } = req.body || {};

        const validPoint = (point) =>
            point &&
            typeof point.latitude === "number" &&
            typeof point.longitude === "number" &&
            Number.isFinite(point.latitude) &&
            Number.isFinite(point.longitude) &&
            Math.abs(point.latitude) <= 90 &&
            Math.abs(point.longitude) <= 180;

        if (
            !validPoint(pickup) ||
            !validPoint(destination) ||
            (tripType === "ROUND_TRIP" &&
                pickup.latitude === destination.latitude &&
                pickup.longitude === destination.longitude) ||
            !Array.isArray(stops) ||
            stops.length > (tripType === "ROUND_TRIP" ? 4 : 5) ||
            stops.some(
                (stop) =>
                    !validPoint(stop) ||
                    (stop.name !== undefined &&
                        (typeof stop.name !== "string" ||
                            stop.name.length > 200))
            )
        ) {
            return res.status(400).json({
                success: false,
                message: "Invalid pickup, destination, or trip stops. Round trips require different outbound and pickup locations and support up to 4 additional stops.",
            });
        }

        if (
            typeof requestedPrice !== "number" ||
            !Number.isFinite(requestedPrice) ||
            requestedPrice <= 0 ||
            !["ONE_WAY", "ROUND_TRIP"].includes(tripType) ||
            !["BIKE", "RICKSHAW", "CAR_AC", "CAR_NON_AC"].includes(vehicleType) ||
            !Number.isInteger(passengerCount) ||
            passengerCount < 1 ||
            passengerCount > 6 ||
            typeof notes !== "string" ||
            notes.length > 500
        ) {
            return res.status(400).json({
                success: false,
                message: "Invalid ride details",
            });
        }

        const existingRide = await Ride.exists({
            passengerId: req.user._id,
            status: {
                $in: [
                    "REQUESTED", "SEARCHING", "BIDDING",
                    "DRIVER_SELECTED", "DRIVER_EN_ROUTE",
                    "DRIVER_ARRIVED", "TRIP_STARTED", "REASSIGNING",
                ],
            },
        });

        if (existingRide) {
            return res.status(409).json({
                success: false,
                message: "You already have an active ride",
            });
        }

        const [pickupArea, destinationArea] = await Promise.all([
            isLocationSupported(pickup.latitude, pickup.longitude),
            isLocationSupported(destination.latitude, destination.longitude),
        ]);

        if (!pickupArea.supported || !destinationArea.supported) {
            return res.status(400).json({
                success: false,
                message: "Pickup or destination outside service area",
            });
        }

        const supportedStops = await Promise.all(
            stops.map((stop) =>
                isLocationSupported(stop.latitude, stop.longitude)
            )
        );

        if (supportedStops.some((area) => !area.supported)) {
            return res.status(400).json({
                success: false,
                message: "One or more stops are outside the service area",
            });
        }

        const waypoints = [
            pickup,
            ...stops,
            destination,
            ...(tripType === "ROUND_TRIP" ? [pickup] : []),
        ];

        const legs = await Promise.all(
            waypoints.slice(0, -1).map((point, index) =>
                getRoute(point, waypoints[index + 1])
            )
        );

        if (legs.some((leg) =>
            !Number.isFinite(leg.distanceKm) ||
            !Number.isFinite(leg.durationMinutes) ||
            leg.distanceKm <= 0 ||
            leg.durationMinutes < 0
        )) {
            return res.status(400).json({
                success: false,
                message: "Unable to calculate complete journey",
            });
        }

        const route = {
            distanceKm: Number(
                legs.reduce((sum, leg) => sum + leg.distanceKm, 0).toFixed(2)
            ),
            durationMinutes: Math.ceil(
                legs.reduce((sum, leg) => sum + leg.durationMinutes, 0)
            ),
        };

        const pricing = await calculateSuggestedFare(
            vehicleType,
            route.distanceKm
        );

        // Suggested fare is calculated by the backend.
        // Passenger's proposed fare remains negotiable.
        const ride = await Ride.create({
            passengerId: req.user._id,
            pickup: {
                type: "Point",
                coordinates: [pickup.longitude, pickup.latitude],
            },
            destination: {
                type: "Point",
                coordinates: tripType === "ROUND_TRIP"
                    ? [pickup.longitude, pickup.latitude]
                    : [destination.longitude, destination.latitude],
            },
            stops: [
                ...stops.map((stop) => ({
                    type: "Point",
                    coordinates: [stop.longitude, stop.latitude],
                    name: (stop.name || "").trim(),
                })),
                ...(tripType === "ROUND_TRIP"
                    ? [{
                        type: "Point",
                        coordinates: [destination.longitude, destination.latitude],
                        name: "Outbound destination",
                    }]
                    : []),
            ],
            requestedPrice,
            vehicleType,
            tripType,
            passengerCount,
            notes,
            distance: route.distanceKm,
            estimatedDuration: route.durationMinutes,
        });

        // Notify nearby approved, online and available drivers.
        try {
            const { drivers } = await findDriversWithExpandedRadius(
                pickup.longitude,
                pickup.latitude,
                vehicleType
            );

            for (const driver of drivers) {
                void sendPushToUser(
                    driver.userId,
                    "New Ride Request",
                    "A passenger is requesting a ride nearby.",
                    { type: "RIDE_REQUEST", rideId: String(ride._id) }
                );

                publishEvent(
                    "ride:created",
                    `driver:${driver.userId.toString()}`,
                    {
                        rideId: ride._id.toString(),
                        pickup,
                        destination: tripType === "ROUND_TRIP" ? pickup : destination,
                        stops: tripType === "ROUND_TRIP"
                            ? [...stops, { ...destination, name: "Outbound Destination" }]
                            : stops,
                        requestedPrice: ride.requestedPrice,
                        vehicleType: ride.vehicleType,
                        tripType: ride.tripType,
                    }
                );
            }
        } catch (error) {
            console.error("Nearby driver notification failed:", error.message);
        }

        publishEvent(
            "ride:created",
            `passenger:${req.user._id.toString()}`,
            {
                rideId: ride._id.toString(),
                status: ride.status,
                requestedPrice: ride.requestedPrice,
                tripType: ride.tripType,
                distance: ride.distance,
                estimatedDuration: ride.estimatedDuration,
            }
        );

        return res.status(201).json({
            success: true,
            message: "Ride requested successfully",
            ride,
        });
    } catch (error) {
        console.error("Create ride error:", error.message);

        // Missing VehiclePricing for the requested vehicle type is an
        // admin-fixable configuration gap (fareService throws
        // "Vehicle pricing unavailable"), not a server fault — surface
        // it as a clear, non-500 error naming the problem instead of
        // the generic failure below. The real cause is logged above.
        if (error.message === "Vehicle pricing unavailable") {
            return res.status(422).json({
                success: false,
                message: "Pricing is not available for this vehicle type yet. Please choose another vehicle type or try again later.",
            });
        }

        return res.status(500).json({
            success: false,
            message: "Failed to create ride",
        });
    }
};

const getActiveRide = async (req, res) => {
    try {
        const ride = await Ride.findOne({
            passengerId: req.user._id,
            status: {
                $in: [
                    "REQUESTED", "SEARCHING", "BIDDING",
                    "DRIVER_SELECTED", "DRIVER_EN_ROUTE",
                    "DRIVER_ARRIVED", "TRIP_STARTED", "REASSIGNING",
                ],
            },
        }).sort({ createdAt: -1 });

        return res.json({ success: true, ride });
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: "Failed to load active ride",
        });
    }
};

module.exports = { createRide, getActiveRide };
