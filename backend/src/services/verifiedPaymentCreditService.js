const mongoose = require("mongoose");
const PaymentOrder = require("../models/PaymentOrder");
const DriverWallet = require("../models/DriverWallet");
const WalletTransaction = require("../models/WalletTransaction");
const { ensureDriverWallet } = require("./driverWalletService");

// Internal service only. Never expose directly as an API route.
// Gateway verification must happen server-side before calling this.
async function creditVerifiedPayment(orderId) {
    if (!mongoose.isValidObjectId(orderId)) {
        throw new Error("Invalid payment order");
    }

    return mongoose.connection.transaction(async (session) => {
        const order = await PaymentOrder.findById(orderId)
            .session(session);

        if (!order) {
            throw new Error("Payment order not found");
        }

        const idempotencyKey = `payment:${order._id}`;

        const existing = await WalletTransaction.findOne({
            idempotencyKey,
        }).session(session);

        if (existing) {
            if (order.status !== "CREDITED") {
                throw new Error("Payment reconciliation required");
            }

            if (
                existing.type !== "TOP_UP" ||
                String(existing.driverId) !== String(order.driverId) ||
                existing.amount !== order.amount ||
                String(existing.paymentOrderId) !== String(order._id) ||
                existing.paymentGateway !== order.gateway ||
                existing.paymentReference !== order.gatewayReference ||
                existing.paymentStatus !== "VERIFIED" ||
                String(order.walletTransactionId) !== String(existing._id) ||
                order.creditedAmount !== order.amount
            ) {
                throw new Error("Payment reconciliation required");
            }

            return {
                alreadyCredited: true,
                transaction: existing,
            };
        }

        if (
            order.status !== "VERIFIED" ||
            order.expiresAt <= new Date() ||
            !order.verifiedAt ||
            !order.gatewayReference ||
            !order.verificationReference ||
            !["GATEWAY_API", "SIGNED_WEBHOOK", "BANK_RECONCILIATION"]
                .includes(order.verificationSource) ||
            (order.gateway === "BANK_TRANSFER" &&
                order.verificationSource !== "BANK_RECONCILIATION") ||
            (order.gateway !== "BANK_TRANSFER" &&
                order.verificationSource === "BANK_RECONCILIATION") ||
            order.creditedAt != null ||
            order.walletTransactionId != null ||
            order.creditedAmount !== 0 ||
            !Number.isSafeInteger(order.amount) ||
            order.amount < 1 ||
            order.verifiedAmount !== order.amount ||
            order.currency !== "PKR"
        ) {
            throw new Error("Payment is not verified");
        }

        const duplicateReference = await WalletTransaction.findOne({
            paymentGateway: order.gateway,
            paymentReference: order.gatewayReference,
        }).session(session);

        if (duplicateReference) {
            throw new Error("Payment reference already credited");
        }

        const wallet = await ensureDriverWallet(
            order.driverId,
            session
        );

        if (
            !Number.isSafeInteger(wallet.balance) ||
            wallet.balance < 0 ||
            !Number.isSafeInteger(wallet.balance + order.amount)
        ) {
            throw new Error("Wallet balance limit exceeded");
        }

        const updated = await DriverWallet.findOneAndUpdate(
            {
                _id: wallet._id,
                balance: wallet.balance,
            },
            {
                $inc: {
                    balance: order.amount,
                    totalTopUps: order.amount,
                },
            },
            { session, returnDocument: "after" }
        );

        if (!updated) {
            throw new Error("Wallet changed; retry credit");
        }

        const [transaction] = await WalletTransaction.create(
            [{
                walletId: wallet._id,
                driverId: order.driverId,
                type: "TOP_UP",
                amount: order.amount,
                balanceBefore: wallet.balance,
                balanceAfter: updated.balance,
                description: `Verified ${order.gateway} payment`,
                idempotencyKey,
                paymentGateway: order.gateway,
                paymentReference: order.gatewayReference,
                paymentOrderId: String(order._id),
                paymentAmount: order.amount,
                paymentCurrency: "PKR",
                paymentStatus: "VERIFIED",
                paymentVerifiedAt: order.verifiedAt,
            }],
            { session }
        );

        order.status = "CREDITED";
        order.creditedAt = new Date();
        order.creditedAmount = order.amount;
        order.walletTransactionId = transaction._id;

        await order.save({ session });

        return {
            alreadyCredited: false,
            transaction,
            balance: updated.balance,
        };
    });
}

module.exports = { creditVerifiedPayment };