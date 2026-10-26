const mongoose = require("mongoose");
const PaymentOrder = require("../models/PaymentOrder");
const DriverWallet = require("../models/DriverWallet");
const WalletTransaction = require("../models/WalletTransaction");

// Admin-approved refund of a COMPLETED driver wallet top-up.
//
// Scope: ledger reversal only. The money return on the gateway side
// stays MANUAL — the admin returns the amount from the merchant
// portal (or reverses the bank transfer) and records that reference
// on the order (gatewayRefundReference). This service debits the
// driver's wallet back and marks the order REFUNDED.
//
// Rules: full amount only; the order must be CREDITED; the original
// TOP_UP ledger entry must exist; the wallet must still hold at
// least the top-up amount (no silent partial refunds). Idempotent:
// a second call returns the existing refund instead of double-debiting.
async function refundTopUpOrder(orderId, adminUserId, options = {}) {
    if (!mongoose.isValidObjectId(orderId)) {
        throw new Error("Invalid payment order");
    }

    const reason =
        typeof options.reason === "string" ? options.reason.trim() : "";
    const gatewayRefundReference =
        typeof options.gatewayRefundReference === "string" &&
        options.gatewayRefundReference.trim()
            ? options.gatewayRefundReference.trim()
            : null;

    return mongoose.connection.transaction(async (session) => {
        const order = await PaymentOrder.findById(orderId).session(session);

        if (!order) {
            throw new Error("Payment order not found");
        }

        const idempotencyKey = `refund:${order._id}`;

        const existing = await WalletTransaction.findOne({
            idempotencyKey,
        }).session(session);

        if (existing) {
            if (order.status !== "REFUNDED") {
                throw new Error("Refund reconciliation required");
            }

            return {
                alreadyRefunded: true,
                transaction: existing,
            };
        }

        if (order.status !== "CREDITED") {
            throw new Error("Only a credited top-up can be refunded");
        }

        const original = await WalletTransaction.findOne({
            idempotencyKey: `payment:${order._id}`,
        }).session(session);

        if (!original || original.type !== "TOP_UP") {
            throw new Error("Original top-up ledger entry not found");
        }

        const wallet = await DriverWallet.findOne({
            driverId: order.driverId,
        }).session(session);

        if (!wallet) {
            throw new Error("Driver wallet not found");
        }

        if (
            !Number.isSafeInteger(wallet.balance) ||
            wallet.balance < order.amount
        ) {
            throw new Error(
                "Wallet balance is below the top-up amount; a full refund is not possible"
            );
        }

        const updated = await DriverWallet.findOneAndUpdate(
            {
                _id: wallet._id,
                balance: wallet.balance,
            },
            {
                $inc: {
                    balance: -order.amount,
                    totalTopUps: -order.amount,
                },
            },
            { session, returnDocument: "after" }
        );

        if (!updated) {
            throw new Error("Wallet changed; retry refund");
        }

        // NOTE: paymentOrderId stays null on the refund row — the
        // ledger has a unique partial index on paymentOrderId and the
        // original TOP_UP row already owns this order's id. The
        // refund is traced via idempotencyKey `refund:<orderId>` and
        // its own paymentReference (the gateway refund reference, or a
        // derived unique value when the admin did not supply one).
        const [transaction] = await WalletTransaction.create(
            [{
                walletId: wallet._id,
                driverId: order.driverId,
                type: "REFUND",
                amount: order.amount,
                balanceBefore: wallet.balance,
                balanceAfter: updated.balance,
                description: (
                    `Refund of ${order.gateway} top-up ${order._id}` +
                    (reason ? `: ${reason}` : "")
                ).slice(0, 500),
                idempotencyKey,
                paymentGateway: order.gateway,
                paymentReference:
                    gatewayRefundReference || `refund:${order._id}`,
                paymentStatus: "VERIFIED",
                paymentAmount: order.amount,
                paymentCurrency: "PKR",
                createdBy: adminUserId || null,
            }],
            { session }
        );

        order.status = "REFUNDED";
        order.refundedAt = new Date();
        order.refundedBy = adminUserId || null;
        order.refundReason = reason;
        order.gatewayRefundReference = gatewayRefundReference;
        await order.save({ session });

        return {
            alreadyRefunded: false,
            transaction,
            balance: updated.balance,
        };
    });
}

module.exports = { refundTopUpOrder };
