
const Ride = require("../models/Ride");
const RideSettlement = require("../models/RideSettlement");
const { settleRideCommission } = require("./commissionSettlementService");

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
        .select("_id")
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

            await Ride.updateOne(
                {
                    _id: ride._id,
                    settlementStatus: { $ne: "SETTLED" },
                },
                {
                    $set: { settlementStatus: "FAILED" },
                    $inc: { settlementAttempts: 1 },
                }
            );

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

module.exports = { processPendingSettlements };
