const ServiceArea = require("../models/ServiceArea");

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
            return res.status(400).json({
                success: false,
                message: "Invalid GeoJSON polygon",
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
    updateAreaStatus,
};