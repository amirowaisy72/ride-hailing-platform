
const Ride = require("../models/Ride");
const RideSettlement = require("../models/RideSettlement");
const ParcelOrder = require("../models/ParcelOrder");
const ParcelSettlement = require("../models/ParcelSettlement");
const { settleRideCommission } = require("./commissionSettlementService");
const { settleParcelCommission } = require("./parcelSettlementService");
const PurchaseOrder = require("../models/PurchaseOrder");
const PurchaseSettlement = require("../models/PurchaseSettlement");
const { settlePurchaseCommission } = require("./purchaseSettlementService");

// Persist WHY a settlement did not complete, so the admin dashboard can
// show the reason instead of a bare FAILED count. The settlement row is
// upserted with the ride's real fare/driver data (the schema requires
// them); placeholder amounts are overwritten when a settle succeeds.
async function persistSettlementError(ride, status, message) {
    const fare =
        Number.isSafeInteger(ride.finalPrice) && ride.finalPrice > 0
            ? ride.finalPrice
            : 1;

    await RideSettlement.findOneAndUpdate(
        {
            rideId: ride._id,
            status: { $ne: "SETTLED" },
        },
        {
            $set: {
                status,
                lastError: String(message || "").slice(0, 500),
            },
            $setOnInsert: {
                rideId: ride._id,
                driverId: ride.driverId,
                fare,
                commission: 0,
                commissionPercentage: 0,
                driverEarnings: 0,
            },
        },
        { upsert: true }
    );
}

async function processPendingSettlements({ limit = 20 } = {}) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
        throw new Error("Invalid settlement batch limit");
    }

    const rides = await Ride.find({
        status: "TRIP_COMPLETED",
        settlementStatus: { $in: ["PENDING", "FAILED"] },
        settlementAttempts: { $lt: 5 },
    })
        .sort({ completedAt: 1, createdAt: 1 })
        .limit(limit)
        .select("_id driverId finalPrice")
        .lean();

    const results = {
        scanned: rides.length,
        settled: 0,
        alreadySettled: 0,
        failed: 0,
        errors: [],
    };

    for (const ride of rides) {
        try {
            const result = await settleRideCommission(ride._id);

            if (result.alreadySettled) {
                results.alreadySettled++;
            } else {
                results.settled++;
            }
        } catch (error) {
            results.failed++;

            if (error.message === "Insufficient driver wallet balance") {
                // Insufficient wallet balance: defer, but record the
                // reason so "waiting for driver top-up" is distinguishable
                // from "never attempted" in the dashboard.
                try {
                    await Ride.updateOne(
                        {
                            _id: ride._id,
                            settlementStatus: { $ne: "SETTLED" },
                        },
                        {
                            $set: {
                                settlementError: error.message,
                            },
                        }
                    );

                    await persistSettlementError(
                        ride,
                        "PENDING",
                        error.message
                    );
                } catch (persistError) {
                    console.error(
                        `Settlement defer reason persist failed for ${ride._id}:`,
                        persistError.message
                    );
                }

                continue;
            }

            await Ride.updateOne(
                {
                    _id: ride._id,
                    settlementStatus: { $ne: "SETTLED" },
                },
                {
                    $set: {
                        settlementStatus: "FAILED",
                        settlementError: error.message,
                    },
                    $inc: { settlementAttempts: 1 },
                }
            );

            try {
                await persistSettlementError(
                    ride,
                    "FAILED",
                    error.message
                );
            } catch (persistError) {
                console.error(
                    `Settlement error persist failed for ${ride._id}:`,
                    persistError.message
                );
            }

            console.error(
                `Settlement failed for ${ride._id}:`,
                error.message
            );

            results.errors.push({
                rideId: String(ride._id),
                message: error.message,
            });
        }
    }

    return results;
}

// Parcel mirror of persistSettlementError (see above).
async function persistParcelSettlementError(parcel, status, message) {
    const fare =
        Number.isSafeInteger(parcel.finalPrice) && parcel.finalPrice > 0
            ? parcel.finalPrice
            : Number.isSafeInteger(parcel.requestedPrice) &&
                parcel.requestedPrice > 0
                ? parcel.requestedPrice
                : 1;

    await ParcelSettlement.findOneAndUpdate(
        {
            parcelOrderId: parcel._id,
            status: { $ne: "SETTLED" },
        },
        {
            $set: {
                status,
                lastError: String(message || "").slice(0, 500),
            },
            $setOnInsert: {
                parcelOrderId: parcel._id,
                driverId: parcel.driverId,
                fare,
                commission: 0,
                commissionPercentage: 0,
                driverEarnings: 0,
            },
        },
        { upsert: true }
    );
}

async function processPendingParcelSettlements({ limit = 20 } = {}) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
        throw new Error("Invalid settlement batch limit");
    }

    const parcels = await ParcelOrder.find({
        status: "DELIVERED",
        settlementStatus: { $in: ["PENDING", "FAILED"] },
        settlementAttempts: { $lt: 5 },
    })
        .sort({ deliveredAt: 1, createdAt: 1 })
        .limit(limit)
        .select("_id driverId finalPrice requestedPrice")
        .lean();

    const results = {
        scanned: parcels.length,
        settled: 0,
        alreadySettled: 0,
        failed: 0,
        errors: [],
    };

    for (const parcel of parcels) {
        try {
            const result = await settleParcelCommission(parcel._id);

            if (result.alreadySettled) {
                results.alreadySettled++;
            } else {
                results.settled++;
            }
        } catch (error) {
            results.failed++;

            if (error.message === "Insufficient driver wallet balance") {
                try {
                    await ParcelOrder.updateOne(
                        {
                            _id: parcel._id,
                            settlementStatus: { $ne: "SETTLED" },
                        },
                        {
                            $set: {
                                settlementError: error.message,
                            },
                        }
                    );

                    await persistParcelSettlementError(
                        parcel,
                        "PENDING",
                        error.message
                    );
                } catch (persistError) {
                    console.error(
                        `Parcel settlement defer reason persist failed for ${parcel._id}:`,
                        persistError.message
                    );
                }

                continue;
            }

            await ParcelOrder.updateOne(
                {
                    _id: parcel._id,
                    settlementStatus: { $ne: "SETTLED" },
                },
                {
                    $set: {
                        settlementStatus: "FAILED",
                        settlementError: error.message,
                    },
                    $inc: { settlementAttempts: 1 },
                }
            );

            try {
                await persistParcelSettlementError(
                    parcel,
                    "FAILED",
                    error.message
                );
            } catch (persistError) {
                console.error(
                    `Parcel settlement error persist failed for ${parcel._id}:`,
                    persistError.message
                );
            }

            console.error(
                `Parcel settlement failed for ${parcel._id}:`,
                error.message
            );

            results.errors.push({
                parcelOrderId: String(parcel._id),
                message: error.message,
            });
        }
    }

    return results;
}

// Purchase (Buy & Deliver) mirror of persistParcelSettlementError. The
// placeholder fare is the order's delivery fee — the only amount a
// purchase settlement can ever be about.
async function persistPurchaseSettlementError(order, status, message) {
    const fare =
        Number.isSafeInteger(order.deliveryFee) && order.deliveryFee > 0
            ? order.deliveryFee
            : 1;

    await PurchaseSettlement.findOneAndUpdate(
        {
            purchaseOrderId: order._id,
            status: { $ne: "SETTLED" },
        },
        {
            $set: {
                status,
                lastError: String(message || "").slice(0, 500),
            },
            $setOnInsert: {
                purchaseOrderId: order._id,
                driverId: order.driverId,
                fare,
                commission: 0,
                commissionPercentage: 0,
                driverEarnings: 0,
            },
        },
        { upsert: true }
    );
}

async function processPendingPurchaseSettlements({ limit = 20 } = {}) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
        throw new Error("Invalid settlement batch limit");
    }

    const orders = await PurchaseOrder.find({
        status: { $in: ["DELIVERED", "COMPLETED"] },
        settlementStatus: { $in: ["PENDING", "FAILED"] },
        settlementAttempts: { $lt: 5 },
    })
        .sort({ deliveredAt: 1, createdAt: 1 })
        .limit(limit)
        .select("_id driverId deliveryFee")
        .lean();

    const results = {
        scanned: orders.length,
        settled: 0,
        alreadySettled: 0,
        failed: 0,
        errors: [],
    };

    for (const order of orders) {
        try {
            const result = await settlePurchaseCommission(order._id);

            if (result.alreadySettled) {
                results.alreadySettled++;
            } else {
                results.settled++;
            }
        } catch (error) {
            results.failed++;

            if (error.message === "Insufficient driver wallet balance") {
                try {
                    await PurchaseOrder.updateOne(
                        {
                            _id: order._id,
                            settlementStatus: { $ne: "SETTLED" },
                        },
                        {
                            $set: {
                                settlementError: error.message,
                            },
                        }
                    );

                    await persistPurchaseSettlementError(
                        order,
                        "PENDING",
                        error.message
                    );
                } catch (persistError) {
                    console.error(
                        `Purchase settlement defer reason persist failed for ${order._id}:`,
                        persistError.message
                    );
                }

                continue;
            }

            await PurchaseOrder.updateOne(
                {
                    _id: order._id,
                    settlementStatus: { $ne: "SETTLED" },
                },
                {
                    $set: {
                        settlementStatus: "FAILED",
                        settlementError: error.message,
                    },
                    $inc: { settlementAttempts: 1 },
                }
            );

            try {
                await persistPurchaseSettlementError(
                    order,
                    "FAILED",
                    error.message
                );
            } catch (persistError) {
                console.error(
                    `Purchase settlement error persist failed for ${order._id}:`,
                    persistError.message
                );
            }

            console.error(
                `Purchase settlement failed for ${order._id}:`,
                error.message
            );

            results.errors.push({
                purchaseOrderId: String(order._id),
                message: error.message,
            });
        }
    }

    return results;
}

let settlementTimer = null;
let processing = false;

async function runAutomaticSettlements() {
    if (processing) return;

    processing = true;

    try {
        const result = await processPendingSettlements({ limit: 20 });

        if (result.settled > 0 || result.alreadySettled > 0) {
            console.log("Automatic settlement:", {
                settled: result.settled,
                alreadySettled: result.alreadySettled,
            });
        }

        const parcelResult = await processPendingParcelSettlements({
            limit: 20,
        });

        if (parcelResult.settled > 0 || parcelResult.alreadySettled > 0) {
            console.log("Automatic parcel settlement:", {
                settled: parcelResult.settled,
                alreadySettled: parcelResult.alreadySettled,
            });
        }

        const purchaseResult = await processPendingPurchaseSettlements({
            limit: 20,
        });

        if (purchaseResult.settled > 0 || purchaseResult.alreadySettled > 0) {
            console.log("Automatic purchase settlement:", {
                settled: purchaseResult.settled,
                alreadySettled: purchaseResult.alreadySettled,
            });
        }
    } catch (error) {
        console.error("Automatic settlement error:", error.message);
    } finally {
        processing = false;
    }
}

function startAutomaticSettlements() {
    if (settlementTimer) return;

    settlementTimer = setInterval(
        runAutomaticSettlements,
        30 * 60 * 1000
    );
}

const mongoose = require("mongoose");

mongoose.connection.on("connected", () => {
    startAutomaticSettlements();
    runAutomaticSettlements();
});

if (mongoose.connection.readyState === 1) {
    startAutomaticSettlements();
    runAutomaticSettlements();
}

module.exports = {
    processPendingSettlements,
    processPendingParcelSettlements,
    processPendingPurchaseSettlements,
    startAutomaticSettlements,
};
