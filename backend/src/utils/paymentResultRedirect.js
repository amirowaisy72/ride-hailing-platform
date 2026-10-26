const CommissionSettings = require("../models/CommissionSettings");
const {
    getPaymentResultUrl,
} = require("../services/paymentsConfigService");

// Shared post-payment redirect for all gateway callback controllers.
// The result URL comes from the dashboard-managed commission settings
// first, with PAYMENT_RESULT_URL as the environment fallback. When no
// result URL is configured, the callback answers with JSON instead.
async function redirectToPaymentResult(res, order, status, message) {
    const settings = await CommissionSettings.findOne({
        key: "GLOBAL",
    })
        .select("paymentResultUrl")
        .lean();

    const target = getPaymentResultUrl(settings);

    if (!target) {
        return res.json({
            success: status === "success",
            message,
            orderId: String(order._id),
            status,
        });
    }

    const url = new URL(target);

    const isLocalhost =
        url.hostname === "localhost" &&
        ["http:", "https:"].includes(url.protocol);

    const isSafarAppReturn =
        url.protocol === "com.safar.ridehailing:" &&
        url.hostname === "driver" &&
        url.pathname === "/earnings";

    if (
        url.protocol !== "https:" &&
        !isLocalhost &&
        !isSafarAppReturn
    ) {
        throw new Error("Invalid payment result URL");
    }

    url.searchParams.set("paymentStatus", status);
    url.searchParams.set("paymentOrderId", String(order._id));

    return res.redirect(303, url.toString());
}

module.exports = { redirectToPaymentResult };
