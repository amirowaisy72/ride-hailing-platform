// Amir-test fix round — RENTALS SEARCH (T-18) + SELF-DRIVE (T-19)
// INTEGRATION TESTS (plain node, no test framework). Boots the REAL
// backend (src/server.js) against a REAL MongoDB replica set and
// mirrors Amir's own test report:
//
//   a LIVE Toyota Corolla (2026), accepting bookings, PKR 8,000/day,
//   pickup area "Model Town Khanpur", partner NOT providing a
//   chauffeur — was invisible to rentals search ("No vehicles
//   match"), and Self-Drive was hard-blocked platform-wide.
//
// Checks:
//   TF-01 unfiltered search finds the live Corolla
//   TF-02 max price 8000 finds it; max price 4000 correctly excludes
//         it (a cap below the daily price is a filter, not a bug)
//   TF-03 near-me search around Khanpur finds it
//   TF-04 valid pickup/return window search finds it
//   TF-05 inverted window (return before pickup) → 400 INVALID_WINDOW
//         (previously silently ignored)
//   TF-06 SELF_DRIVE search finds it with NO settings record field
//         set (T-19 default-on derivation)
//   TF-07 SELF_DRIVE booking end to end → 201 with licence declared
//   TF-08 kill-switch: settings.rentalsSelfDriveEnabled = false →
//         SELF_DRIVE search empty + booking 400 SELF_DRIVE_DISABLED;
//         WITH_DRIVER search/booking unaffected; restore enabled
//
// PREREQUISITE — MongoDB replica set at TEST_MONGODB_URI (default
// mongodb://127.0.0.1:27017/?replicaSet=rs0). Throwaway database
// safar_amir_test_fixes, dropped before/after.
//
// Run:  node tests/integration.amirTestFixes.test.js

const assert = require("node:assert");
const { spawn } = require("node:child_process");
const path = require("node:path");

const BACKEND_DIR = path.join(__dirname, "..");
const RS_BASE =
    process.env.TEST_MONGODB_URI ||
    "mongodb://127.0.0.1:27017/?replicaSet=rs0";
const TEST_DB = "safar_amir_test_fixes";
const PORT = 5724;
const BASE = `http://127.0.0.1:${PORT}/api/v1`;
const JWT_SECRET = ["amir", "test", "fixes", "jwt", "0123456789abcdef"].join("-");

const uriFor = (db) =>
    RS_BASE.replace("/?", `/${db}?`).includes(`/${db}?`)
        ? RS_BASE.replace("/?", `/${db}?`)
        : `${RS_BASE.split("?")[0].replace(/\/?$/, "")}/${db}?${RS_BASE.split("?")[1] || "replicaSet=rs0"}`;

const TEST_URI = uriFor(TEST_DB);

// Model Town, Khanpur (same reference point as the fleet manager UI).
const LAT = 28.6469;
const LNG = 70.6579;
const PASSWORD = "FixTest@1234";

const results = [];
async function check(id, name, fn) {
    try {
        const detail = await fn();
        results.push({ id, name, ok: true });
        console.log(`  PASS  ${id}  ${name}${detail ? ` — ${detail}` : ""}`);
    } catch (error) {
        results.push({ id, name, ok: false });
        console.log(`  FAIL  ${id}  ${name}\n        ${error.message}`);
    }
}

async function api(method, route, { token, body } = {}) {
    const response = await fetch(`${BASE}${route}`, {
        method,
        headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    let json = null;
    try {
        json = await response.json();
    } catch {
        json = null;
    }
    return { status: response.status, json };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let serverProcess = null;
let serverLog = "";

async function waitForServer() {
    for (let i = 0; i < 60; i += 1) {
        try {
            const res = await fetch(`${BASE}/health`);
            if (res.status === 200) return;
        } catch { /* not up yet */ }
        await sleep(500);
    }
    throw new Error(`server did not come up.\n${serverLog.slice(-2000)}`);
}

(async () => {
    const mongoose = require("mongoose");
    const bcrypt = require("bcryptjs");
    const { MongoClient } = require("mongodb");

    console.log("== Section 0: replica set probe ==");
    let helloInfo = null;
    await check("TF-00", "MongoDB replica set reachable and primary", async () => {
        const client = new MongoClient(RS_BASE);
        await client.connect();
        helloInfo = await client.db("admin").command({ hello: 1 });
        await client.close();
        assert.ok(helloInfo.setName, "no replica set name");
        assert.strictEqual(helloInfo.isWritablePrimary, true);
        return `set=${helloInfo.setName}`;
    });
    if (!helloInfo) {
        console.log("\nDatabase unavailable — aborting.");
        process.exit(1);
    }

    console.log("\n== Section 1: backend boot + fixtures ==");
    await mongoose.connect(TEST_URI);
    await mongoose.connection.db.dropDatabase();

    serverProcess = spawn(process.execPath, [path.join(BACKEND_DIR, "src", "server.js")], {
        cwd: BACKEND_DIR,
        env: {
            ...process.env,
            PORT: String(PORT),
            MONGODB_URI: TEST_URI,
            JWT_SECRET,
            NODE_ENV: "test",
        },
        stdio: ["ignore", "pipe", "pipe"],
    });
    serverProcess.stdout.on("data", (d) => { serverLog += d; });
    serverProcess.stderr.on("data", (d) => { serverLog += d; });

    await check("TF-01a", "backend boots and serves /health", async () => {
        await waitForServer();
        return "API up";
    });

    const User = require("../src/models/User");
    const ServiceArea = require("../src/models/ServiceArea");
    const CommissionSettings = require("../src/models/CommissionSettings");
    const RentalPartner = require("../src/models/RentalPartner");

    const passwordHash = await bcrypt.hash(PASSWORD, 10);
    const mkUser = (email, role, activeMode = "PASSENGER") =>
        User.create({
            firstName: "Fix",
            lastName: email.split("@")[0],
            email,
            passwordHash,
            role,
            activeMode,
            emailVerified: true,
            status: "ACTIVE",
        });

    await mkUser("admin@fixtest.test", "ADMIN");
    await mkUser("passenger@fixtest.test", "PASSENGER");
    await mkUser("partner@fixtest.test", "PASSENGER");

    // NOTE: rentalsSelfDriveEnabled deliberately NOT set — T-19 says
    // Self-Drive must work out of the box (schema default true +
    // "not explicitly false" derivation in every reader).
    await CommissionSettings.create({
        key: "GLOBAL",
        percentage: 10,
        isActive: true,
        topUpRequired: false,
        minimumWalletBalance: 0,
        bankName: "Fix Test Bank",
        bankAccountTitle: "Safar Platform",
        bankAccountNumber: "PK00 FIXT 0001",
        bankTransferNote: "Use your booking reference",
        buyDeliverEnabled: true,
        buyDeliverMaxOrderValue: 100000,
        buyDeliverRadiusKm: 15,
        rentalsEnabled: true,
        rentalBookingFeePercent: 5,
        rentalPaymentDeadlineHours: 24,
    });

    await ServiceArea.create({
        name: "Khanpur Test Area",
        city: "Khanpur",
        active: true,
        polygon: {
            type: "Polygon",
            coordinates: [[
                [LNG - 0.11, LAT - 0.10],
                [LNG + 0.11, LAT - 0.10],
                [LNG + 0.11, LAT + 0.10],
                [LNG - 0.11, LAT + 0.10],
                [LNG - 0.11, LAT - 0.10],
            ]],
        },
    });

    const tokens = {};
    for (const [key, email] of Object.entries({
        admin: "admin@fixtest.test",
        passenger: "passenger@fixtest.test",
        partner: "partner@fixtest.test",
    })) {
        const res = await api("POST", "/auth/login", { body: { email, password: PASSWORD } });
        assert.strictEqual(res.status, 200, `login ${email}: ${JSON.stringify(res.json)}`);
        tokens[key] = res.json.accessToken;
    }

    // Partner (no chauffeur) + business approval.
    const apply = await api("POST", "/rental-partners/apply", {
        token: tokens.partner,
        body: { businessName: "Model Town Rentals", providesChauffeur: false },
    });
    assert.strictEqual(apply.status, 200, JSON.stringify(apply.json));
    const partnerId = String(apply.json.rentalPartner._id || apply.json.rentalPartner.id);

    // Business approval at fixture level: the admin status endpoint
    // requires reviewed KYC documents — that flow is proven end to
    // end by integration.chauffeur.test.js; this suite's subject is
    // search + booking, so the fixture approves the record directly.
    await RentalPartner.updateOne(
        { _id: partnerId },
        { $set: { applicationStatus: "APPROVED" } }
    );

    // The Corolla from Amir's report: 2026, Live, PKR 8,000/day,
    // Model Town Khanpur, both modes offered.
    const created = await api("POST", "/rentals/vehicles", {
        token: tokens.partner,
        body: {
            brand: "Toyota",
            model: "Corolla",
            year: 2026,
            registrationNumber: "TF-2026",
            transmission: "AUTOMATIC",
            seats: 5,
            hasAC: true,
            rentalModes: ["SELF_DRIVE", "WITH_DRIVER"],
            photos: { exterior: ["https://example.com/corolla.jpg"], interior: [], condition: [] },
            pricing: { daily: 8000, hourly: null, weekly: null, monthly: null },
            mileageLimitKmPerDay: 200,
            extraKmFee: 50,
            overtimeFeePerHour: 500,
            securityDeposit: 20000,
            cancellationPolicy: "MODERATE",
            pickupArea: { latitude: LAT, longitude: LNG, address: "Model Town, Khanpur" },
            pickupAreaLabel: "Model Town Khanpur",
            exactPickupAddress: "House 1, Model Town, Khanpur",
            pickupContactName: "Model Town Rentals",
            pickupContactPhone: "03001234567",
            fuelPolicy: "Return with the same fuel level",
            insuranceNote: "Comprehensive cover",
            tollsNote: "Renter pays tolls",
        },
    });
    assert.strictEqual(created.status, 201, JSON.stringify(created.json));
    const vehicleId = String(created.json.vehicle.id || created.json.vehicle._id);

    const agreement = await api("POST", "/rentals/agreement/accept", { token: tokens.partner, body: {} });
    assert.strictEqual(agreement.status, 200, JSON.stringify(agreement.json));

    const moderate = await api("PATCH", `/admin/rentals/vehicles/${vehicleId}/moderate`, {
        token: tokens.admin,
        body: { status: "APPROVED" },
    });
    assert.strictEqual(moderate.status, 200, JSON.stringify(moderate.json));
    assert.strictEqual(moderate.json.vehicle.listingStatus, "APPROVED");

    const containsCorolla = (res) =>
        (res.json.vehicles || []).some((v) => String(v.id || v._id) === vehicleId);
    const search = (qs) => api("GET", `/rentals/search${qs}`, { token: tokens.passenger });

    console.log("\n== Section 2: T-18 — the live Corolla must be findable ==");

    await check("TF-01", "unfiltered search finds the live Corolla", async () => {
        const res = await search("");
        assert.strictEqual(res.status, 200, JSON.stringify(res.json));
        assert.ok(containsCorolla(res), "Corolla missing from unfiltered search");
    });

    await check("TF-02", "max price at the daily price (8000) finds it; 4000 excludes it by design", async () => {
        const at = await search("?maxDailyPrice=8000");
        assert.ok(containsCorolla(at), "Corolla missing at maxDailyPrice=8000");
        const below = await search("?maxDailyPrice=4000");
        assert.ok(!containsCorolla(below), "Corolla should be filtered out at maxDailyPrice=4000");
        return "cap respected both ways";
    });

    await check("TF-03", "near-me search around Khanpur finds it", async () => {
        const res = await search(`?latitude=${LAT}&longitude=${LNG}&radiusKm=50`);
        assert.strictEqual(res.status, 200, JSON.stringify(res.json));
        assert.ok(containsCorolla(res), "Corolla missing from near-me search");
    });

    const start = new Date(Date.now() + 26 * 60 * 60 * 1000);
    const end = new Date(start.getTime() + 48 * 60 * 60 * 1000);

    await check("TF-04", "valid pickup/return window search finds it", async () => {
        const res = await search(`?startAt=${start.toISOString()}&endAt=${end.toISOString()}`);
        assert.strictEqual(res.status, 200, JSON.stringify(res.json));
        assert.ok(containsCorolla(res), "Corolla missing for a valid window");
    });

    await check("TF-05", "inverted window is rejected 400 INVALID_WINDOW (was silently ignored)", async () => {
        const res = await search(`?startAt=${end.toISOString()}&endAt=${start.toISOString()}`);
        assert.strictEqual(res.status, 400, JSON.stringify(res.json));
        assert.strictEqual(res.json.code, "INVALID_WINDOW");
    });

    console.log("\n== Section 3: T-19 — Self-Drive enabled end to end ==");

    await check("TF-06", "SELF_DRIVE search finds the Corolla with no flag set anywhere", async () => {
        const res = await search("?mode=SELF_DRIVE");
        assert.strictEqual(res.status, 200, JSON.stringify(res.json));
        assert.ok(containsCorolla(res), "Corolla missing from SELF_DRIVE search");
    });

    const licence = {
        number: "RYK-2026-7788",
        expiryDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
    };

    await check("TF-07", "SELF_DRIVE booking succeeds end to end (201) with declared licence", async () => {
        const res = await api("POST", "/rentals/bookings", {
            token: tokens.passenger,
            body: {
                vehicleId,
                mode: "SELF_DRIVE",
                startAt: start,
                endAt: end,
                billingUnit: "DAILY",
                renterLicence: licence,
            },
        });
        assert.strictEqual(res.status, 201, JSON.stringify(res.json));
        return `booking ${res.json.booking?._id || res.json.booking?.id || ""} created`;
    });

    await check("TF-08", "kill-switch: explicit false disables Self-Drive only; With Driver unaffected; restore", async () => {
        await CommissionSettings.updateOne(
            { key: "GLOBAL" },
            { $set: { rentalsSelfDriveEnabled: false } }
        );
        const sdSearch = await search("?mode=SELF_DRIVE");
        assert.ok(!containsCorolla(sdSearch), "SELF_DRIVE search must be empty while kill-switch is off");

        const laterStart = new Date(end.getTime() + 24 * 60 * 60 * 1000);
        const laterEnd = new Date(laterStart.getTime() + 24 * 60 * 60 * 1000);
        const sdBook = await api("POST", "/rentals/bookings", {
            token: tokens.passenger,
            body: {
                vehicleId,
                mode: "SELF_DRIVE",
                startAt: laterStart,
                endAt: laterEnd,
                billingUnit: "DAILY",
                renterLicence: licence,
            },
        });
        assert.strictEqual(sdBook.status, 400, JSON.stringify(sdBook.json));
        assert.strictEqual(sdBook.json.code, "SELF_DRIVE_DISABLED");

        const wdSearch = await search("?mode=WITH_DRIVER");
        assert.ok(containsCorolla(wdSearch), "WITH_DRIVER search must be unaffected by the kill-switch");

        await CommissionSettings.updateOne(
            { key: "GLOBAL" },
            { $set: { rentalsSelfDriveEnabled: true } }
        );
        const restored = await search("?mode=SELF_DRIVE");
        assert.ok(containsCorolla(restored), "SELF_DRIVE search must work again after restore");
        return "kill-switch verified both ways";
    });

    console.log("\n== Cleanup ==");
    try {
        await mongoose.connection.db.dropDatabase();
    } catch { /* best effort */ }
    await mongoose.disconnect().catch(() => {});
    if (serverProcess) serverProcess.kill("SIGTERM");

    const failed = results.filter((r) => !r.ok);
    console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
    process.exit(failed.length ? 1 : 0);
})().catch(async (error) => {
    console.error("SUITE ERROR:", error);
    if (serverProcess) serverProcess.kill("SIGTERM");
    process.exit(1);
});
