const mongoose = require("mongoose");
const PaymentOrder = require("../models/PaymentOrder");
const { creditVerifiedPayment } = require("../services/verifiedPaymentCreditService");

async function listPendingBankTransfers(req, res) {
    try {
        const orders = await PaymentOrder.find({
            gateway: "BANK_TRANSFER",
            status: { $in: ["PENDING", "VERIFIED"] },
        })
            .sort({ createdAt: 1 })
            .limit(100)
            .select("driverId gateway amount currency status expiresAt createdAt gatewayReference")
            .lean();

        return res.json({ success: true, orders });
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: "Unable to load bank transfer orders",
        });
    }
}

async function verifyBankTransfer(req, res) {
    const { orderId } = req.params;
    const { bankReference, verifiedAmount } = req.body || {};

    if (
        !mongoose.isValidObjectId(orderId) ||
        typeof bankReference !== "string" ||
        bankReference.trim().length < 6 ||
        bankReference.trim().length > 150 ||
        !Number.isSafeInteger(verifiedAmount) ||
        verifiedAmount < 1
    ) {
        return res.status(400).json({
            success: false,
            message: "Valid order, bank reference and verified amount required",
        });
    }

    try {
        const order = await PaymentOrder.findOne({
            _id: orderId,
            gateway: "BANK_TRANSFER",
        });

        if (!order) {
            return res.status(404).json({
                success: false,
                message: "Bank transfer order not found",
            });
        }

        if (order.status === "CREDITED") {
            return res.status(409).json({
                success: false,
                message: "This order has already been credited",
            });
        }

        if (order.status === "PENDING") {
            if (order.expiresAt <= new Date()) {
                return res.status(409).json({
                    success: false,
                    message: "Payment order has expired",
                });
            }

            if (verifiedAmount !== order.amount) {
                return res.status(400).json({
                    success: false,
                    message: "Verified bank amount must exactly match order amount",
                });
            }

            const updated = await PaymentOrder.findOneAndUpdate(
                { _id: order._id, status: "PENDING" },
                {
                    $set: {
                        status: "VERIFIED",
                        gatewayReference: bankReference.trim(),
                        verificationReference: bankReference.trim(),
                        verificationSource: "BANK_RECONCILIATION",
                        verifiedAmount,
                        verifiedAt: new Date(),
                    },
                },
                { new: true }
            );

            if (!updated) {
                return res.status(409).json({
                    success: false,
                    message: "Order status changed; refresh and retry",
                });
            }
        } else if (order.status !== "VERIFIED") {
            return res.status(409).json({
                success: false,
                message: "Order cannot be verified in its current status",
            });
        } else if (
            order.verifiedAmount !== order.amount ||
            order.verificationSource !== "BANK_RECONCILIATION"
        ) {
            return res.status(409).json({
                success: false,
                message: "Existing verification requires manual reconciliation",
            });
        }

        const result = await creditVerifiedPayment(order._id);

        return res.json({
            success: true,
            message: "Verified bank payment credited to driver wallet",
            result,
        });
    } catch (error) {
        console.error("Bank transfer verification error:", error.message);
        return res.status(500).json({
            success: false,
            message: "Verification or wallet credit failed; check reconciliation before retrying",
        });
    }
}

module.exports = {
    listPendingBankTransfers,
    verifyBankTransfer,
};