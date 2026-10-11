
const Ride = require("../models/Ride");
const RideSettlement = require("../models/RideSettlement");
const WalletTransaction = require("../models/WalletTransaction");

async function reconcileFinancialRecords() {
    const settledRides = await Ride.find({
        settlementStatus: "SETTLED",
    })
        .select("_id")
        .limit(100)
        .lean();

    const issues = [];

    for (const ride of settledRides) {
        const settlement = await RideSettlement.findOne({
            rideId: ride._id,
            status: "SETTLED",
        }).lean();

        if (!settlement) {
            issues.push({
                rideId: String(ride._id),
                issue: "Missing settled record",
            });
            continue;
        }

        if (settlement.commission > 0) {
            const transaction = await WalletTransaction.findOne({
                rideId: ride._id,
                type: "COMMISSION_DEBIT",
            }).lean();

            if (
                !transaction ||
                transaction.amount !== settlement.commission
            ) {
                issues.push({
                    rideId: String(ride._id),
                    issue: "Missing or mismatched commission ledger entry",
                });
            }
        }
    }

    return {
        checked: settledRides.length,
        issueCount: issues.length,
        issues,
    };
}

module.exports = { reconcileFinancialRecords };
