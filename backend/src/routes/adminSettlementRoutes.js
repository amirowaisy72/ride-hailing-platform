const express = require("express");
const { protect } = require("../middleware/authMiddleware");
const {
    getSettlementOverview,
    runSettlementBatch,
    getFinancialReconciliation,
    resetRideSettlement,
    resetFailedSettlements,
    resetParcelSettlement,
    resetFailedParcelSettlements,
} = require("../controllers/adminSettlementController");

const router = express.Router();

router.use(protect);

router.use((req, res, next) => {
    if (req.user?.role !== "ADMIN") {
        return res.status(403).json({
            success: false,
            message: "Admin access required",
        });
    }

    next();
});

router.get("/", getSettlementOverview);
router.get("/reconciliation", getFinancialReconciliation);
router.post("/process", runSettlementBatch);
router.post("/rides/:rideId/reset", resetRideSettlement);
router.post("/reset-failed", resetFailedSettlements);
router.post("/parcels/:parcelOrderId/reset", resetParcelSettlement);
router.post("/parcels/reset-failed", resetFailedParcelSettlements);

module.exports = router;