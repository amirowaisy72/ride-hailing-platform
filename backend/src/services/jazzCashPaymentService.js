const crypto = require("crypto");

function generateSecureHash(fields, integritySalt) {
    if (typeof integritySalt !== "string" || !integritySalt.trim()) {
        throw new Error("JazzCash integrity salt is required");
    }

    const values = Object.keys(fields)
        .filter(
            (key) =>
                key !== "pp_SecureHash" &&
                fields[key] !== undefined &&
                fields[key] !== null &&
                String(fields[key]) !== ""
        )
        .sort()
        .map((key) => String(fields[key]));

    const message = `${integritySalt}&${values.join("&")}`;
    const latin1Message = Buffer.from(
        Buffer.from(message, "utf8").toString("latin1"),
        "latin1"
    );

    return crypto
        .createHmac("sha256", Buffer.from(integritySalt, "utf8"))
        .update(latin1Message)
        .digest("hex");
}

function createJazzCashCheckout({ order, credentials, returnUrl }) {
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

    const {
        merchantId,
        password,
        integritySalt,
        paymentUrl,
        transactionType,
    } = credentials;

    if (
        !merchantId ||
        !password ||
        !integritySalt ||
        !paymentUrl ||
        !["MWALLET", "OTC", "MPAY"].includes(transactionType)
    ) {
        throw new Error("JazzCash merchant configuration is incomplete");
    }

    const url = new URL(paymentUrl);

    if (
        typeof returnUrl !== "string" ||
        !returnUrl.trim()
    ) {
        throw new Error("PAYMENT_RETURN_URL is required");
    }

    const callbackUrl = new URL(returnUrl);

    if (
        callbackUrl.protocol !== "https:" ||
        callbackUrl.pathname !== "/api/v1/payments/jazzcash/callback"
    ) {
        throw new Error("Invalid JazzCash callback URL");
    }

    const allowedHosts = [
        "sandbox.jazzcash.com.pk",
        "payments.jazzcash.com.pk",
    ];

    if (
        url.protocol !== "https:" ||
        !allowedHosts.includes(url.hostname)
    ) {
        throw new Error("Unapproved JazzCash payment URL");
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
        pp_Version: "1.1",
        pp_TxnType: transactionType,
        pp_Language: "EN",
        pp_MerchantID: merchantId,
        pp_Password: password,
        pp_TxnRefNo: order.merchantTxnReference,
        pp_Amount: String(order.amount * 100),
        pp_TxnCurrency: "PKR",
        pp_TxnDateTime: formatTimestamp(now),
        pp_TxnExpiryDateTime: formatTimestamp(expiry),
        pp_BillReference: `W${String(order._id).slice(-18)}`,
        pp_Description: "Safar driver wallet top-up",
        pp_ReturnURL: returnUrl,
    };

    fields.pp_SecureHash = generateSecureHash(
        fields,
        integritySalt
    );

    return {
        paymentUrl: url.toString(),
        fields,
    };
}

function verifyJazzCashResponse(response, integritySalt) {
    if (
        !response ||
        typeof response !== "object" ||
        typeof response.pp_SecureHash !== "string" ||
        typeof response.pp_TxnRefNo !== "string" ||
        typeof response.pp_ResponseCode !== "string"
    ) {
        return false;
    }

    const fields = Object.fromEntries(
        Object.entries(response).filter(
            ([key, value]) =>
                key.startsWith("pp_") &&
                key !== "pp_SecureHash" &&
                value !== undefined &&
                value !== null &&
                String(value) !== ""
        )
    );

    const expected = generateSecureHash(fields, integritySalt).toUpperCase();
    const received = response.pp_SecureHash.toUpperCase();

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
    createJazzCashCheckout,
    generateSecureHash,
    verifyJazzCashResponse,
};