const crypto = require("crypto");

// UBL hosted-checkout integration for DRIVER WALLET TOP-UPS,
// mirroring services/jazzCashPaymentService.js: a signed checkout
// form is built from the dashboard-saved merchant credentials, and
// the gateway's signed response is verified (timing-safe) before the
// callback controller credits the wallet.
//
// Credentials contract (admin dashboard, provider UBL):
//   merchantId — UBL merchant id
//   password   — merchant terminal/password value
//   hashKey    — merchant secure hash key issued by UBL
//   paymentUrl — hosted checkout URL (HTTPS, issued merchant portal)

const SIGNATURE_FIELD = "pp_SecureHash";

function calculateAmountInMinor(amount) {
    if (
        !Number.isSafeInteger(amount) ||
        amount < 1 ||
        amount > 1000000
    ) {
        throw new Error("Invalid payment amount");
    }

    return String(amount * 100);
}

function generateSignature(fields, hashKey) {
    if (typeof hashKey !== "string" || !hashKey.trim()) {
        throw new Error("UBL hash key is required");
    }

    const values = Object.keys(fields)
        .filter(
            (key) =>
                key !== SIGNATURE_FIELD &&
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

function createUblCheckout({ order, credentials, returnUrl }) {
    if (!order || !credentials) {
        throw new Error("Payment order and credentials are required");
    }

    const { merchantId, password, hashKey, paymentUrl } = credentials;

    if (!merchantId || !password || !hashKey || !paymentUrl) {
        throw new Error("UBL merchant configuration is incomplete");
    }

    if (typeof returnUrl !== "string" || !returnUrl.trim()) {
        throw new Error("Payment return URL is required");
    }

    const callbackUrl = new URL(returnUrl);

    if (
        callbackUrl.protocol !== "https:" ||
        callbackUrl.pathname !== "/api/v1/payments/ubl/callback"
    ) {
        throw new Error("Invalid UBL callback URL");
    }

    const url = new URL(paymentUrl);

    if (url.protocol !== "https:") {
        throw new Error("Unapproved UBL payment URL");
    }

    const now = new Date();

    const formatTimestamp = (date) =>
        date.getFullYear().toString() +
        String(date.getMonth() + 1).padStart(2, "0") +
        String(date.getDate()).padStart(2, "0") +
        String(date.getHours()).padStart(2, "0") +
        String(date.getMinutes()).padStart(2, "0") +
        String(date.getSeconds()).padStart(2, "0");

    const fields = {
        pp_MerchantID: merchantId,
        pp_Password: password,
        pp_TxnRefNo: order.merchantTxnReference,
        pp_Amount: calculateAmountInMinor(order.amount),
        pp_TxnCurrency: "PKR",
        pp_TxnDateTime: formatTimestamp(now),
        pp_BillReference: `W${String(order._id).slice(-12)}`,
        pp_Description: "Safar driver wallet top-up",
        pp_ReturnURL: returnUrl,
    };

    fields[SIGNATURE_FIELD] = generateSignature(fields, hashKey);

    return {
        paymentUrl: url.toString(),
        fields,
    };
}

function verifyUblResponse(response, hashKey) {
    if (
        !response ||
        typeof response !== "object" ||
        typeof response[SIGNATURE_FIELD] !== "string" ||
        typeof response.pp_TxnRefNo !== "string" ||
        typeof response.pp_ResponseCode !== "string"
    ) {
        return false;
    }

    const fields = Object.fromEntries(
        Object.entries(response).filter(
            ([key, value]) =>
                key.startsWith("pp_") &&
                key !== SIGNATURE_FIELD &&
                value !== undefined &&
                value !== null &&
                String(value) !== ""
        )
    );

    const expected = generateSignature(fields, hashKey).toUpperCase();
    const received = response[SIGNATURE_FIELD].toUpperCase();

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
    calculateAmountInMinor,
    createUblCheckout,
    generateSignature,
    verifyUblResponse,
    UBL_SIGNATURE_FIELD: SIGNATURE_FIELD,
};
