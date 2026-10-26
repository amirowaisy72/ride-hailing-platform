const PaymentOrder = require("../models/PaymentOrder");
const PaymentGatewayConfig = require("../models/PaymentGatewayConfig");
const { decryptCredentials } = require("../services/paymentCredentialEncryption");
const { verifyUblResponse } = require("../services/ublPaymentService");
const { creditVerifiedPayment } = require("../services/verifiedPaymentCreditService");
const { redirectToPaymentResult } = require("../utils/paymentResultRedirect");

// UBL return handler for DRIVER WALLET TOP-UPS only. Mirrors
// jazzCashCallbackController: the wallet is credited solely after the
// signed gateway response verifies against the merchant credentials
// saved in the admin dashboard for the order's environment, and the
// amount (minor units) is re-checked against the order.
async function ublCallback(req, res) {
    try {
        const response = req.body || {};
        const txnRef = response.pp_TxnRefNo;

        if (
            typeof txnRef !== "string" ||
            typeof response.pp_ResponseCode !== "string" ||
            typeof response.pp_SecureHash !== "string"
        ) {
            return res.status(400).json({
                success: false,
                message: "Invalid payment response.",
            });
        }

        const order = await PaymentOrder.findOne({
            gateway: "UBL",
            merchantTxnReference: txnRef,
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
            provider: "UBL",
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
            response.pp_MerchantID !== credentials.merchantId ||
            !verifyUblResponse(response, credentials.hashKey)
        ) {
            return res.status(400).json({
                success: false,
                message: "Payment response verification failed.",
            });
        }

        if (
            response.pp_ResponseCode !== "000" ||
            response.pp_TxnCurrency !== "PKR" ||
            !Number.isSafeInteger(Number(response.pp_Amount)) ||
            Number(response.pp_Amount) !== order.amount * 100
        ) {
            await PaymentOrder.updateOne(
                { _id: order._id, status: "PENDING" },
                {
                    $set: {
                        status: "FAILED",
                        failureReason: "Payment failed or amount/currency mismatch.",
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
            response.pp_RetreivalReferenceNo ||
            response.pp_RetrievalReferenceNo;

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
        console.error("UBL callback error:", error.message);

        return res.status(500).json({
            success: false,
            message: "Payment processing failed; check order status before retrying.",
        });
    }
}

module.exports = { ublCallback };
