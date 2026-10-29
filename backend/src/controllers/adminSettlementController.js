const mongoose = require("mongoose");
const Ride = require("../models/Ride");
const RideSettlement = require("../models/RideSettlement");
const ParcelOrder = require("../models/ParcelOrder");
const ParcelSettlement = require("../models/ParcelSettlement");
const {
    reconcileFinancialRecords,
} = require("../services/financialReconciliationService");
const {
    processPendingSettlements,
    processPendingParcelSettlements,
    processPendingPurchaseSettlements,
} = require("../services/pendingSettlementService");

async function getSettlementOverview(req, res) {
    try {
        const [pending, settled, failed, recentSettlements, failedDocs] =
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
                RideSettlement.find({ status: "FAILED" })
                    .sort({ updatedAt: -1 })
                    .limit(50)
                    .select(
                        "rideId driverId fare lastError updatedAt"
                    )
                    .lean(),
            ]);

        const failedRideIds = failedDocs.map((doc) => doc.rideId);

        const failedRideRows = failedRideIds.length
            ? await Ride.find({ _id: { $in: failedRideIds } })
                .select("settlementAttempts settlementError")
                .lean()
            : [];

        const attemptsByRide = new Map(
            failedRideRows.map((ride) => [
                String(ride._id),
                ride.settlementAttempts ?? 0,
            ])
        );

        const failedRides = failedDocs.map((doc) => ({
            rideId: doc.rideId,
            driverId: doc.driverId,
            fare: doc.fare,
            lastError: doc.lastError || "",
            settlementAttempts: attemptsByRide.get(String(doc.rideId)) ?? 0,
            updatedAt: doc.updatedAt,
        }));

        const [
            parcelPending,
            parcelSettled,
            parcelFailed,
            failedParcelDocs,
        ] = await Promise.all([
            ParcelOrder.countDocuments({
                status: "DELIVERED",
                settlementStatus: "PENDING",
            }),
            ParcelOrder.countDocuments({
                settlementStatus: "SETTLED",
            }),
            ParcelOrder.countDocuments({
                settlementStatus: "FAILED",
            }),
            ParcelSettlement.find({ status: "FAILED" })
                .sort({ updatedAt: -1 })
                .limit(50)
                .select(
                    "parcelOrderId driverId fare lastError updatedAt"
                )
                .lean(),
        ]);

        const failedParcelIds = failedParcelDocs.map(
            (doc) => doc.parcelOrderId
        );

        const failedParcelRows = failedParcelIds.length
            ? await ParcelOrder.find({ _id: { $in: failedParcelIds } })
                .select("settlementAttempts settlementError")
                .lean()
            : [];

        const attemptsByParcel = new Map(
            failedParcelRows.map((parcel) => [
                String(parcel._id),
                parcel.settlementAttempts ?? 0,
            ])
        );

        const failedParcels = failedParcelDocs.map((doc) => ({
            parcelOrderId: doc.parcelOrderId,
            driverId: doc.driverId,
            fare: doc.fare,
            lastError: doc.lastError || "",
            settlementAttempts:
                attemptsByParcel.get(String(doc.parcelOrderId)) ?? 0,
            updatedAt: doc.updatedAt,
        }));

        return res.json({
            success: true,
            summary: { pending, settled, failed },
            parcelSummary: {
                pending: parcelPending,
                settled: parcelSettled,
                failed: parcelFailed,
            },
            recentSettlements,
            failedRides,
            failedParcels,
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

        const parcels = await processPendingParcelSettlements({
            limit: 20,
        });

        const purchases = await processPendingPurchaseSettlements({
            limit: 20,
        });

        return res.json({
            success: true,
            result,
            parcels,
            purchases,
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

async function resetRideSettlement(req, res) {
    try {
        const { rideId } = req.params;

        if (!mongoose.isValidObjectId(rideId)) {
            return res.status(400).json({
                success: false,
                message: "Invalid ride ID",
            });
        }

        const ride = await Ride.findById(rideId)
            .select("settlementStatus")
            .lean();

        if (!ride) {
            return res.status(404).json({
                success: false,
                message: "Ride not found",
            });
        }

        if (ride.settlementStatus === "SETTLED") {
            return res.status(409).json({
                success: false,
                message: "Ride settlement is already settled",
            });
        }

        await Ride.updateOne(
            { _id: rideId },
            {
                $set: {
                    settlementAttempts: 0,
                    settlementStatus: "PENDING",
                    settlementError: "",
                },
            }
        );

        await RideSettlement.updateOne(
            { rideId, status: "FAILED" },
            {
                $set: {
                    status: "PENDING",
                    lastError: "",
                },
            }
        );

        return res.json({
            success: true,
            message: "Settlement reset. It will be retried on the next processing run.",
        });
    } catch (error) {
        console.error("Settlement reset:", error.message);

        return res.status(500).json({
            success: false,
            message: "Unable to reset settlement",
        });
    }
}

async function resetFailedSettlements(req, res) {
    try {
        const dryRun =
            req.query.dryRun === "true" || req.query.dryRun === "1";

        const failedRides = await Ride.find({
            settlementStatus: "FAILED",
        })
            .sort({ completedAt: 1, createdAt: 1 })
            .limit(500)
            .select("_id")
            .lean();

        if (dryRun) {
            return res.json({
                success: true,
                dryRun: true,
                matched: failedRides.length,
                modified: 0,
            });
        }

        const rideIds = failedRides.map((ride) => ride._id);

        let modified = 0;

        if (rideIds.length) {
            const result = await Ride.updateMany(
                { _id: { $in: rideIds } },
                {
                    $set: {
                        settlementAttempts: 0,
                        settlementStatus: "PENDING",
                        settlementError: "",
                    },
                }
            );

            modified = result.modifiedCount ?? 0;

            await RideSettlement.updateMany(
                { rideId: { $in: rideIds }, status: "FAILED" },
                {
                    $set: {
                        status: "PENDING",
                        lastError: "",
                    },
                }
            );
        }

        return res.json({
            success: true,
            dryRun: false,
            matched: rideIds.length,
            modified,
        });
    } catch (error) {
        console.error("Failed settlements reset:", error.message);

        return res.status(500).json({
            success: false,
            message: "Unable to reset failed settlements",
        });
    }
}

async function resetParcelSettlement(req, res) {
    try {
        const { parcelOrderId } = req.params;

        if (!mongoose.isValidObjectId(parcelOrderId)) {
            return res.status(400).json({
                success: false,
                message: "Invalid parcel order ID",
            });
        }

        const parcel = await ParcelOrder.findById(parcelOrderId)
            .select("settlementStatus")
            .lean();

        if (!parcel) {
            return res.status(404).json({
                success: false,
                message: "Parcel order not found",
            });
        }

        if (parcel.settlementStatus === "SETTLED") {
            return res.status(409).json({
                success: false,
                message: "Parcel settlement is already settled",
            });
        }

        await ParcelOrder.updateOne(
            { _id: parcelOrderId },
            {
                $set: {
                    settlementAttempts: 0,
                    settlementStatus: "PENDING",
                    settlementError: "",
                },
            }
        );

        await ParcelSettlement.updateOne(
            { parcelOrderId, status: "FAILED" },
            {
                $set: {
                    status: "PENDING",
                    lastError: "",
                },
            }
        );

        return res.json({
            success: true,
            message: "Parcel settlement reset. It will be retried on the next processing run.",
        });
    } catch (error) {
        console.error("Parcel settlement reset:", error.message);

        return res.status(500).json({
            success: false,
            message: "Unable to reset parcel settlement",
        });
    }
}

async function resetFailedParcelSettlements(req, res) {
    try {
        const dryRun =
            req.query.dryRun === "true" || req.query.dryRun === "1";

        const failedParcels = await ParcelOrder.find({
            settlementStatus: "FAILED",
        })
            .sort({ deliveredAt: 1, createdAt: 1 })
            .limit(500)
            .select("_id")
            .lean();

        if (dryRun) {
            return res.json({
                success: true,
                dryRun: true,
                matched: failedParcels.length,
                modified: 0,
            });
        }

        const parcelIds = failedParcels.map((parcel) => parcel._id);

        let modified = 0;

        if (parcelIds.length) {
            const result = await ParcelOrder.updateMany(
                { _id: { $in: parcelIds } },
                {
                    $set: {
                        settlementAttempts: 0,
                        settlementStatus: "PENDING",
                        settlementError: "",
                    },
                }
            );

            modified = result.modifiedCount ?? 0;

            await ParcelSettlement.updateMany(
                { parcelOrderId: { $in: parcelIds }, status: "FAILED" },
                {
                    $set: {
                        status: "PENDING",
                        lastError: "",
                    },
                }
            );
        }

        return res.json({
            success: true,
            dryRun: false,
            matched: parcelIds.length,
            modified,
        });
    } catch (error) {
        console.error("Failed parcel settlements reset:", error.message);

        return res.status(500).json({
            success: false,
            message: "Unable to reset failed parcel settlements",
        });
    }
}

module.exports = {
    getSettlementOverview,
    runSettlementBatch,
    getFinancialReconciliation,
    resetRideSettlement,
    resetFailedSettlements,
    resetParcelSettlement,
    resetFailedParcelSettlements,
};