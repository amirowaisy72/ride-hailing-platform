const CommissionSettings = require("../models/CommissionSettings");
const PaymentGatewayConfig = require("../models/PaymentGatewayConfig");

// Production callback route (deployed backend). Used as the default
// return URL when neither the dashboard setting nor the environment
// provides one, so a fresh deployment works without .env edits.
const DEFAULT_PAYMENT_RETURN_URL =
    "https://ride-hailing-api-tezd.onrender.com/api/v1/payments/jazzcash/callback";

// Single source of truth for "can drivers actually pay online right
// now?". Until at least one payment method is configured, the platform
// runs in FREE mode: commission enforcement is skipped everywhere and
// settlements complete with zero commission instead of failing.
// The moment a gateway (or the bank-transfer receiving account) is
// configured, normal commission behaviour resumes automatically —
// no flags to flip, no redeploy.

function getActiveEnvironment(settings) {
    return settings?.paymentEnvironment === "LIVE" ? "LIVE" : "TEST";
}

function bankTransferConfigured(settings) {
    return Boolean(
        typeof settings?.bankName === "string" &&
        settings.bankName.trim() &&
        typeof settings?.bankAccountTitle === "string" &&
        settings.bankAccountTitle.trim() &&
        typeof settings?.bankAccountNumber === "string" &&
        settings.bankAccountNumber.trim()
    );
}

async function paymentsConfigured(settings = null, session = null) {
    let globalSettings = settings;

    if (!globalSettings) {
        globalSettings = await CommissionSettings.findOne({
            key: "GLOBAL",
        }).lean();
    }

    if (bankTransferConfigured(globalSettings)) {
        return true;
    }

    const environment = getActiveEnvironment(globalSettings);

    let query = PaymentGatewayConfig.findOne({
        provider: { $in: ["JAZZCASH", "EASYPAISA", "UBL"] },
        enabled: true,
        environment,
        encryptedCredentials: {
            $exists: true,
            $nin: [null, ""],
        },
    }).select("_id");

    if (session) {
        query = query.session(session);
    }

    const config = await query.lean();

    return Boolean(config);
}

// Dashboard setting first, environment as fallback, production route
// as the final default.
function getPaymentReturnUrl(settings) {
    const fromSettings =
        typeof settings?.paymentReturnUrl === "string"
            ? settings.paymentReturnUrl.trim()
            : "";

    return (
        fromSettings ||
        process.env.PAYMENT_RETURN_URL ||
        DEFAULT_PAYMENT_RETURN_URL
    );
}

function getPaymentResultUrl(settings) {
    const fromSettings =
        typeof settings?.paymentResultUrl === "string"
            ? settings.paymentResultUrl.trim()
            : "";

    return fromSettings || process.env.PAYMENT_RESULT_URL || "";
}

// Every gateway's callback lives under /api/v1/payments/<provider>/
// callback on the same backend, so a provider callback URL is derived
// from the configured JazzCash return URL by swapping the provider
// path segment.
function getGatewayCallbackUrl(settings, provider) {
    const base = getPaymentReturnUrl(settings);

    if (provider === "JAZZCASH") {
        return base;
    }

    const segment = `/jazzcash/callback`;

    if (base.includes(segment)) {
        return base.replace(
            segment,
            `/${provider.toLowerCase()}/callback`
        );
    }

    try {
        const url = new URL(base);
        return `${url.origin}/api/v1/payments/${provider.toLowerCase()}/callback`;
    } catch {
        return `https://ride-hailing-api-tezd.onrender.com/api/v1/payments/${provider.toLowerCase()}/callback`;
    }
}

module.exports = {
    getActiveEnvironment,
    bankTransferConfigured,
    paymentsConfigured,
    getPaymentReturnUrl,
    getPaymentResultUrl,
    getGatewayCallbackUrl,
    DEFAULT_PAYMENT_RETURN_URL,
};
