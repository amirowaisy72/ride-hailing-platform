const PaymentOrder = require("../models/PaymentOrder");
const PaymentGatewayConfig = require("../models/PaymentGatewayConfig");
const { decryptCredentials } = require("../services/paymentCredentialEncryption");
const { verifyEasyPaisaResponse } = require("../services/easyPaisaPaymentService");
const { creditVerifiedPayment } = require("../services/verifiedPaymentCreditService");
const { redirectToPaymentResult } = require("../utils/paymentResultRedirect");

// EasyPaisa return handler for DRIVER WALLET TOP-UPS only. Mirrors
// jazzCashCallbackController: the wallet is credited solely after the
// signed gateway response verifies against the merchant credentials
// saved in the admin dashboard for the order's environment, and the
// amount is re-checked against the order.
async function easyPaisaCallback(req, res) {
    try {
        const response = req.body || {};
        const orderReference = response.orderRefNum;

        if (
            typeof orderReference !== "string" ||
            typeof response.responseCode !== "string" ||
            typeof response.merchantHashedReq !== "string"
        ) {
            return res.status(400).json({
                success: false,
                message: "Invalid payment response.",
            });
        }

        const order = await PaymentOrder.findOne({
            gateway: "EASYPAISA",
            merchantTxnReference: orderReference,
        });

        if (!order) {
            return res.status(404).json({
                success: false,
                message: "Payment order not found.",
            });
        }

        if (order.status === "CREDITED") {
            return redirectToPaymentResult(
                res, order, "success", "Payment already processed."
            );
        }

        if (
            !["PENDING", "VERIFIED"].includes(order.status) ||
            (order.status === "PENDING" && order.expiresAt <= new Date())
        ) {
            return res.status(409).json({
                success: false,
                message: "Payment order is expired or already processed.",
            });
        }

        const config = await PaymentGatewayConfig.findOne({
            provider: "EASYPAISA",
            environment: order.environment || "TEST",
        }).select("+encryptedCredentials");

        if (!config) {
            return res.status(503).json({
                success: false,
                message: "Payment gateway is unavailable.",
            });
        }

        const credentials = decryptCredentials(config.encryptedCredentials);

        if (
            response.storeId !== credentials.storeId ||
            !verifyEasyPaisaResponse(response, credentials.hashKey)
        ) {
            return res.status(400).json({
                success: false,
                message: "Payment response verification failed.",
            });
        }

        if (
            response.responseCode !== "0000" ||
            Number(response.transactionAmount) !== order.amount
        ) {
            await PaymentOrder.updateOne(
                { _id: order._id, status: "PENDING" },
                {
                    $set: {
                        status: "FAILED",
                        failureReason: "Payment failed or amount mismatch.",
                    },
                }
            );

            return redirectToPaymentResult(
                res,
                order,
                "failed",
                "Payment failed. Wallet balance has not been changed."
            );
        }

        const reference =
            response.authCodeRetrievalRefNo ||
            response.transactionRefNum;

        if (typeof reference !== "string" || !reference.trim()) {
            return res.status(400).json({
                success: false,
                message: "Payment reference missing; verification required.",
            });
        }

        let verifiedOrder = order;

        if (order.status === "PENDING") {
            verifiedOrder = await PaymentOrder.findOneAndUpdate(
                {
                    _id: order._id,
                    status: "PENDING",
                    expiresAt: { $gt: new Date() },
                },
                {
                    $set: {
                        status: "VERIFIED",
                        gatewayReference: reference.trim(),
                        verificationReference: reference.trim(),
                        verificationSource: "SIGNED_WEBHOOK",
                        verifiedAmount: order.amount,
                        verifiedAt: new Date(),
                    },
                },
                { new: true }
            );

            if (!verifiedOrder) {
                return res.status(409).json({
                    success: false,
                    message: "Payment order changed; check payment status.",
                });
            }
        } else if (
            order.gatewayReference !== reference.trim() ||
            order.verifiedAmount !== order.amount ||
            order.verificationSource !== "SIGNED_WEBHOOK"
        ) {
            return res.status(409).json({
                success: false,
                message: "Payment verification details mismatch.",
            });
        }

        const result = await creditVerifiedPayment(verifiedOrder._id);

        void result;

        await PaymentGatewayConfig.updateOne(
            { _id: config._id },
            {
                $set: {
                    verified: true,
                    verifiedAt: new Date(),
                },
            }
        );

        return redirectToPaymentResult(
            res,
            verifiedOrder,
            "success",
            "Payment verified and wallet credited."
        );
    } catch (error) {
        console.error("EasyPaisa callback error:", error.message);

        return res.status(500).json({
            success: false,
            message: "Payment processing failed; check order status before retrying.",
        });
    }
}

module.exports = { easyPaisaCallback };
