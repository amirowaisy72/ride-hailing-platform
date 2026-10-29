// Phase 2 — eligibility tests (plain node, no test framework, no DB).
//
// The exported canReceive* helpers accept a preloaded context
// ({ vehicle, documents }), so these tests exercise the REAL production
// eligibility functions against plain-object fixtures without MongoDB.
//
// Run:  node tests/eligibilityService.test.js
// Exit code 0 = all passed, 1 = at least one failure.

const assert = require("node:assert");

const {
    getRequiredDocuments,
    canReceiveRideRequests,
    canReceiveParcelRequests,
    canReceiveBuyDeliverRequests,
} = require("../src/services/eligibilityService");

const DAY = 24 * 60 * 60 * 1000;
const FUTURE = new Date(Date.now() + 365 * DAY);
const PAST = new Date(Date.now() - DAY);

function doc(documentType, verificationStatus = "APPROVED", expiryDate = null) {
    return { documentType, verificationStatus, expiryDate };
}

const MOTOR_DOCS = [
    doc("CNIC_FRONT"),
    doc("CNIC_BACK"),
    doc("DRIVING_LICENSE", "APPROVED", FUTURE),
    doc("VEHICLE_REGISTRATION", "APPROVED", FUTURE),
];

const IDENTITY_DOCS = [
    doc("CNIC_FRONT"),
    doc("CNIC_BACK"),
    doc("PROFILE_PHOTO"),
];

// Buy & Deliver requires this FULL set for every transport mode since
// the Amir correction (2026-10-29): identity documents + profile photo
// + the complete motor-vehicle list. There is no reduced tier.
const BUY_DELIVER_DOCS = [
    doc("CNIC_FRONT"),
    doc("CNIC_BACK"),
    doc("PROFILE_PHOTO"),
    doc("DRIVING_LICENSE", "APPROVED", FUTURE),
    doc("VEHICLE_REGISTRATION", "APPROVED", FUTURE),
];

const BIKE = {
    vehicleType: "BIKE",
    verificationStatus: "APPROVED",
    isActive: true,
    registrationExpiryDate: FUTURE,
};

const CAR = {
    vehicleType: "CAR_AC",
    verificationStatus: "APPROVED",
    isActive: true,
    registrationExpiryDate: FUTURE,
};

// A driver approved before Phase 2 existed: no services records at all.
const LEGACY_APPROVED_DRIVER = {
    verificationStatus: "APPROVED",
    currentVehicleId: "vehicle-1",
};

const tests = [];
function test(name, fn) {
    tests.push({ name, fn });
}

test("existing approved ride driver keeps ride + parcel access, gains no Buy & Deliver", async () => {
    const context = { vehicle: BIKE, documents: MOTOR_DOCS };

    assert.strictEqual(
        await canReceiveRideRequests(LEGACY_APPROVED_DRIVER, context),
        true
    );
    assert.strictEqual(
        await canReceiveParcelRequests(LEGACY_APPROVED_DRIVER, context),
        true
    );
    assert.strictEqual(
        await canReceiveBuyDeliverRequests(LEGACY_APPROVED_DRIVER, context),
        false
    );
});

test("walking-mode partner is BLOCKED without vehicle verification, eligible with the full set", async () => {
    // Amir correction (2026-10-29): there is no walking/bicycle
    // exemption — vehicle registration + verification is mandatory for
    // Buy & Deliver too. The recorded transport mode changes nothing.
    const walker = {
        verificationStatus: "PENDING",
        currentVehicleId: null,
        services: {
            BUY_DELIVER: {
                status: "APPROVED",
                enabled: true,
                transportMode: "WALKING",
                policyAcknowledgedAt: new Date(),
            },
        },
    };

    // Identity documents only, no vehicle: blocked.
    assert.strictEqual(
        await canReceiveBuyDeliverRequests(walker, {
            vehicle: null,
            documents: IDENTITY_DOCS,
        }),
        false
    );

    // Approved vehicle but licence / registration documents missing:
    // still blocked.
    assert.strictEqual(
        await canReceiveBuyDeliverRequests(walker, {
            vehicle: BIKE,
            documents: IDENTITY_DOCS,
        }),
        false
    );

    // Full document set but no approved vehicle: still blocked.
    assert.strictEqual(
        await canReceiveBuyDeliverRequests(walker, {
            vehicle: null,
            documents: BUY_DELIVER_DOCS,
        }),
        false
    );

    // Full document set + approved vehicle: eligible — and still
    // receives nothing else.
    const fullContext = { vehicle: BIKE, documents: BUY_DELIVER_DOCS };

    assert.strictEqual(
        await canReceiveBuyDeliverRequests(walker, fullContext),
        true
    );
    assert.strictEqual(
        await canReceiveRideRequests(walker, fullContext),
        false
    );
    assert.strictEqual(
        await canReceiveParcelRequests(walker, fullContext),
        false
    );
});

test("bicycle-mode partner is approved independently — with full vehicle verification", async () => {
    const cyclist = {
        verificationStatus: "PENDING",
        currentVehicleId: "vehicle-1",
        services: {
            BUY_DELIVER: {
                status: "APPROVED",
                enabled: true,
                transportMode: "BICYCLE",
                policyAcknowledgedAt: new Date(),
            },
        },
    };

    // Identity documents alone no longer suffice for any mode.
    assert.strictEqual(
        await canReceiveBuyDeliverRequests(cyclist, {
            vehicle: BIKE,
            documents: IDENTITY_DOCS,
        }),
        false
    );

    // Full set + approved vehicle: independently eligible.
    assert.strictEqual(
        await canReceiveBuyDeliverRequests(cyclist, {
            vehicle: BIKE,
            documents: BUY_DELIVER_DOCS,
        }),
        true
    );

    // Missing profile photo still blocks even with everything else.
    const noPhoto = BUY_DELIVER_DOCS.filter(
        (d) => d.documentType !== "PROFILE_PHOTO"
    );

    assert.strictEqual(
        await canReceiveBuyDeliverRequests(cyclist, {
            vehicle: BIKE,
            documents: noPhoto,
        }),
        false
    );
});

test("motorbike partner cannot bypass vehicle checks", async () => {
    const rider = {
        verificationStatus: "PENDING",
        currentVehicleId: "vehicle-1",
        services: {
            BUY_DELIVER: {
                status: "APPROVED",
                enabled: true,
                transportMode: "MOTORBIKE",
                policyAcknowledgedAt: new Date(),
            },
        },
    };

    // No licence / registration documents at all.
    assert.strictEqual(
        await canReceiveBuyDeliverRequests(rider, {
            vehicle: BIKE,
            documents: IDENTITY_DOCS,
        }),
        false
    );

    // Full documents but no approved vehicle.
    assert.strictEqual(
        await canReceiveBuyDeliverRequests(rider, {
            vehicle: null,
            documents: BUY_DELIVER_DOCS,
        }),
        false
    );

    // Full documents but the active vehicle is a car, not a bike.
    assert.strictEqual(
        await canReceiveBuyDeliverRequests(rider, {
            vehicle: CAR,
            documents: BUY_DELIVER_DOCS,
        }),
        false
    );

    // Full documents + matching approved bike = eligible.
    assert.strictEqual(
        await canReceiveBuyDeliverRequests(rider, {
            vehicle: BIKE,
            documents: BUY_DELIVER_DOCS,
        }),
        true
    );
});

test("approving one service never approves another", async () => {
    // Explicit RIDE approval on an otherwise pending driver.
    const rideOnly = {
        verificationStatus: "PENDING",
        currentVehicleId: "vehicle-1",
        services: {
            RIDE: { status: "APPROVED", enabled: true },
        },
    };
    const context = { vehicle: BIKE, documents: MOTOR_DOCS };

    assert.strictEqual(await canReceiveRideRequests(rideOnly, context), true);
    assert.strictEqual(
        await canReceiveParcelRequests(rideOnly, context),
        false
    );
    assert.strictEqual(
        await canReceiveBuyDeliverRequests(rideOnly, context),
        false
    );
});

test("per-service suspension blocks only the suspended service", async () => {
    const driver = {
        ...LEGACY_APPROVED_DRIVER,
        services: {
            RIDE: { status: "SUSPENDED", enabled: true },
        },
    };
    const context = { vehicle: BIKE, documents: MOTOR_DOCS };

    assert.strictEqual(await canReceiveRideRequests(driver, context), false);
    assert.strictEqual(
        await canReceiveParcelRequests(driver, context),
        true
    );
});

test("availability toggle off blocks only that service", async () => {
    const driver = {
        ...LEGACY_APPROVED_DRIVER,
        services: {
            PARCEL: { status: "NOT_APPLIED", enabled: false },
        },
    };
    const context = { vehicle: BIKE, documents: MOTOR_DOCS };

    assert.strictEqual(await canReceiveRideRequests(driver, context), true);
    assert.strictEqual(
        await canReceiveParcelRequests(driver, context),
        false
    );
});

test("Buy & Deliver approval without policy acknowledgment is not eligible", async () => {
    // Full vehicle verification is present here, so the missing policy
    // acknowledgment is the ONLY blocker under test.
    const partner = {
        verificationStatus: "PENDING",
        currentVehicleId: "vehicle-1",
        services: {
            BUY_DELIVER: {
                status: "APPROVED",
                enabled: true,
                transportMode: "WALKING",
                policyAcknowledgedAt: null,
            },
        },
    };

    assert.strictEqual(
        await canReceiveBuyDeliverRequests(partner, {
            vehicle: BIKE,
            documents: BUY_DELIVER_DOCS,
        }),
        false
    );
});

test("Buy & Deliver required-document list is mode-independent and includes vehicle documents", () => {
    assert.deepStrictEqual(getRequiredDocuments("RIDE"), [
        "CNIC_FRONT",
        "CNIC_BACK",
        "DRIVING_LICENSE",
        "VEHICLE_REGISTRATION",
    ]);

    // Amir correction (2026-10-29): EVERY transport mode — walking and
    // bicycle included — requires the same full Buy & Deliver list,
    // licence + vehicle registration mandatory.
    const expectedBuyDeliver = [
        "CNIC_FRONT",
        "CNIC_BACK",
        "PROFILE_PHOTO",
        "DRIVING_LICENSE",
        "VEHICLE_REGISTRATION",
    ];

    for (const mode of ["WALKING", "BICYCLE", "MOTORBIKE", "CAR", null]) {
        assert.deepStrictEqual(
            getRequiredDocuments("BUY_DELIVER", mode),
            expectedBuyDeliver
        );
    }
});

test("global suspension blocks every service", async () => {
    const driver = {
        verificationStatus: "SUSPENDED",
        currentVehicleId: "vehicle-1",
        services: {
            BUY_DELIVER: {
                status: "APPROVED",
                enabled: true,
                transportMode: "WALKING",
                policyAcknowledgedAt: new Date(),
            },
        },
    };
    const context = { vehicle: BIKE, documents: BUY_DELIVER_DOCS };

    assert.strictEqual(await canReceiveRideRequests(driver, context), false);
    assert.strictEqual(
        await canReceiveParcelRequests(driver, context),
        false
    );
    assert.strictEqual(
        await canReceiveBuyDeliverRequests(driver, context),
        false
    );
});

test("global rejection blocks ride/parcel but not an independently approved Buy & Deliver", async () => {
    const driver = {
        verificationStatus: "REJECTED",
        currentVehicleId: "vehicle-1",
        services: {
            BUY_DELIVER: {
                status: "APPROVED",
                enabled: true,
                transportMode: "WALKING",
                policyAcknowledgedAt: new Date(),
            },
        },
    };

    assert.strictEqual(
        await canReceiveRideRequests(driver, {
            vehicle: BIKE,
            documents: MOTOR_DOCS,
        }),
        false
    );
    assert.strictEqual(
        await canReceiveBuyDeliverRequests(driver, {
            vehicle: BIKE,
            documents: BUY_DELIVER_DOCS,
        }),
        true
    );
});

test("expired driving licence blocks a legacy approved driver", async () => {
    const expiredDocs = MOTOR_DOCS.map((d) =>
        d.documentType === "DRIVING_LICENSE"
            ? doc("DRIVING_LICENSE", "APPROVED", PAST)
            : d
    );

    assert.strictEqual(
        await canReceiveRideRequests(LEGACY_APPROVED_DRIVER, {
            vehicle: BIKE,
            documents: expiredDocs,
        }),
        false
    );
});

(async () => {
    let passed = 0;
    const failures = [];

    for (const { name, fn } of tests) {
        try {
            await fn();
            passed += 1;
            console.log(`  PASS  ${name}`);
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
