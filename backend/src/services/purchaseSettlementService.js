const mongoose = require("mongoose");

const PurchaseOrder = require("../models/PurchaseOrder");
const DriverWallet = require("../models/DriverWallet");
const WalletTransaction = require("../models/WalletTransaction");
const CommissionSettings = require("../models/CommissionSettings");
const PurchaseSettlement = require("../models/PurchaseSettlement");
const { ensureDriverWallet } = require("./driverWalletService");
const { paymentsConfigured } = require("./paymentsConfigService");
const { computePurchaseCommission } = require("./purchaseOrderService");

// Buy & Deliver commission settlement, mirroring settleParcelCommission:
// same GLOBAL settings, same Auto Free Mode rule, same wallet CAS debit.
// Idempotency key: `commission:purchase:<purchaseOrderId>`.
//
// The settled "fare" is the order's DELIVERY FEE — the partner's service
// charge. The shopping reimbursement (actualCost) is passenger-to-partner
// COD tracked on the order itself; it is never part of this settlement
// and never enters the wallet.
async function settlePurchaseCommission(purchaseOrderId) {
    if (!mongoose.isValidObjectId(purchaseOrderId)) {
        throw new Error("Invalid purchase order ID");
    }

    return mongoose.connection.transaction(async (session) => {
        const existing = await PurchaseSettlement.findOne({
            purchaseOrderId,
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

        const idempotencyKey = `commission:purchase:${purchaseOrderId}`;

        const previousDebit = await WalletTransaction.findOne({
            idempotencyKey,
        }).session(session);

        if (previousDebit) {
            throw new Error(
                "Existing commission debit requires manual reconciliation"
            );
        }

        const order = await PurchaseOrder.findById(purchaseOrderId)
            .session(session);

        const fare =
            Number.isSafeInteger(order?.deliveryFee) && order.deliveryFee > 0
                ? order.deliveryFee
                : null;

        if (
            !order ||
            !["DELIVERED", "COMPLETED"].includes(order.status) ||
            !order.driverId ||
            fare === null
        ) {
            throw new Error("Invalid delivered purchase order");
        }

        const settings = await CommissionSettings.findOne({
            key: "GLOBAL",
        }).session(session);

        // Auto Free Mode (same rule as rides/parcels): no configured
        // payment method → zero commission, settle as free, never fail.
        // The rate math itself lives in purchaseOrderService so it is
        // unit-tested and identical everywhere.
        const configured = await paymentsConfigured(settings, session);

        const topUpEnforced =
            settings?.topUpRequired === true && configured;

        if (topUpEnforced && settings.isActive !== true) {
            throw new Error("Active commission settings unavailable");
        }

        const { commission, commissionPercentage, driverEarnings } =
            computePurchaseCommission({
                deliveryFee: fare,
                settings,
                paymentsConfiguredFlag: configured,
            });

        if (
            !Number.isSafeInteger(commission) ||
            commission < 0 ||
            commission > fare
        ) {
            throw new Error("Invalid calculated commission");
        }

        const wallet = await ensureDriverWallet(
            order.driverId,
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
                        driverId: order.driverId,
                        rideId: null,
                        parcelOrderId: null,
                        purchaseOrderId: order._id,
                        type: "COMMISSION_DEBIT",
                        amount: commission,
                        balanceBefore: wallet.balance,
                        balanceAfter,
                        description: `Commission for purchase order ${order._id}`,
                        idempotencyKey,
                    },
                ],
                { session }
            );
        }

        const settledAt = new Date();

        const settlement = existing
            ? await PurchaseSettlement.findOneAndUpdate(
                {
                    _id: existing._id,
                    status: existing.status,
                },
                {
                    $set: {
                        driverId: order.driverId,
                        fare,
                        commission,
                        commissionPercentage,
                        driverEarnings,
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

        const [createdSettlement] = existing ? [null] : await PurchaseSettlement.create(
            [
                {
                    purchaseOrderId: order._id,
                    driverId: order.driverId,
                    fare,
                    commission,
                    commissionPercentage,
                    driverEarnings,
                    currency: "PKR",
                    status: "SETTLED",
                    settledAt,
                },
            ],
            { session }
        );

        await PurchaseOrder.updateOne(
            {
                _id: order._id,
                settlementStatus: { $ne: "SETTLED" },
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

module.exports = { settlePurchaseCommission };
