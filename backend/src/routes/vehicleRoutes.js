const express = require("express");
const { protect } = require("../middleware/authMiddleware");
const { authorize } = require("../middleware/roleMiddleware");

const {
    registerVehicle,
    getMyVehicles,
} = require("../controllers/vehicleController");

const { selectActiveVehicle } = require("../controllers/activeVehicleController");

const router = express.Router();

router.use(protect, authorize("PASSENGER", "DRIVER"));

router.post("/", registerVehicle);
router.get("/", getMyVehicles);
router.patch("/active", selectActiveVehicle);

module.exports = router;