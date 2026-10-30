// Self-Drive launch state tests (plain node, no framework, no DB).
//
// HISTORY: this file began as the Phase 8 LAUNCH GATE — Self-Drive
// stayed OFF until document-level renter licence verification
// existed. In the Amir-test fix round (T-19) Amir superseded that
// gate by decision: Self-Drive is ENABLED and fully functional end
// to end, on the listing's own terms, with the renter's licence
// taken as the booking-flow declaration (number + expiry).
//
// What these tests now pin:
//   1. rentalsSelfDriveEnabled defaults to TRUE in the settings
//      schema (Self-Drive is live by default).
//   2. The settings flag survives ONLY as an admin kill-switch:
//      an explicit false still rejects SELF_DRIVE bookings with
//      SELF_DRIVE_DISABLED. Every controller derives the flag as
//      "not explicitly false" (search, vehicle details, booking
//      creation, admin settings read).
//   3. With Self-Drive enabled, the booking rule requires the
//      declared licence (non-empty number + unexpired expiry) and
//      accepts a valid declaration; WITH_DRIVER is unaffected.
//   4. The RentalBooking schema carries the declaration fields
//      (renterLicence.number / .expiryDate) — documented as the
//      licence step of the flow.
//
// Run:  node tests/selfDriveLaunchGate.test.js
// Exit code 0 = launch state as decided, 1 = regression.

const assert = require("node:assert");

const CommissionSettings = require("../src/models/CommissionSettings");
const RentalBooking = require("../src/models/RentalBooking");
const {
    evaluateModeEligibility,
} = require("../src/services/rentalBookingService");

const tests = [];
function test(name, fn) {
    tests.push({ name, fn });
}

const VEHICLE_BOTH_MODES = {
    rentalModes: ["SELF_DRIVE", "WITH_DRIVER"],
};

const VALID_DECLARED_LICENCE = {
    number: "LHR-2026-0042",
    expiryDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
};

test("settings schema defaults rentalsSelfDriveEnabled to true (T-19: Self-Drive enabled)", () => {
    const pathDef = CommissionSettings.schema.path("rentalsSelfDriveEnabled");

    assert.ok(pathDef, "rentalsSelfDriveEnabled must exist on CommissionSettings");
    assert.strictEqual(
        pathDef.defaultValue,
        true,
        "self-drive must be ON by default — Amir enabled it end to end (T-19)"
    );
});

test("kill-switch: SELF_DRIVE booking is rejected when an admin has explicitly disabled it", () => {
    const result = evaluateModeEligibility({
        vehicle: VEHICLE_BOTH_MODES,
        mode: "SELF_DRIVE",
        selfDriveEnabled: false,
        renterLicence: VALID_DECLARED_LICENCE,
    });

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.code, "SELF_DRIVE_DISABLED");
});

test("SELF_DRIVE booking succeeds when enabled with a valid declared licence", () => {
    const result = evaluateModeEligibility({
        vehicle: VEHICLE_BOTH_MODES,
        mode: "SELF_DRIVE",
        selfDriveEnabled: true,
        renterLicence: VALID_DECLARED_LICENCE,
    });

    assert.strictEqual(result.ok, true);
});

test("SELF_DRIVE still requires the licence declaration (number + unexpired expiry)", () => {
    const missing = evaluateModeEligibility({
        vehicle: VEHICLE_BOTH_MODES,
        mode: "SELF_DRIVE",
        selfDriveEnabled: true,
        renterLicence: null,
    });
    assert.strictEqual(missing.ok, false);
    assert.strictEqual(missing.code, "LICENCE_REQUIRED");

    const expired = evaluateModeEligibility({
        vehicle: VEHICLE_BOTH_MODES,
        mode: "SELF_DRIVE",
        selfDriveEnabled: true,
        renterLicence: {
            number: "LHR-2026-0042",
            expiryDate: new Date(Date.now() - 24 * 60 * 60 * 1000),
        },
    });
    assert.strictEqual(expired.ok, false);
    assert.strictEqual(expired.code, "LICENCE_REQUIRED");
});

test("WITH_DRIVER is unaffected by the self-drive flag", () => {
    const result = evaluateModeEligibility({
        vehicle: VEHICLE_BOTH_MODES,
        mode: "WITH_DRIVER",
        selfDriveEnabled: false,
        renterLicence: null,
    });

    assert.strictEqual(result.ok, true);
});

test("RentalBooking stores the renter licence declaration fields", () => {
    const licencePaths = Object.keys(RentalBooking.schema.paths).filter((p) =>
        /licen[cs]e/i.test(p)
    );

    assert.deepStrictEqual(
        licencePaths.sort(),
        ["renterLicence.expiryDate", "renterLicence.number"],
        `expected the two declaration paths, found: ${licencePaths.join(", ")}`
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
            console.log(`  FAIL  ${name}\n        ${error.message}`);
        }
    }

    console.log(`\n${passed}/${tests.length} tests passed`);

    if (failures.length) {
        process.exitCode = 1;
    }
})();
