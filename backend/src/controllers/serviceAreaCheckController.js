const {
    isLocationSupported,
} = require("../services/serviceAreaService");

const checkLocation = async (req, res) => {
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

        const result = await isLocationSupported(latitude, longitude);

        return res.json({
            success: true,
            ...result,
        });
    } catch (error) {
        return res.status(400).json({
            success: false,
            message: "Invalid coordinates",
        });
    }
};

module.exports = { checkLocation };