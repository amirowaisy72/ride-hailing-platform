function assertFinancialTestEnvironment(uri) {
    if (process.env.NODE_ENV !== "test") {
        throw new Error("NODE_ENV must be test");
    }

    if (process.env.FINANCIAL_TEST_MODE !== "true") {
        throw new Error("Financial test mode is disabled");
    }

    if (typeof uri !== "string" || !uri.trim()) {
        throw new Error("Financial test MongoDB URI is missing");
    }

    const parsed = new URL(uri);
    const databaseName = decodeURIComponent(
        parsed.pathname.replace(/^\/+/, "")
    );

    if (databaseName !== "ride_hailing_financial_test") {
        throw new Error(
            "Blocked: financial tests require ride_hailing_financial_test"
        );
    }

    if (parsed.searchParams.has("authSource") &&
        parsed.searchParams.get("authSource") === "ride_hailing_production") {
        throw new Error("Production authentication database is not allowed");
    }

    return true;
}

module.exports = { assertFinancialTestEnvironment };