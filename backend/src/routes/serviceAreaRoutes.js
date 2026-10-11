const express = require("express");
const { protect } = require("../middleware/authMiddleware");
const { authorize } = require("../middleware/roleMiddleware");

const {
    createServiceArea,
    getServiceAreas,
    updateAreaStatus,
} = require("../controllers/serviceAreaController");

const router = express.Router();

const { isLocationSupported } = require("../services/serviceAreaService");

router.get("/check", protect, async (req, res) => {
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
                message: "Coordinates required",
            });
        }

        const result = await isLocationSupported(
            latitude,
            longitude
        );

        return res.json({
            success: true,
            supported: result.supported,
            city: result.serviceArea?.city || null,
            areaName: result.serviceArea?.name || null,
        });
    } catch {
        return res.status(400).json({
            success: false,
            message: "Invalid coordinates",
        });
    }
});

router.use(protect, authorize("ADMIN"));

router.post("/", createServiceArea);
router.get("/", getServiceAreas);
router.patch("/:id/status", updateAreaStatus);

module.exports = router;