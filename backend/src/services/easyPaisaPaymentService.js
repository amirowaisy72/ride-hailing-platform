const crypto = require("crypto");

// EasyPaisa hosted-checkout integration for DRIVER WALLET TOP-UPS,
// mirroring services/jazzCashPaymentService.js: a signed checkout form
// is built from the dashboard-saved merchant credentials, and the
// gateway's signed response is verified (timing-safe) before the
// callback controller credits the wallet.
//
// Credentials contract (admin dashboard, provider EASYPAISA):
//   storeId    — EasyPaisa merchant store id
//   hashKey    — merchant hash key issued with the store
//   paymentUrl — hosted checkout URL (easypay / easypaystg hosts)

const HASH_FIELD = "merchantHashedReq";

function generateMerchantHash(fields, hashKey) {
    if (typeof hashKey !== "string" || !hashKey.trim()) {
        throw new Error("EasyPaisa hash key is required");
    }

    const values = Object.keys(fields)
        .filter(
            (key) =>
                key !== HASH_FIELD &&
                fields[key] !== undefined &&
                fields[key] !== null &&
                String(fields[key]) !== ""
        )
        .sort()
        .map((key) => String(fields[key]));

    const message = `${hashKey}&${values.join("&")}`;
    const latin1Message = Buffer.from(
        Buffer.from(message, "utf8").toString("latin1"),
        "latin1"
    );

    return crypto
        .createHmac("sha256", Buffer.from(hashKey, "utf8"))
        .update(latin1Message)
        .digest("hex");
}

function createEasyPaisaCheckout({ order, credentials, returnUrl }) {
    if (!order || !credentials) {
        throw new Error("Payment order and credentials are required");
    }

    if (
        !Number.isSafeInteger(order.amount) ||
        order.amount < 1 ||
        order.amount > 1000000
    ) {
        throw new Error("Invalid payment amount");
    }

    const { storeId, hashKey, paymentUrl } = credentials;

    if (!storeId || !hashKey || !paymentUrl) {
        throw new Error("EasyPaisa merchant configuration is incomplete");
    }

    if (typeof returnUrl !== "string" || !returnUrl.trim()) {
        throw new Error("Payment return URL is required");
    }

    const callbackUrl = new URL(returnUrl);

    if (
        callbackUrl.protocol !== "https:" ||
        callbackUrl.pathname !== "/api/v1/payments/easypaisa/callback"
    ) {
        throw new Error("Invalid EasyPaisa callback URL");
    }

    const url = new URL(paymentUrl);

    const allowedHosts = [
        "easypay.easypaisa.com.pk",
        "easypaystg.easypaisa.com.pk",
    ];

    if (
        url.protocol !== "https:" ||
        !allowedHosts.includes(url.hostname)
    ) {
        throw new Error("Unapproved EasyPaisa payment URL");
    }

    const now = new Date();
    const expiry = new Date(now.getTime() + 15 * 60 * 1000);

    const formatTimestamp = (date) =>
        date.getFullYear().toString() +
        String(date.getMonth() + 1).padStart(2, "0") +
        String(date.getDate()).padStart(2, "0") +
        String(date.getHours()).padStart(2, "0") +
        String(date.getMinutes()).padStart(2, "0") +
        String(date.getSeconds()).padStart(2, "0");

    const fields = {
        storeId,
        orderRefNum: order.merchantTxnReference,
        transactionAmount: order.amount.toFixed(2),
        transactionCurrency: "PKR",
        paymentMethod: credentials.paymentMethod || "MA",
        postBackURL: returnUrl,
        transactionDateTime: formatTimestamp(now),
        expiryDateTime: formatTimestamp(expiry),
        description: "Safar driver wallet top-up",
    };

    fields[HASH_FIELD] = generateMerchantHash(fields, hashKey);

    return {
        paymentUrl: url.toString(),
        fields,
    };
}

function verifyEasyPaisaResponse(response, hashKey) {
    if (
        !response ||
        typeof response !== "object" ||
        typeof response[HASH_FIELD] !== "string" ||
        typeof response.orderRefNum !== "string" ||
        typeof response.responseCode !== "string"
    ) {
        return false;
    }

    const fields = Object.fromEntries(
        Object.entries(response).filter(
            ([key, value]) =>
                key !== HASH_FIELD &&
                value !== undefined &&
                value !== null &&
                String(value) !== ""
        )
    );

    const expected = generateMerchantHash(fields, hashKey).toUpperCase();
    const received = response[HASH_FIELD].toUpperCase();

    if (
        !/^[A-F0-9]{64}$/.test(received) ||
        !/^[A-F0-9]{64}$/.test(expected)
    ) {
        return false;
    }

    return crypto.timingSafeEqual(
        Buffer.from(expected, "hex"),
        Buffer.from(received, "hex")
    );
}

module.exports = {
    createEasyPaisaCheckout,
    generateMerchantHash,
    verifyEasyPaisaResponse,
    EASYPAISA_HASH_FIELD: HASH_FIELD,
};
