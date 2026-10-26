require("dotenv").config();

const mongoose = require("mongoose");

// One-off migration for the PaymentGatewayConfig schema change:
// the legacy model declared `provider` as globally unique, while every
// lookup is by { provider, environment }. This script drops the legacy
// single-field unique index (if present) and creates the compound
// unique index { provider: 1, environment: 1 } from the updated model.
//
// Idempotent and safe to re-run. Dry-run by default; pass --apply to
// perform the index changes:
//   node scripts/migrateGatewayConfigIndex.js          (report only)
//   node scripts/migrateGatewayConfigIndex.js --apply  (migrate)
//
// Run this BEFORE deploying the updated model.
async function main() {
    const apply = process.argv.includes("--apply");

    const uri = process.env.MONGO_URI || process.env.MONGODB_URI;

    if (!uri) {
        throw new Error("MongoDB connection string not found");
    }

    await mongoose.connect(uri);

    const PaymentGatewayConfig = require(
        "../src/models/PaymentGatewayConfig"
    );

    const collection = PaymentGatewayConfig.collection;

    const indexes = await collection.indexes();

    console.log("\nCurrent indexes on paymentgatewayconfigs:");
    for (const index of indexes) {
        console.log(
            `- ${index.name}: ${JSON.stringify(index.key)}${index.unique ? " (unique)" : ""}`
        );
    }

    const counts = await PaymentGatewayConfig.aggregate([
        {
            $group: {
                _id: {
                    provider: "$provider",
                    environment: "$environment",
                },
                count: { $sum: 1 },
            },
        },
        { $sort: { "_id.provider": 1, "_id.environment": 1 } },
    ]);

    console.log("\nDocuments per provider/environment:");
    for (const row of counts) {
        console.log(
            `- ${row._id.provider} / ${row._id.environment}: ${row.count}`
        );
    }

    const legacyIndex = indexes.find(
        (index) =>
            index.unique &&
            Object.keys(index.key).length === 1 &&
            index.key.provider === 1
    );

    const compoundExists = indexes.some(
        (index) =>
            index.key.provider === 1 &&
            index.key.environment === 1 &&
            Object.keys(index.key).length === 2
    );

    if (!legacyIndex && compoundExists) {
        console.log(
            "\nAlready migrated: compound unique index exists and no legacy provider-only unique index remains. Nothing to do."
        );
        return;
    }

    if (!apply) {
        console.log(
            "\nDry run only. Re-run with --apply to drop the legacy index and create the compound index."
        );
        return;
    }

    if (legacyIndex) {
        await collection.dropIndex(legacyIndex.name);
        console.log(`\nDropped legacy index: ${legacyIndex.name}`);
    }

    await PaymentGatewayConfig.syncIndexes();
    console.log("Compound index { provider: 1, environment: 1 } ensured.");

    const after = await collection.indexes();
    console.log("\nIndexes after migration:");
    for (const index of after) {
        console.log(
            `- ${index.name}: ${JSON.stringify(index.key)}${index.unique ? " (unique)" : ""}`
        );
    }
}

main()
    .catch((error) => {
        console.error("Gateway config index migration failed:", error.message);
        process.exitCode = 1;
    })
    .finally(async () => {
        await mongoose.disconnect();
    });
