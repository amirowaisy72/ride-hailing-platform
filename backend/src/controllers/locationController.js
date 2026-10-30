const { getRoute } = require("../integrations/maps/mapService");

const calculateRoute = async (req, res) => {
    try {
        const { pickup, destination } = req.body;

        if (!pickup || !destination) {
            return res.status(400).json({
                success: false,
                message: "Pickup and destination required",
            });
        }

        const route = await getRoute(pickup, destination);

        return res.json({
            success: true,
            route,
        });
    } catch (error) {
        const invalidInput = error.message === "Invalid coordinates";

        return res.status(error.statusCode || (invalidInput ? 400 : 502)).json({
            success: false,
            message: error.statusCode === 503
                ? error.message
                : invalidInput
                    ? "Invalid pickup or destination coordinates"
                    : "Route calculation temporarily unavailable",
        });
    }
};

const { searchAddress } = require("../integrations/maps/mapService");

const searchLocations = async (req, res) => {
    try {
        const latitude = Number(req.query.latitude);
        const longitude = Number(req.query.longitude);

        if (
            !Number.isFinite(latitude) ||
            !Number.isFinite(longitude) ||
            latitude < -90 || latitude > 90 ||
            longitude < -180 || longitude > 180 ||
            req.query.latitude === undefined ||
            req.query.longitude === undefined
        ) {
            return res.status(400).json({
                success: false,
                message: "Valid search location required",
            });
        }

        const locations = await searchAddress(
            req.query.q,
            latitude,
            longitude
        );

        return res.json({
            success: true,
            locations,
        });
    } catch (error) {
        console.error("[LOCATION SEARCH ERROR]", error);

        const invalid = error.message === "Invalid search query";

        return res.status(error.statusCode || (invalid ? 400 : 502)).json({
            success: false,
            message: error.statusCode === 503
                ? error.message
                : invalid
                    ? "Search query must contain at least 3 characters"
                    : "Address search temporarily unavailable",
        });
    }
};

const { reverseGeocode } = require("../integrations/maps/mapService");
const {
    nearestSavedPlaceLocation,
} = require("../services/nearestSavedPlaceService");

const getAddressFromCoordinates = async (req, res) => {
    try {
        const { latitude, longitude } = req.query;

        if (
            latitude === undefined ||
            longitude === undefined ||
            String(latitude).trim() === "" ||
            String(longitude).trim() === ""
        ) {
            return res.status(400).json({
                success: false,
                message: "Latitude and longitude required",
            });
        }

        const location = await reverseGeocode(latitude, longitude);

        return res.json({
            success: true,
            location,
        });
    } catch (error) {
        const invalid = error.message === "Invalid coordinates";

        // A4 fallback: every geocoding provider failed, but the caller
        // (route is behind `protect`, so req.user is the signed-in user)
        // may be standing next to one of their own saved places. Answer
        // 200 with "Near <place>" instead of a bare 502 that makes the
        // app show raw coordinates. Never applied to invalid input or to
        // the admin maps-disabled 503 — those keep their exact behaviour.
        if (!invalid && error.statusCode !== 503 && req.user?._id) {
            try {
                const fallback = await nearestSavedPlaceLocation(
                    req.user._id,
                    req.query.latitude,
                    req.query.longitude
                );

                if (fallback) {
                    return res.json({
                        success: true,
                        location: fallback,
                    });
                }
            } catch (fallbackError) {
                console.error(
                    "[REVERSE GEOCODE SAVED-PLACE FALLBACK ERROR]",
                    fallbackError
                );
            }
        }

        return res.status(error.statusCode || (invalid ? 400 : 502)).json({
            success: false,
            message: error.statusCode === 503
                ? error.message
                : invalid
                    ? "Invalid coordinates"
                    : "Reverse geocoding unavailable",
        });
    }
};

module.exports = {
    calculateRoute,
    searchLocations,
    getAddressFromCoordinates,
};