const Ride = require("../models/Ride");
const RideSettlement = require("../models/RideSettlement");
const {
    reconcileFinancialRecords,
} = require("../services/financialReconciliationService");
const {
    processPendingSettlements,
} = require("../services/pendingSettlementService");

async function getSettlementOverview(req, res) {
    try {
        const [pending, settled, failed, recentSettlements] =
            await Promise.all([
                Ride.countDocuments({
                    status: "TRIP_COMPLETED",
                    settlementStatus: "PENDING",
                }),
                Ride.countDocuments({
                    settlementStatus: "SETTLED",
                }),
                Ride.countDocuments({
                    settlementStatus: "FAILED",
                }),
                RideSettlement.find({ status: "SETTLED" })
                    .sort({ createdAt: -1 })
                    .limit(20)
                    .select(
                        "rideId driverId fare commission driverEarnings settledAt"
                    )
                    .lean(),
            ]);

        return res.json({
            success: true,
            summary: { pending, settled, failed },
            recentSettlements,
        });
    } catch (error) {
        console.error("Settlement overview:", error.message);

        return res.status(500).json({
            success: false,
            message: "Unable to load settlement overview",
        });
    }
}

async function runSettlementBatch(req, res) {
    try {
        const result = await processPendingSettlements({
            limit: 20,
        });

        return res.json({
            success: true,
            result,
        });
    } catch (error) {
        console.error("Settlement batch:", error.message);

        return res.status(500).json({
            success: false,
            message: "Settlement processing failed",
        });
    }
}

async function getFinancialReconciliation(req, res) {
    try {
        const result = await reconcileFinancialRecords();

        return res.json({
            success: true,
            ...result,
        });
    } catch (error) {
        console.error("Financial reconciliation:", error.message);

        return res.status(500).json({
            success: false,
            message: "Unable to reconcile financial records",
        });
    }
}

module.exports = {
    getSettlementOverview,
    runSettlementBatch,
    getFinancialReconciliation,
};