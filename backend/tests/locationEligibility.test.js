// GPS fix (Phase 8 finding) — unit tests for the socket location
// handler's eligibility mirror (plain node, no test framework, no DB).
//
// The realtime trees run without the backend's Mongoose models, so
// realtime/handlers/driverLocationHandler.js carries a pure mirror of
// eligibilityService.evaluateServiceEligibility over raw records.
// These tests pin the mirror to the service — the single source of
// truth — over a shared fixture matrix: for every snapshot the
// mirror's "any service eligible" verdict must equal the service's,
// and must equal the independently expected verdict.
//
// Run:  node tests/locationEligibility.test.js
// Exit code 0 = all passed, 1 = at least one failure.

const assert = require("node:assert");

const {
    SERVICES,
    evaluateServiceEligibility,
} = require("../src/services/eligibilityService");
const {
    driverHasAnyEligibleService,
} = require("../src/realtime/handlers/driverLocationHandler");

const DAY = 24 * 60 * 60 * 1000;
const FUTURE = new Date(Date.now() + 365 * DAY);
const PAST = new Date(Date.now() - DAY);

function doc(documentType, verificationStatus = "APPROVED", expiryDate = null) {
    return { documentType, verificationStatus, expiryDate };
}

const FULL_DOCS = [
    doc("CNIC_FRONT"),
    doc("CNIC_BACK"),
    doc("PROFILE_PHOTO"),
    doc("DRIVING_LICENSE", "APPROVED", FUTURE),
    doc("VEHICLE_REGISTRATION", "APPROVED", FUTURE),
];

const NO_PHOTO_DOCS = FULL_DOCS.filter((d) => d.documentType !== "PROFILE_PHOTO");

const EXPIRED_LICENCE_DOCS = FULL_DOCS.map((d) =>
    d.documentType === "DRIVING_LICENSE" ? doc("DRIVING_LICENSE", "APPROVED", PAST) : d
);

const CAR = { vehicleType: "CAR_AC", registrationExpiryDate: FUTURE };
const BIKE = { vehicleType: "BIKE", registrationExpiryDate: FUTURE };
const EXPIRED_CAR = { vehicleType: "CAR_AC", registrationExpiryDate: PAST };

function bdRecord(overrides = {}) {
    return {
        status: "APPROVED",
        enabled: true,
        transportMode: "CAR",
        policyAcknowledgedAt: new Date(),
        purchaseLimit: 50000,
        ...overrides,
    };
}

function svc(driver, overrides = {}) {
    return { RIDE: {}, PARCEL: {}, BUY_DELIVER: {}, ...overrides, ...(driver || {}) };
}

// Each case: { name, driver, vehicle, documents, expected }
const CASES = [
    {
        name: "legacy APPROVED driver, no service records → eligible (derived RIDE/PARCEL)",
        driver: { verificationStatus: "APPROVED" },
        vehicle: CAR,
        documents: FULL_DOCS,
        expected: true,
    },
    {
        name: "Buy & Deliver-ONLY partner (global PENDING, full verification) → eligible",
        driver: {
            verificationStatus: "PENDING",
            services: svc(null, { BUY_DELIVER: bdRecord() }),
        },
        vehicle: CAR,
        documents: FULL_DOCS,
        expected: true,
    },
    {
        name: "BD-only partner missing PROFILE_PHOTO → not eligible",
        driver: {
            verificationStatus: "PENDING",
            services: svc(null, { BUY_DELIVER: bdRecord() }),
        },
        vehicle: CAR,
        documents: NO_PHOTO_DOCS,
        expected: false,
    },
    {
        name: "BD-only partner with an EXPIRED licence → not eligible",
        driver: {
            verificationStatus: "PENDING",
            services: svc(null, { BUY_DELIVER: bdRecord() }),
        },
        vehicle: CAR,
        documents: EXPIRED_LICENCE_DOCS,
        expected: false,
    },
    {
        name: "BD-only partner without an approved active vehicle → not eligible",
        driver: {
            verificationStatus: "PENDING",
            services: svc(null, { BUY_DELIVER: bdRecord() }),
        },
        vehicle: null,
        documents: FULL_DOCS,
        expected: false,
    },
    {
        name: "global SUSPENDED blocks even an approved Buy & Deliver record",
        driver: {
            verificationStatus: "SUSPENDED",
            services: svc(null, { BUY_DELIVER: bdRecord() }),
        },
        vehicle: CAR,
        documents: FULL_DOCS,
        expected: false,
    },
    {
        name: "global REJECTED does not block an independently approved Buy & Deliver",
        driver: {
            verificationStatus: "REJECTED",
            services: svc(null, { BUY_DELIVER: bdRecord() }),
        },
        vehicle: CAR,
        documents: FULL_DOCS,
        expected: true,
    },
    {
        name: "PENDING driver who never applied anywhere → not eligible",
        driver: { verificationStatus: "PENDING" },
        vehicle: CAR,
        documents: FULL_DOCS,
        expected: false,
    },
    {
        name: "BD record APPROVED but service turned OFF by the driver → not eligible",
        driver: {
            verificationStatus: "PENDING",
            services: svc(null, { BUY_DELIVER: bdRecord({ enabled: false }) }),
        },
        vehicle: CAR,
        documents: FULL_DOCS,
        expected: false,
    },
    {
        name: "BD MOTORBIKE partner with a CAR vehicle → not eligible; with a BIKE → eligible",
        driver: {
            verificationStatus: "PENDING",
            services: svc(null, { BUY_DELIVER: bdRecord({ transportMode: "MOTORBIKE" }) }),
        },
        vehicle: CAR,
        documents: FULL_DOCS,
        expected: false,
    },
    {
        name: "BD MOTORBIKE partner with a BIKE vehicle → eligible",
        driver: {
            verificationStatus: "PENDING",
            services: svc(null, { BUY_DELIVER: bdRecord({ transportMode: "MOTORBIKE" }) }),
        },
        vehicle: BIKE,
        documents: FULL_DOCS,
        expected: true,
    },
    {
        name: "BD partner without a transport mode → not eligible",
        driver: {
            verificationStatus: "PENDING",
            services: svc(null, { BUY_DELIVER: bdRecord({ transportMode: null }) }),
        },
        vehicle: CAR,
        documents: FULL_DOCS,
        expected: false,
    },
    {
        name: "BD partner who never acknowledged the purchase policy → not eligible",
        driver: {
            verificationStatus: "PENDING",
            services: svc(null, { BUY_DELIVER: bdRecord({ policyAcknowledgedAt: null }) }),
        },
        vehicle: CAR,
        documents: FULL_DOCS,
        expected: false,
    },
    {
        name: "BD-only partner whose vehicle registration expired → not eligible",
        driver: {
            verificationStatus: "PENDING",
            services: svc(null, { BUY_DELIVER: bdRecord() }),
        },
        vehicle: EXPIRED_CAR,
        documents: FULL_DOCS,
        expected: false,
    },
    {
        name: "explicit per-service RIDE approval (global PENDING) → eligible",
        driver: {
            verificationStatus: "PENDING",
            services: svc(null, { RIDE: { status: "APPROVED", enabled: true } }),
        },
        vehicle: CAR,
        documents: FULL_DOCS,
        expected: true,
    },
    {
        name: "legacy APPROVED with explicit RIDE REJECTED still derives PARCEL → eligible",
        driver: {
            verificationStatus: "APPROVED",
            services: svc(null, { RIDE: { status: "REJECTED", enabled: true } }),
        },
        vehicle: CAR,
        documents: FULL_DOCS,
        expected: true,
    },
];

const tests = [];
function test(name, fn) {
    tests.push({ name, fn });
}

test("socket mirror matches eligibilityService verdicts AND expectations on every fixture", () => {
    for (const c of CASES) {
        const serviceVerdict = SERVICES.some(
            (service) =>
                evaluateServiceEligibility(service, {
                    driver: c.driver,
                    vehicle: c.vehicle,
                    documents: c.documents,
                }).eligible
        );

        assert.strictEqual(
            serviceVerdict,
            c.expected,
            `eligibilityService itself disagrees with the expectation: ${c.name}`
        );

        const mirrorVerdict = driverHasAnyEligibleService(
            c.driver,
            c.vehicle,
            c.documents
        );

        assert.strictEqual(
            mirrorVerdict,
            c.expected,
            `socket mirror verdict mismatch: ${c.name}`
        );
    }

    return `${CASES.length} fixtures in parity`;
});

test("BD-only partner is eligible through the mirror even with NO legacy documents derivation", () => {
    const driver = {
        verificationStatus: "PENDING",
        services: svc(null, { BUY_DELIVER: bdRecord() }),
    };

    assert.strictEqual(driverHasAnyEligibleService(driver, CAR, FULL_DOCS), true);
});

test("a driver eligible for nothing is refused by the mirror", () => {
    assert.strictEqual(
        driverHasAnyEligibleService({ verificationStatus: "PENDING" }, null, []),
        false
    );
    assert.strictEqual(
        driverHasAnyEligibleService({ verificationStatus: "PENDING" }, CAR, FULL_DOCS),
        false
    );
});

(async () => {
    let passed = 0;
    const failures = [];

    for (const { name, fn } of tests) {
        try {
            const detail = await fn();
            passed += 1;
            console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ""}`);
        } catch (error) {
            failures.push({ name, error });
            console.log(`  FAIL  ${name}`);
            console.log(`        ${error.message.split("\n")[0]}`);
        }
    }

    console.log(
        `\n${passed}/${tests.length} tests passed` +
            (failures.length ? ` — ${failures.length} FAILED` : "")
    );

    process.exitCode = failures.length ? 1 : 0;
})();
