const mongoose = require("mongoose");
const Driver = require("../models/Driver");
const DriverWallet = require("../models/DriverWallet");
const WalletTransaction = require("../models/WalletTransaction");
const { ensureDriverWallet } = require("./driverWalletService");

async function topUpDriverWallet({
    driverId,
    amount,
    idempotencyKey,
    adminUserId,
    description = "",
}) {
    if (
        !mongoose.isValidObjectId(driverId) ||
        !mongoose.isValidObjectId(adminUserId) ||
        !Number.isSafeInteger(amount) ||
        amount < 1 ||
        amount > 1000000 ||
        typeof idempotencyKey !== "string" ||
        !/^[a-zA-Z0-9:_-]{12,100}$/.test(idempotencyKey) ||
        typeof description !== "string" ||
        description.length > 500
    ) {
        throw new Error("Invalid wallet top-up details");
    }

    // Admin top-ups must never be used as unverified payment callbacks.
    // Merchant payments require a separate server-verified credit flow.
    if (
        /^(payment|merchant|gateway|sandbox):/i.test(idempotencyKey)
    ) {
        throw new Error(
            "Payment idempotency keys cannot be used for admin top-ups"
        );
    }

    return mongoose.connection.transaction(async (session) => {
        const existing = await WalletTransaction.findOne({
            idempotencyKey,
        }).session(session);

        if (existing) {
            if (
                existing.type !== "TOP_UP" ||
                String(existing.driverId) !== String(driverId) ||
                existing.amount !== amount ||
                String(existing.createdBy) !== String(adminUserId) ||
                existing.paymentGateway != null ||
                existing.paymentReference != null ||
                existing.paymentStatus === "VERIFIED" ||
                existing.paymentGateway != null ||
                existing.paymentReference != null
            ) {
                throw new Error("Idempotency key already used");
            }

            return {
                alreadyProcessed: true,
                transaction: existing,
            };
        }

        const driver = await Driver.findById(driverId)
            .select("_id")
            .session(session);

        if (!driver) {
            throw new Error("Driver not found");
        }

        const wallet = await ensureDriverWallet(driverId, session);

        const updated = await DriverWallet.findOneAndUpdate(
            {
                _id: wallet._id,
                balance: wallet.balance,
            },
            {
                $inc: {
                    balance: amount,
                    totalTopUps: amount,
                },
            },
            {
                returnDocument: "after",
                session,
            }
        );

        if (!updated) {
            throw new Error("Wallet changed; retry top-up");
        }

        const [transaction] = await WalletTransaction.create(
            [
                {
                    walletId: wallet._id,
                    driverId,
                    type: "TOP_UP",
                    amount,
                    balanceBefore: wallet.balance,
                    balanceAfter: updated.balance,
                    description: description.trim(),
                    idempotencyKey,
                    createdBy: adminUserId,
                    paymentStatus: "NOT_APPLICABLE",
                    paymentGateway: null,
                    paymentReference: null,
                    paymentVerifiedAt: null,
                    paymentStatus: "NOT_APPLICABLE",
                    paymentGateway: null,
                    paymentReference: null,
                    paymentVerifiedAt: null,
                },
            ],
            { session }
        );

        return {
            alreadyProcessed: false,
            transaction,
            balance: updated.balance,
        };
    });
}

module.exports = { topUpDriverWallet };