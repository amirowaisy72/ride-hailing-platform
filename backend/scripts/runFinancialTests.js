
const path = require("path");
const dotenv = require("dotenv");
const mongoose = require("mongoose");

dotenv.config({
    path: path.resolve(__dirname, "../.env.financial-test"),
    override: true,
});

const {
    assertFinancialTestEnvironment,
} = require("./financialTestGuard");

async function main() {
    const uri = process.env.FINANCIAL_TEST_MONGO_URI;

    if (!uri) {
        console.log("Financial test database not configured.");
        console.log("No financial records modified.");
        return;
    }

    assertFinancialTestEnvironment(uri);

    await mongoose.connect(uri);

    try {
        if (
            mongoose.connection.name !==
            "ride_hailing_financial_test"
        ) {
            throw new Error("Incorrect test database");
        }

        console.log("Financial test environment verified.");
        console.log("Database:", mongoose.connection.name);

        const runTopUp = process.argv.includes("--run-topup");
        const runCommission = process.argv.includes("--run-commission");

        if (!runTopUp && !runCommission) {
            console.log("No wallet transactions executed.");
            console.log(
                "Available options: --run-topup, --run-commission"
            );
            return;
        }

        if (runTopUp) {
            const {
                runFinancialTopUpTests,
            } = require("./financialTopUpTests");

            await runFinancialTopUpTests();
        }

        if (runCommission) {
            const {
                runFinancialCommissionTests,
            } = require("./financialCommissionTests");

            await runFinancialCommissionTests();
        }
    } finally {
        await mongoose.disconnect();
    }
}

main().catch((error) => {
    console.error("Financial tests failed:", error.message);
    process.exitCode = 1;
});
