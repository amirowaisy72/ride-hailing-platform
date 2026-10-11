const express = require("express");
const { protect } = require("../middleware/authMiddleware");
const {
    getSettlementOverview,
    runSettlementBatch,
    getFinancialReconciliation,
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

module.exports = router;