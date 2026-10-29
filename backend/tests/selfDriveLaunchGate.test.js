// Phase 8 — Self-Drive LAUNCH GATE tests (plain node, no framework,
// no DB).
//
// Safar Rentals launches WITH DRIVER first. Self-Drive may only be
// enabled after DOCUMENT-LEVEL renter licence verification exists
// (a real upload + admin review of the renter's driving licence).
// That verification does NOT exist in this codebase today: the renter
// licence on a booking is a self-declared number + expiry stored on
// the booking record and never checked against any document.
//
// These tests pin the strongest honest guard the codebase supports:
//   1. rentalsSelfDriveEnabled defaults to FALSE in the settings
//      schema (a fresh install can never come up self-drive-live).
//   2. While the flag is off, the REAL booking rule rejects every
//      SELF_DRIVE request with SELF_DRIVE_DISABLED — even one
//      carrying a plausible declared licence.
//   3. The RentalBooking schema carries ONLY the declaration fields
//      for the renter licence (number / expiryDate) — there is no
//      verification status, document reference or reviewer field,
//      i.e. no hidden verification path exists to lean on.
//   4. With the flag hypothetically on, the ONLY licence check that
//      exists is the declaration check (non-empty number + unexpired
//      date). This is asserted deliberately: it documents exactly
//      what stands between an admin flipping the flag and launch —
//      the launch-gate note in COMBINED_PLAN.md (Phase 8) makes
//      enabling the flag conditional on building real verification.
//
// Run:  node tests/selfDriveLaunchGate.test.js
// Exit code 0 = gate holds, 1 = gate weakened.

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

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

test("settings schema defaults rentalsSelfDriveEnabled to false", () => {
    const pathDef = CommissionSettings.schema.path("rentalsSelfDriveEnabled");

    assert.ok(pathDef, "rentalsSelfDriveEnabled must exist on CommissionSettings");
    assert.strictEqual(
        pathDef.defaultValue,
        false,
        "self-drive must be OFF by default — a fresh deployment must never come up with self-drive live"
    );
});

test("SELF_DRIVE booking is rejected while the flag is off, even with a declared licence", () => {
    const result = evaluateModeEligibility({
        vehicle: VEHICLE_BOTH_MODES,
        mode: "SELF_DRIVE",
        selfDriveEnabled: false,
        renterLicence: VALID_DECLARED_LICENCE,
    });

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.code, "SELF_DRIVE_DISABLED");
});

test("SELF_DRIVE booking is rejected when the flag is simply absent (undefined)", () => {
    const result = evaluateModeEligibility({
        vehicle: VEHICLE_BOTH_MODES,
        mode: "SELF_DRIVE",
        renterLicence: VALID_DECLARED_LICENCE,
    });

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.code, "SELF_DRIVE_DISABLED");
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

test("RentalBooking stores ONLY a licence declaration — no verification fields exist", () => {
    const licencePaths = Object.keys(RentalBooking.schema.paths).filter((p) =>
        /licen[cs]e/i.test(p)
    );

    assert.deepStrictEqual(
        licencePaths.sort(),
        ["renterLicence.expiryDate", "renterLicence.number"],
        `expected only the two declaration paths, found: ${licencePaths.join(", ")}`
    );

    const verificationLike = licencePaths.filter((p) =>
        /verif|status|document|review|image|url/i.test(p)
    );

    assert.deepStrictEqual(
        verificationLike,
        [],
        "no renter-licence verification field may exist until the real verification flow is built"
    );
});

test("no model in the codebase defines a renter licence document/verification record", () => {
    const modelsDir = path.join(__dirname, "..", "src", "models");
    const offenders = fs
        .readdirSync(modelsDir)
        .filter((file) => file.endsWith(".js"))
        .filter((file) => {
            const source = fs.readFileSync(path.join(modelsDir, file), "utf8");
            return /RenterLicence|RenterLicense|LicenceDocument|LicenseDocument/.test(
                source
            );
        });

    assert.deepStrictEqual(
        offenders,
        [],
        "a renter licence verification model appearing in the codebase must be accompanied by the full verification flow + updated launch-gate tests"
    );
});

test("IF the flag were on, only the declaration check would run (documented launch risk)", () => {
    const expired = evaluateModeEligibility({
        vehicle: VEHICLE_BOTH_MODES,
        mode: "SELF_DRIVE",
        selfDriveEnabled: true,
        renterLicence: {
            number: "LHR-2026-0042",
            expiryDate: new Date(Date.now() - 24 * 60 * 60 * 1000),
        },
    });

    assert.strictEqual(expired.ok, false, "expired declared licence is rejected");

    const declared = evaluateModeEligibility({
        vehicle: VEHICLE_BOTH_MODES,
        mode: "SELF_DRIVE",
        selfDriveEnabled: true,
        renterLicence: VALID_DECLARED_LICENCE,
    });

    assert.strictEqual(
        declared.ok,
        true,
        "with the flag on, a self-declared licence number + future date is sufficient — this is precisely why the launch gate forbids enabling it before document verification exists"
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
