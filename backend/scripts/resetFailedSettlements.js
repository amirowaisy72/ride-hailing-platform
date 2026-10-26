require("dotenv").config();

const mongoose = require("mongoose");

// One-off recovery for rides stuck in settlementStatus "FAILED" (e.g.
// rides that burned all 5 attempts before a root cause was fixed).
//
// Dry-run by default: prints what would change and writes nothing.
// Pass --apply to perform the reset:
//   node scripts/resetFailedSettlements.js          (dry run)
//   node scripts/resetFailedSettlements.js --apply  (writes)
async function main() {
    const apply = process.argv.includes("--apply");

    const uri = process.env.MONGO_URI || process.env.MONGODB_URI;

    if (!uri) {
        throw new Error("MongoDB connection string not found");
    }

    await mongoose.connect(uri);

    const Ride = require("../src/models/Ride");
    const RideSettlement = require("../src/models/RideSettlement");

    const failedRides = await Ride.find({
        settlementStatus: "FAILED",
    })
        .sort({ completedAt: 1, createdAt: 1 })
        .limit(500)
        .select("_id settlementAttempts settlementError")
        .lean();

    console.log(
        `\nFAILED rides found: ${failedRides.length} (cap 500)`
    );

    for (const ride of failedRides.slice(0, 20)) {
        console.log(
            `- ${ride._id} attempts=${ride.settlementAttempts ?? 0} error="${ride.settlementError || ""}"`
        );
    }

    if (failedRides.length > 20) {
        console.log(`  ... and ${failedRides.length - 20} more`);
    }

    if (!apply) {
        console.log(
            "\nDry run only. Re-run with --apply to reset these rides to PENDING with attempts 0."
        );
        return;
    }

    const rideIds = failedRides.map((ride) => ride._id);

    if (rideIds.length) {
        const rideResult = await Ride.updateMany(
            { _id: { $in: rideIds } },
            {
                $set: {
                    settlementAttempts: 0,
                    settlementStatus: "PENDING",
                    settlementError: "",
                },
            }
        );

        const settlementResult = await RideSettlement.updateMany(
            { rideId: { $in: rideIds }, status: "FAILED" },
            {
                $set: {
                    status: "PENDING",
                    lastError: "",
                },
            }
        );

        console.log(
            `\nReset rides: ${rideResult.modifiedCount}; settlement rows: ${settlementResult.modifiedCount}`
        );
    }

    console.log(
        "Done. The settlement processor will retry these rides on its next run."
    );
}

main()
    .catch((error) => {
        console.error("Reset failed settlements failed:", error.message);
        process.exitCode = 1;
    })
    .finally(async () => {
        await mongoose.disconnect();
    });
