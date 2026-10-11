
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const mongoose = require("mongoose");

const Driver = require("../src/models/Driver");
const DriverWallet = require("../src/models/DriverWallet");
const WalletTransaction = require("../src/models/WalletTransaction");

const {
    topUpDriverWallet,
} = require("../src/services/adminWalletTopUpService");

async function runFinancialTopUpTests() {
    if (
        mongoose.connection.name !== "ride_hailing_financial_test" ||
        process.env.NODE_ENV !== "test" ||
        process.env.FINANCIAL_TEST_MODE !== "true"
    ) {
        throw new Error("Financial test database guard failed");
    }

    // Ensure uniqueness constraints exist before financial tests.
    await Promise.all([
        DriverWallet.init(),
        WalletTransaction.init(),
    ]);

    const driverId = new mongoose.Types.ObjectId();
    const adminUserId = new mongoose.Types.ObjectId();

    const idempotencyKey =
        `financial_test_${randomUUID().replace(/-/g, "")}`;

    let createdDriver = false;

    try {
        // Isolated test fixture. Raw insert intentionally avoids
        // triggering unrelated driver registration requirements.
        await Driver.collection.insertOne({
            _id: driverId,
            userId: new mongoose.Types.ObjectId(),
            verificationStatus: "PENDING",
            isOnline: false,
            isAvailable: false,
            createdAt: new Date(),
            updatedAt: new Date(),
        });

        createdDriver = true;

        console.log("\nTEST 1: First wallet top-up");

        const first = await topUpDriverWallet({
            driverId,
            adminUserId,
            amount: 250,
            idempotencyKey,
            description: "Automated financial test",
        });

        assert.equal(first.alreadyProcessed, false);
        assert.equal(first.balance, 250);

        console.log("PASS: Wallet credited PKR 250");

        console.log("\nTEST 2: Duplicate idempotency key");

        const duplicate = await topUpDriverWallet({
            driverId,
            adminUserId,
            amount: 250,
            idempotencyKey,
            description: "Automated financial test",
        });

        assert.equal(duplicate.alreadyProcessed, true);

        const walletAfterDuplicate =
            await DriverWallet.findOne({ driverId }).lean();

        assert.equal(walletAfterDuplicate.balance, 250);
        assert.equal(walletAfterDuplicate.totalTopUps, 250);

        console.log("PASS: Duplicate request did not add balance");

        console.log("\nTEST 3: Key reuse with different amount");

        await assert.rejects(
            () =>
                topUpDriverWallet({
                    driverId,
                    adminUserId,
                    amount: 500,
                    idempotencyKey,
                }),
            /Idempotency key already used/
        );

        console.log("PASS: Conflicting idempotency key rejected");

        console.log("\nTEST 4: Invalid top-up amount");

        await assert.rejects(
            () =>
                topUpDriverWallet({
                    driverId,
                    adminUserId,
                    amount: -50,
                    idempotencyKey:
                        `financial_test_${randomUUID().replace(/-/g, "")}`,
                }),
            /Invalid wallet top-up details/
        );

        console.log("PASS: Invalid amount rejected");

        console.log("\nTEST 5: Nonexistent driver rollback");

        const missingDriverId = new mongoose.Types.ObjectId();

        await assert.rejects(
            () =>
                topUpDriverWallet({
                    driverId: missingDriverId,
                    adminUserId,
                    amount: 100,
                    idempotencyKey:
                        `financial_test_${randomUUID().replace(/-/g, "")}`,
                }),
            /Driver not found/
        );

        const missingWallet =
            await DriverWallet.findOne({
                driverId: missingDriverId,
            }).lean();

        assert.equal(missingWallet, null);

        console.log("PASS: Missing driver received no wallet");

        console.log("\nTEST 6: Transaction ledger integrity");

        const transactions =
            await WalletTransaction.find({
                driverId,
                type: "TOP_UP",
            }).lean();

        assert.equal(transactions.length, 1);
        assert.equal(transactions[0].amount, 250);
        assert.equal(transactions[0].balanceBefore, 0);
        assert.equal(transactions[0].balanceAfter, 250);

        console.log("PASS: Exactly one valid ledger entry");

        console.log("\nALL 6 TOP-UP CHECKS PASSED");
    } finally {
        // Delete only records belonging to this test driver.
        // Never clear collections or drop the database.
        if (createdDriver) {
            await WalletTransaction.deleteMany({ driverId });
            await DriverWallet.deleteMany({ driverId });
            await Driver.deleteOne({ _id: driverId });
        }
    }
}

module.exports = { runFinancialTopUpTests };
