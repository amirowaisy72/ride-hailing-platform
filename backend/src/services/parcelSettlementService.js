const mongoose = require("mongoose");

const ParcelOrder = require("../models/ParcelOrder");
const DriverWallet = require("../models/DriverWallet");
const WalletTransaction = require("../models/WalletTransaction");
const CommissionSettings = require("../models/CommissionSettings");
const ParcelSettlement = require("../models/ParcelSettlement");
const { ensureDriverWallet } = require("./driverWalletService");
const { paymentsConfigured } = require("./paymentsConfigService");

// Parcel commission settlement, mirroring settleRideCommission for
// rides: same GLOBAL settings, same auto free-mode rule, same wallet
// CAS debit. Idempotency key: `commission:parcel:<parcelOrderId>`.
// The fare is the accepted final price; the requested price is the
// fallback when no final price was recorded.
async function settleParcelCommission(parcelOrderId) {
    if (!mongoose.isValidObjectId(parcelOrderId)) {
        throw new Error("Invalid parcel order ID");
    }

    return mongoose.connection.transaction(async (session) => {
        const existing = await ParcelSettlement.findOne({
            parcelOrderId,
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

        const idempotencyKey = `commission:parcel:${parcelOrderId}`;

        const previousDebit = await WalletTransaction.findOne({
            idempotencyKey,
        }).session(session);

        if (previousDebit) {
            throw new Error(
                "Existing commission debit requires manual reconciliation"
            );
        }

        const parcel = await ParcelOrder.findById(parcelOrderId)
            .session(session);

        const fare =
            Number.isSafeInteger(parcel?.finalPrice) && parcel.finalPrice > 0
                ? parcel.finalPrice
                : Number.isSafeInteger(parcel?.requestedPrice) &&
                    parcel.requestedPrice > 0
                    ? parcel.requestedPrice
                    : null;

        if (
            !parcel ||
            parcel.status !== "DELIVERED" ||
            !parcel.driverId ||
            fare === null
        ) {
            throw new Error("Invalid delivered parcel");
        }

        const settings = await CommissionSettings.findOne({
            key: "GLOBAL",
        }).session(session);

        // Auto Free Mode (same rule as rides): no configured payment
        // method → zero commission, settle as free, never fail.
        const configured = await paymentsConfigured(settings, session);

        const topUpEnforced =
            settings?.topUpRequired === true && configured;

        if (topUpEnforced && settings.isActive !== true) {
            throw new Error("Active commission settings unavailable");
        }

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

        const commission = Math.round((fare * basisPoints) / 10000);

        if (
            !Number.isSafeInteger(commission) ||
            commission < 0 ||
            commission > fare
        ) {
            throw new Error("Invalid calculated commission");
        }

        const wallet = await ensureDriverWallet(
            parcel.driverId,
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
                        driverId: parcel.driverId,
                        rideId: null,
                        parcelOrderId: parcel._id,
                        type: "COMMISSION_DEBIT",
                        amount: commission,
                        balanceBefore: wallet.balance,
                        balanceAfter,
                        description: `Commission for parcel ${parcel._id}`,
                        idempotencyKey,
                    },
                ],
                { session }
            );
        }

        const settledAt = new Date();

        const settlement = existing
            ? await ParcelSettlement.findOneAndUpdate(
                {
                    _id: existing._id,
                    status: existing.status,
                },
                {
                    $set: {
                        driverId: parcel.driverId,
                        fare,
                        commission,
                        commissionPercentage: basisPoints / 100,
                        driverEarnings: fare - commission,
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

        const [createdSettlement] = existing ? [null] : await ParcelSettlement.create(
            [
                {
                    parcelOrderId: parcel._id,
                    driverId: parcel.driverId,
                    fare,
                    commission,
                    commissionPercentage: basisPoints / 100,
                    driverEarnings: fare - commission,
                    currency: "PKR",
                    status: "SETTLED",
                    settledAt,
                },
            ],
            { session }
        );

        await ParcelOrder.updateOne(
            {
                _id: parcel._id,
                status: "DELIVERED",
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

module.exports = { settleParcelCommission };
