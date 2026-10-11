require("dotenv").config();

const mongoose = require("mongoose");

async function main() {
    const uri = process.env.MONGO_URI || process.env.MONGODB_URI;

    if (!uri) {
        throw new Error("MongoDB connection string not found");
    }

    await mongoose.connect(uri);

    const admin = mongoose.connection.db.admin();

    const hello = await admin.command({ hello: 1 });

    const isReplicaSet = Boolean(hello.setName);
    const isMongos = hello.msg === "isdbgrid";
    const transactionsSupported = isReplicaSet || isMongos;

    const CommissionSettings = require(
        "../src/models/CommissionSettings"
    );

    const settings = await CommissionSettings.findOne({
        key: "GLOBAL",
    }).lean();

    const checks = {
        databaseConnected: mongoose.connection.readyState === 1,
        deploymentType: isReplicaSet
            ? "Replica Set"
            : isMongos
                ? "Sharded Cluster"
                : "Standalone / Unknown",
        transactionsSupported,
        commissionConfigured: Boolean(settings),
        commissionActive: Boolean(settings?.isActive),
        commissionPercentage: settings?.percentage ?? null,
        minimumWalletBalance:
            settings?.minimumWalletBalance ?? null,
    };

    console.log("\nFINANCIAL READINESS");
    console.table(checks);

    if (!transactionsSupported) {
        console.log(
            "\nBLOCKER: MongoDB transactions require a replica set or sharded cluster."
        );
    }

    if (!settings?.isActive) {
        console.log(
            "\nBLOCKER: Active commission settings are not configured."
        );
    }

    console.log("\nNo wallet balances were modified.");
}

main()
    .catch((error) => {
        console.error("Readiness check failed:", error.message);
        process.exitCode = 1;
    })
    .finally(async () => {
        await mongoose.disconnect();
    });