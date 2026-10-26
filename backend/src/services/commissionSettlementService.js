
const mongoose = require("mongoose");

const Ride = require("../models/Ride");
const DriverWallet = require("../models/DriverWallet");
const WalletTransaction = require("../models/WalletTransaction");
const CommissionSettings = require("../models/CommissionSettings");
const RideSettlement = require("../models/RideSettlement");
const { ensureDriverWallet } = require("./driverWalletService");
const { paymentsConfigured } = require("./paymentsConfigService");

async function settleRideCommission(rideId) {
    if (!mongoose.isValidObjectId(rideId)) {
        throw new Error("Invalid ride ID");
    }

    return mongoose.connection.transaction(async (session) => {
        const existing = await RideSettlement.findOne({
            rideId,
        }).session(session);

        if (existing?.status === "SETTLED") {
            return {
                alreadySettled: true,
                settlement: existing,
            };
        }

        if (existing && !["PENDING", "FAILED"].includes(existing.status)) {
            throw new Error("Invalid settlement status");
        }

        const previousDebit = await WalletTransaction.findOne({
            rideId,
            type: "COMMISSION_DEBIT",
        }).session(session);

        if (previousDebit) {
            throw new Error(
                "Existing commission debit requires manual reconciliation"
            );
        }

        const ride = await Ride.findById(rideId).session(session);

        if (
            !ride ||
            ride.status !== "TRIP_COMPLETED" ||
            !ride.driverId ||
            !Number.isSafeInteger(ride.finalPrice) ||
            ride.finalPrice <= 0
        ) {
            throw new Error("Invalid completed ride");
        }

        const settings = await CommissionSettings.findOne({
            key: "GLOBAL",
        }).session(session);

        // Auto Free Mode: until a payment method is configured in the
        // dashboard, top-ups are impossible, so commission is not
        // enforced and settlements complete with zero commission
        // instead of failing. Once a gateway is configured, the normal
        // rules below apply unchanged.
        const configured = await paymentsConfigured(settings, session);

        const topUpEnforced =
            settings?.topUpRequired === true && configured;

        if (topUpEnforced && settings.isActive !== true) {
            throw new Error("Active commission settings unavailable");
        }

        // Free Mode: no commission; Paid Mode: configured commission.
        const basisPoints =
            topUpEnforced && settings.isActive === true
                ? Math.round(settings.percentage * 100)
                : 0;

        if (
            !Number.isSafeInteger(basisPoints) ||
            basisPoints < 0 ||
            basisPoints > 10000
        ) {
            throw new Error("Invalid commission rate");
        }

        const commission = Math.round(
            (ride.finalPrice * basisPoints) / 10000
        );

        if (
            !Number.isSafeInteger(commission) ||
            commission < 0 ||
            commission > ride.finalPrice
        ) {
            throw new Error("Invalid calculated commission");
        }

        const wallet = await ensureDriverWallet(
            ride.driverId,
            session
        );

        if (
            !Number.isSafeInteger(wallet.balance) ||
            wallet.balance < commission
        ) {
            throw new Error("Insufficient driver wallet balance");
        }

        let balanceAfter = wallet.balance;

        if (commission > 0) {
            const updatedWallet = await DriverWallet.findOneAndUpdate(
                {
                    _id: wallet._id,
                    balance: wallet.balance,
                },
                {
                    $inc: {
                        balance: -commission,
                        totalCommission: commission,
                    },
                },
                {
                    returnDocument: "after",
                    session,
                }
            );

            if (!updatedWallet) {
                throw new Error("Wallet balance changed; retry required");
            }

            balanceAfter = updatedWallet.balance;

            await WalletTransaction.create(
                [
                    {
                        walletId: wallet._id,
                        driverId: ride.driverId,
                        rideId: ride._id,
                        type: "COMMISSION_DEBIT",
                        amount: commission,
                        balanceBefore: wallet.balance,
                        balanceAfter,
                        description: `Commission for ride ${ride._id}`,
                        idempotencyKey: `commission:${ride._id}`,
                    },
                ],
                { session }
            );
        }

        const settledAt = new Date();

        const settlement = existing
            ? await RideSettlement.findOneAndUpdate(
                {
                    _id: existing._id,
                    status: existing.status,
                },
                {
                    $set: {
                        driverId: ride.driverId,
                        fare: ride.finalPrice,
                        commission,
                        commissionPercentage: basisPoints / 100,
                        driverEarnings: ride.finalPrice - commission,
                        currency: "PKR",
                        status: "SETTLED",
                        settledAt,
                        lastError: "",
                    },
                },
                { session, returnDocument: "after" }
            )
            : null;

        if (existing && !settlement) {
            throw new Error("Settlement changed; retry required");
        }

        const [createdSettlement] = existing ? [null] : await RideSettlement.create(
            [
                {
                    rideId: ride._id,
                    driverId: ride.driverId,
                    fare: ride.finalPrice,
                    commission,
                    commissionPercentage: basisPoints / 100,
                    driverEarnings: ride.finalPrice - commission,
                    currency: "PKR",
                    status: "SETTLED",
                    settledAt,
                },
            ],
            { session }
        );

        await Ride.updateOne(
            {
                _id: ride._id,
                status: "TRIP_COMPLETED",
            },
            {
                $set: {
                    settlementStatus: "SETTLED",
                    settlementError: "",
                    settledAt,
                },
                $inc: {
                    settlementAttempts: 1,
                },
            },
            { session }
        );

        return {
            alreadySettled: false,
            settlement: settlement || createdSettlement,
            balanceAfter,
        };
    });
}

module.exports = { settleRideCommission };
