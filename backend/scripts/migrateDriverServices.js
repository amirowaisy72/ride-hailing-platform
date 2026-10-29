require("dotenv").config();

const mongoose = require("mongoose");

// Phase 2 migration — materialise per-service eligibility records
// (Driver.services) for drivers created before the multi-service
// platform existed.
//
// IMPORTANT: this script is a CONVENIENCE, not a correctness
// requirement. services/eligibilityService.js derives RIDE/PARCEL
// eligibility from the legacy global verificationStatus whenever a
// service record is untouched (NOT_APPLIED), so existing drivers keep
// their access even if this script never runs.
//
// What --apply does (and nothing more):
//   * For every driver whose GLOBAL verificationStatus is APPROVED and
//     whose RIDE / PARCEL records are still NOT_APPLIED, write explicit
//     RIDE = APPROVED and PARCEL = APPROVED records (enabled: true).
// It NEVER approves an incomplete or pending applicant, never touches
// BUY_DELIVER, never changes the global verificationStatus, and never
// downgrades an explicit per-service record.
//
// Idempotent and safe to re-run. Dry-run by default; pass --apply to
// write:
//   node scripts/migrateDriverServices.js          (report only)
//   node scripts/migrateDriverServices.js --apply  (migrate)
async function main() {
    const apply = process.argv.includes("--apply");

    const uri = process.env.MONGO_URI || process.env.MONGODB_URI;

    if (!uri) {
        throw new Error("MongoDB connection string not found");
    }

    await mongoose.connect(uri);

    const Driver = require("../src/models/Driver");

    // Lean reads show the RAW stored shape (Mongoose defaults would
    // otherwise hide which records are genuinely unmaterialised).
    const drivers = await Driver.find({})
        .select("verificationStatus services")
        .lean();

    const summary = {
        total: drivers.length,
        alreadyExplicit: 0,
        globalApprovedToMaterialise: [],
        skippedNotApproved: 0,
    };

    for (const driver of drivers) {
        const rideStatus = driver.services?.RIDE?.status || "NOT_APPLIED";
        const parcelStatus =
            driver.services?.PARCEL?.status || "NOT_APPLIED";

        if (rideStatus !== "NOT_APPLIED" || parcelStatus !== "NOT_APPLIED") {
            summary.alreadyExplicit += 1;
            continue;
        }

        if (driver.verificationStatus !== "APPROVED") {
            summary.skippedNotApproved += 1;
            continue;
        }

        summary.globalApprovedToMaterialise.push(driver._id);
    }

    console.log("\nDriver services backfill — summary:");
    console.log(`- Total drivers:                 ${summary.total}`);
    console.log(
        `- Already have explicit records: ${summary.alreadyExplicit}`
    );
    console.log(
        `- Globally APPROVED, untouched:  ${summary.globalApprovedToMaterialise.length} (would materialise RIDE + PARCEL = APPROVED)`
    );
    console.log(
        `- Not globally approved (skip):  ${summary.skippedNotApproved} (never auto-approved)`
    );

    if (summary.globalApprovedToMaterialise.length === 0) {
        console.log(
            "\nNothing to materialise. Existing derivation already covers every driver."
        );
        return;
    }

    if (!apply) {
        console.log(
            "\nDry run only. Re-run with --apply to write the explicit RIDE/PARCEL APPROVED records listed above."
        );
        return;
    }

    const now = new Date();
    let modified = 0;

    for (const driverId of summary.globalApprovedToMaterialise) {
        const result = await Driver.updateOne(
            {
                _id: driverId,
                verificationStatus: "APPROVED",
                "services.RIDE.status": { $in: [null, "NOT_APPLIED"] },
                "services.PARCEL.status": { $in: [null, "NOT_APPLIED"] },
            },
            {
                $set: {
                    "services.RIDE.status": "APPROVED",
                    "services.RIDE.enabled": true,
                    "services.RIDE.statusUpdatedAt": now,
                    "services.PARCEL.status": "APPROVED",
                    "services.PARCEL.enabled": true,
                    "services.PARCEL.statusUpdatedAt": now,
                },
            }
        );

        modified += result.modifiedCount;
    }

    console.log(`\nMaterialised explicit records for ${modified} driver(s).`);

    const remaining = await Driver.countDocuments({
        verificationStatus: "APPROVED",
        "services.RIDE.status": "NOT_APPLIED",
    });

    console.log(
        `Globally APPROVED drivers still relying on derivation: ${remaining}`
    );
}

main()
    .catch((error) => {
        console.error("Driver services migration failed:", error.message);
        process.exitCode = 1;
    })
    .finally(async () => {
        await mongoose.disconnect();
    });
