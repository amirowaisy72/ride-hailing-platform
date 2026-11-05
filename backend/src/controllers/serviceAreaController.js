const ServiceArea = require("../models/ServiceArea");

// Shared GeoJSON polygon check: a closed ring of at least 4 finite
// [lng, lat] points, first point repeated at the end.
function polygonError(coordinates) {
    if (!Array.isArray(coordinates)) return "Valid polygon coordinates required";

    const ring = coordinates[0];

    if (
        !Array.isArray(ring) ||
        ring.length < 4 ||
        ring.some(
            (point) =>
                !Array.isArray(point) ||
                point.length !== 2 ||
                point.some((value) => typeof value !== "number" || !Number.isFinite(value))
        ) ||
        JSON.stringify(ring[0]) !== JSON.stringify(ring[ring.length - 1])
    ) {
        return "Invalid GeoJSON polygon";
    }

    return null;
}

const createServiceArea = async (req, res) => {
    try {
        const { name, city, coordinates } = req.body;

        if (
            typeof name !== "string" ||
            !name.trim() ||
            typeof city !== "string" ||
            !city.trim() ||
            !Array.isArray(coordinates)
        ) {
            return res.status(400).json({
                success: false,
                message: "Valid name, city and polygon coordinates required",
            });
        }

        const invalid = polygonError(coordinates);

        if (invalid) {
            return res.status(400).json({
                success: false,
                message: invalid,
            });
        }

        const area = await ServiceArea.create({
            name: name.trim(),
            city: city.trim(),
            polygon: {
                type: "Polygon",
                coordinates,
            },
            active: false,
        });

        return res.status(201).json({
            success: true,
            message: "Service area created successfully",
            area,
        });
    } catch (error) {
        console.error("Service area creation error:", error.message);

        return res.status(500).json({
            success: false,
            message: "Failed to create service area",
        });
    }
};

const getServiceAreas = async (req, res) => {
    try {
        const areas = await ServiceArea.find().sort({ createdAt: -1 });

        return res.json({
            success: true,
            areas,
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: "Failed to fetch service areas",
        });
    }
};

// PATCH /admin/service-areas/:id — edit an existing service area.
// Additive only: updates only the fields sent (name, city, coordinates
// and/or active). Nothing else changes; response shape matches the
// other service-area endpoints ({ success, message, area }).
const updateServiceArea = async (req, res) => {
    try {
        const { name, city, coordinates, active } = req.body;
        const updates = {};

        if (name !== undefined) {
            if (typeof name !== "string" || !name.trim()) {
                return res.status(400).json({
                    success: false,
                    message: "Valid name required",
                });
            }
            updates.name = name.trim();
        }

        if (city !== undefined) {
            if (typeof city !== "string" || !city.trim()) {
                return res.status(400).json({
                    success: false,
                    message: "Valid city required",
                });
            }
            updates.city = city.trim();
        }

        if (coordinates !== undefined) {
            const invalid = polygonError(coordinates);

            if (invalid) {
                return res.status(400).json({
                    success: false,
                    message: invalid,
                });
            }

            updates.polygon = {
                type: "Polygon",
                coordinates,
            };
        }

        if (active !== undefined) {
            if (typeof active !== "boolean") {
                return res.status(400).json({
                    success: false,
                    message: "Active must be true or false",
                });
            }
            updates.active = active;
        }

        if (Object.keys(updates).length === 0) {
            return res.status(400).json({
                success: false,
                message: "Nothing to update",
            });
        }

        const area = await ServiceArea.findByIdAndUpdate(
            req.params.id,
            updates,
            { returnDocument: "after", runValidators: true }
        );

        if (!area) {
            return res.status(404).json({
                success: false,
                message: "Service area not found",
            });
        }

        return res.json({
            success: true,
            message: "Service area updated",
            area,
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: "Failed to update service area",
        });
    }
};

const updateAreaStatus = async (req, res) => {
    try {
        if (typeof req.body.active !== "boolean") {
            return res.status(400).json({
                success: false,
                message: "Active must be true or false",
            });
        }

        const area = await ServiceArea.findByIdAndUpdate(
            req.params.id,
            { active: req.body.active },
            { returnDocument: "after", runValidators: true }
        );

        if (!area) {
            return res.status(404).json({
                success: false,
                message: "Service area not found",
            });
        }

        return res.json({
            success: true,
            message: "Service area status updated",
            area,
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: "Failed to update service area",
        });
    }
};

module.exports = {
    createServiceArea,
    getServiceAreas,
    updateServiceArea,
    updateAreaStatus,
};