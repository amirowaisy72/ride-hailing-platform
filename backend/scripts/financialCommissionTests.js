
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const Driver = require("../src/models/Driver");
const Ride = require("../src/models/Ride");
const DriverWallet = require("../src/models/DriverWallet");
const WalletTransaction = require("../src/models/WalletTransaction");
const RideSettlement = require("../src/models/RideSettlement");
const CommissionSettings = require("../src/models/CommissionSettings");

const {
    settleRideCommission,
} = require("../src/services/commissionSettlementService");

async function runFinancialCommissionTests() {
    if (
        process.env.NODE_ENV !== "test" ||
        process.env.FINANCIAL_TEST_MODE !== "true" ||
        mongoose.connection.name !== "ride_hailing_financial_test"
    ) {
        throw new Error("Dedicated financial test environment required");
    }

    await Promise.all([
        DriverWallet.init(),
        WalletTransaction.init(),
        RideSettlement.init(),
        CommissionSettings.init(),
    ]);

    const existingSettings = await CommissionSettings.findOne({
        key: "GLOBAL",
    });

    if (existingSettings) {
        throw new Error(
            "Test database already has GLOBAL commission settings. " +
            "Existing settings will not be overwritten."
        );
    }

    const driverId = new mongoose.Types.ObjectId();
    const passengerId = new mongoose.Types.ObjectId();

    const rideIds = Array.from(
        { length: 6 },
        () => new mongoose.Types.ObjectId()
    );

    let settingsId = null;

    const makeRide = (id, status, finalPrice) => ({
        _id: id,
        passengerId,
        driverId,
        status,
        pickup: {
            type: "Point",
            coordinates: [74.3587, 31.5204],
        },
        destination: {
            type: "Point",
            coordinates: [74.3903, 31.5497],
        },
        requestedPrice: 1000,
        finalPrice,
        settlementStatus: "PENDING",
        settlementAttempts: 0,
        currency: "PKR",
        distance: 5,
        estimatedDuration: 900,
        vehicleType: "BIKE",
        createdAt: new Date(),
        updatedAt: new Date(),
    });

    try {
        const settings = await CommissionSettings.create({
            key: "GLOBAL",
            percentage: 10,
            minimumWalletBalance: 0,
            topUpRequired: true,
            isActive: true,
        });

        settingsId = settings._id;

        await Driver.collection.insertOne({
            _id: driverId,
            userId: new mongoose.Types.ObjectId(),
            verificationStatus: "APPROVED",
            isOnline: false,
            isAvailable: false,
            createdAt: new Date(),
            updatedAt: new Date(),
        });

        await DriverWallet.create({
            driverId,
            balance: 500,
            totalTopUps: 500,
            totalCommission: 0,
        });

        await Ride.collection.insertMany([
            makeRide(rideIds[0], "TRIP_COMPLETED", 1000),
            makeRide(rideIds[1], "TRIP_COMPLETED", 10000),
            makeRide(rideIds[2], "CANCELLED", 1000),
            makeRide(rideIds[3], "TRIP_COMPLETED", 1000),
        ]);

        console.log("\nTEST 1: Successful commission settlement");

        const first = await settleRideCommission(rideIds[0]);

        assert.equal(first.alreadySettled, false);
        assert.equal(first.settlement.commission, 100);
        assert.equal(first.settlement.driverEarnings, 900);
        assert.equal(first.balanceAfter, 400);

        console.log("PASS: Correct commission deducted");

        console.log("\nTEST 2: Duplicate settlement prevention");

        const duplicate = await settleRideCommission(rideIds[0]);

        assert.equal(duplicate.alreadySettled, true);

        let wallet = await DriverWallet.findOne({ driverId }).lean();

        assert.equal(wallet.balance, 400);
        assert.equal(wallet.totalCommission, 100);

        console.log("PASS: No duplicate commission debit");

        console.log("\nTEST 3: Insufficient balance rollback");

        await assert.rejects(
            () => settleRideCommission(rideIds[1]),
            /Insufficient driver wallet balance/
        );

        assert.equal(
            await RideSettlement.countDocuments({
                rideId: rideIds[1],
            }),
            0
        );

        assert.equal(
            await WalletTransaction.countDocuments({
                rideId: rideIds[1],
            }),
            0
        );

        wallet = await DriverWallet.findOne({ driverId }).lean();
        assert.equal(wallet.balance, 400);

        console.log("PASS: No partial debit or settlement");

        console.log("\nTEST 4: Cancelled ride rejection");

        await assert.rejects(
            () => settleRideCommission(rideIds[2]),
            /Invalid completed ride/
        );

        console.log("PASS: Cancelled ride rejected");

        console.log("\nTEST 5: Concurrent settlement safety");

        const results = await Promise.allSettled([
            settleRideCommission(rideIds[3]),
            settleRideCommission(rideIds[3]),
        ]);

        assert.ok(
            results.some((result) => result.status === "fulfilled"),
            "At least one settlement request must succeed"
        );

        const settlements = await RideSettlement.find({
            rideId: rideIds[3],
            status: "SETTLED",
        }).lean();

        const debits = await WalletTransaction.find({
            rideId: rideIds[3],
            type: "COMMISSION_DEBIT",
        }).lean();

        assert.equal(settlements.length, 1);
        assert.equal(debits.length, 1);
        assert.equal(debits[0].amount, 100);

        wallet = await DriverWallet.findOne({ driverId }).lean();

        assert.equal(wallet.balance, 300);
        assert.equal(wallet.totalCommission, 200);

        console.log("PASS: Exactly one settlement and debit");

        console.log("\nTEST 6: Ledger consistency");

        const allDebits = await WalletTransaction.find({
            driverId,
            type: "COMMISSION_DEBIT",
        }).lean();

        assert.equal(allDebits.length, 2);

        assert.equal(
            allDebits.reduce((total, tx) => total + tx.amount, 0),
            200
        );

        const completed = await Ride.find({
            _id: { $in: [rideIds[0], rideIds[3]] },
        }).lean();

        assert.ok(
            completed.every(
                (ride) =>
                    ride.settlementStatus === "SETTLED" &&
                    ride.settlementAttempts === 1 &&
                    ride.settledAt
            )
        );

        console.log("PASS: Wallet, ride and ledger consistent");
        console.log("\nTEST 7: Existing PENDING settlement recovery");

        for (const index of [4, 5]) {
            await Ride.collection.insertOne(
                makeRide(rideIds[index], "TRIP_COMPLETED", 1000)
            );

            await RideSettlement.create({
                rideId: rideIds[index],
                driverId,
                fare: 1000,
                commission: 100,
                commissionPercentage: 10,
                driverEarnings: 900,
                currency: "PKR",
                status: index === 4 ? "PENDING" : "FAILED",
            });
        }

        const pending = await settleRideCommission(rideIds[4]);
        assert.equal(pending.alreadySettled, false);
        assert.equal(pending.settlement.status, "SETTLED");

        console.log("PASS: Existing PENDING settlement recovered");

        console.log("\nTEST 8: Existing FAILED settlement recovery");

        const failed = await settleRideCommission(rideIds[5]);
        assert.equal(failed.alreadySettled, false);
        assert.equal(failed.settlement.status, "SETTLED");

        console.log("PASS: Existing FAILED settlement recovered");

        console.log("\nTEST 9: Recovery ledger consistency");

        const finalWallet = await DriverWallet.findOne({ driverId }).lean();
        const finalDebits = await WalletTransaction.find({
            driverId,
            type: "COMMISSION_DEBIT",
        }).lean();

        assert.equal(finalWallet.balance, 100);
        assert.equal(finalWallet.totalCommission, 400);
        assert.equal(finalDebits.length, 4);

        for (const id of [rideIds[4], rideIds[5]]) {
            assert.equal(
                await RideSettlement.countDocuments({
                    rideId: id,
                    status: "SETTLED",
                }),
                1
            );
        }

        console.log("PASS: Recovered settlements and wallet consistent");
        console.log("\nALL 9 COMMISSION CHECKS PASSED");
    } finally {
        await WalletTransaction.deleteMany({ driverId });
        await RideSettlement.deleteMany({
            rideId: { $in: rideIds },
        });
        await Ride.deleteMany({
            _id: { $in: rideIds },
        });
        await DriverWallet.deleteMany({ driverId });
        await Driver.deleteOne({ _id: driverId });

        if (settingsId) {
            await CommissionSettings.deleteOne({
                _id: settingsId,
            });
        }
    }
}

module.exports = { runFinancialCommissionTests };
