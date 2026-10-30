// Phase 2 / Amir review A16 — CHAUFFEUR VERIFICATION INTEGRATION TESTS
// (plain node, no test framework). Boots the REAL backend (src/server.js)
// as a child process against a REAL MongoDB replica set and drives the
// chauffeur verification flow over HTTP:
//
//   partner declares chauffeur (providesChauffeur: true, unverified)
//     → With-Driver booking refused 409 CHAUFFEUR_NOT_VERIFIED
//     → admin verifies via the REAL new endpoint
//       PATCH /api/v1/admin/rental-partners/:id/chauffeur
//     → the same booking now succeeds (the gate passes)
//
// Also covered: verify without a licence number → 400; non-admin caller
// → 403; anonymous caller → 401; unknown partner → 404; partner-side
// declaration endpoint PATCH /rental-partners/me/chauffeur (incl. past
// licence expiry → 400); unverify (→ PENDING) re-blocks bookings; the
// transition rules (SUSPENDED can never jump straight to APPROVED;
// REJECTED requires a reason).
//
// This suite exists because Phase 8's INT-33 recorded the finding that
// NO shipped code path could move chauffeurVerificationStatus to
// APPROVED, so a partner who declared a chauffeur could never take a
// With-Driver booking. A16 is the fix; this suite is its proof.
//
// PREREQUISITE — a MongoDB replica set reachable at TEST_MONGODB_URI
// (default mongodb://127.0.0.1:27017/?replicaSet=rs0), same as
// integration.phase8.test.js. Uses one THROWAWAY database
// (safar_p2_chauffeur_test), dropped before/after; touches nothing else.
//
// Run:  node tests/integration.chauffeur.test.js
// Exit code 0 = every check passed, 1 = at least one failure.

const assert = require("node:assert");
const { spawn } = require("node:child_process");
const path = require("node:path");

const BACKEND_DIR = path.join(__dirname, "..");
const RS_BASE =
    process.env.TEST_MONGODB_URI ||
    "mongodb://127.0.0.1:27017/?replicaSet=rs0";
const TEST_DB = "safar_p2_chauffeur_test";
const PORT = 5723;
const BASE = `http://127.0.0.1:${PORT}/api/v1`;
const JWT_SECRET = ["chauffeur", "integration", "test", "key"].join("-");

const uriFor = (db) =>
    RS_BASE.replace("/?", `/${db}?`).includes(`/${db}?`)
        ? RS_BASE.replace("/?", `/${db}?`)
        : `${RS_BASE.split("?")[0].replace(/\/?$/, "")}/${db}?${RS_BASE.split("?")[1] || "replicaSet=rs0"}`;

const TEST_URI = uriFor(TEST_DB);

const results = [];
async function check(id, name, fn) {
    try {
        const detail = await fn();
        results.push({ id, name, ok: true, detail: detail || "" });
        console.log(`  PASS  ${id}  ${name}${detail ? ` — ${detail}` : ""}`);
    } catch (error) {
        results.push({ id, name, ok: false, detail: error.message });
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

const LAT = 28.6469;
const LNG = 70.6579;
const PASSWORD = "Chauffeur!pass1";

let mongoose;
let serverProcess = null;
let serverLog = "";

async function waitForServer(timeoutMs = 90000) {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
        if (serverProcess.exitCode !== null) {
            throw new Error(
                `backend exited early (code ${serverProcess.exitCode}). Log tail:\n${serverLog.slice(-2000)}`
            );
        }

        try {
            const res = await fetch(`${BASE}/health`);
            if (res.status === 200) return;
        } catch {
            // not up yet
        }

        await new Promise((r) => setTimeout(r, 500));
    }

    throw new Error(
        `backend did not become healthy in ${timeoutMs}ms. Log tail:\n${serverLog.slice(-2000)}`
    );
}

(async () => {
    mongoose = require("mongoose");
    const bcrypt = require("bcryptjs");
    const { MongoClient } = require("mongodb");

    // -----------------------------------------------------------------
    // Section 0 — the database really is a replica set
    // -----------------------------------------------------------------
    console.log("\n== Section 0: replica-set database ==");

    let helloInfo = null;
    await check("CH-00", "MongoDB reachable and is a replica set", async () => {
        const client = new MongoClient(RS_BASE);
        await client.connect();
        helloInfo = await client.db("admin").command({ hello: 1 });
        await client.close();

        assert.ok(helloInfo.setName, "no replica set name — a standalone mongod does not satisfy this suite");
        assert.strictEqual(helloInfo.isWritablePrimary, true);
        return `set=${helloInfo.setName}, primary=true`;
    });

    if (!helloInfo) {
        console.log("\nDatabase unavailable — aborting (nothing else can run).");
        process.exit(1);
    }

    // -----------------------------------------------------------------
    // Section 1 — boot the real backend + fixtures + logins
    // -----------------------------------------------------------------
    console.log("\n== Section 1: backend boot + fixtures + login ==");

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

    await check("CH-01", "backend boots against the replica set and serves /health", async () => {
        await waitForServer();
        const res = await fetch(`${BASE}/health`);
        assert.strictEqual(res.status, 200);
        return "API + Socket.IO up";
    });

    const User = require("../src/models/User");
    const ServiceArea = require("../src/models/ServiceArea");
    const CommissionSettings = require("../src/models/CommissionSettings");
    const RentalPartner = require("../src/models/RentalPartner");
    const RentalPartnerDocument = require("../src/models/RentalPartnerDocument");

    const passwordHash = await bcrypt.hash(PASSWORD, 10);
    const mkUser = (email, role, activeMode = "PASSENGER") =>
        User.create({
            firstName: "Chauffeur",
            lastName: email.split("@")[0],
            email,
            passwordHash,
            role,
            activeMode,
            emailVerified: true,
            status: "ACTIVE",
        });

    const adminUser = await mkUser("admin@chauffeur.test", "ADMIN");
    await mkUser("passenger@chauffeur.test", "PASSENGER");
    const partnerUser = await mkUser("partner@chauffeur.test", "PASSENGER");

    await CommissionSettings.create({
        key: "GLOBAL",
        percentage: 10,
        isActive: true,
        topUpRequired: false,
        minimumWalletBalance: 0,
        bankName: "Chauffeur Test Bank",
        bankAccountTitle: "Safar Platform",
        bankAccountNumber: "PK00 CHAU 0001",
        bankTransferNote: "Use your booking reference",
        buyDeliverEnabled: true,
        buyDeliverMaxOrderValue: 100000,
        buyDeliverRadiusKm: 15,
        rentalsEnabled: true,
        rentalBookingFeePercent: 5,
        rentalsSelfDriveEnabled: false,
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
    await check("CH-02", "fixture users can log in through the real auth API", async () => {
        for (const [key, email] of Object.entries({
            admin: "admin@chauffeur.test",
            passenger: "passenger@chauffeur.test",
            partner: "partner@chauffeur.test",
        })) {
            const res = await api("POST", "/auth/login", { body: { email, password: PASSWORD } });
            assert.strictEqual(res.status, 200, `login ${email}: HTTP ${res.status} ${JSON.stringify(res.json)}`);
            assert.ok(res.json.accessToken, `login ${email}: no access token`);
            tokens[key] = res.json.accessToken;
        }
        return "3/3 logins issued JWTs";
    });

    const futureDate = (days) => new Date(Date.now() + days * 24 * 60 * 60 * 1000);

    // -----------------------------------------------------------------
    // Section 2 — partner declares a chauffeur; nobody can approve yet
    // -----------------------------------------------------------------
    console.log("\n== Section 2: declaration + the pre-fix dead end ==");

    let rentalPartner = null;

    await check("CH-03", "partner applies with providesChauffeur: true — chauffeur PENDING, no licence on file", async () => {
        const apply = await api("POST", "/rental-partners/apply", {
            token: tokens.partner,
            body: { businessName: "Chauffeur Test Rentals", providesChauffeur: true },
        });
        assert.strictEqual(apply.status, 200, JSON.stringify(apply.json));
        assert.strictEqual(apply.json.rentalPartner.providesChauffeur, true);
        assert.strictEqual(apply.json.rentalPartner.chauffeurVerificationStatus, "PENDING");

        rentalPartner = await RentalPartner.findOne({ userId: partnerUser._id });
        assert.ok(rentalPartner);
        assert.strictEqual(rentalPartner.chauffeurLicenceNumber, null);
        return "providesChauffeur=true, status PENDING, licence null";
    });

    await check("CH-04", "admin verify WITHOUT a licence number on file → 400, status unchanged", async () => {
        const res = await api("PATCH", `/admin/rental-partners/${rentalPartner._id}/chauffeur`, {
            token: tokens.admin,
            body: { status: "APPROVED" },
        });
        assert.strictEqual(res.status, 400, JSON.stringify(res.json));
        assert.match(res.json.message, /licence number/i);

        const fresh = await RentalPartner.findById(rentalPartner._id);
        assert.strictEqual(fresh.chauffeurVerificationStatus, "PENDING");
        assert.strictEqual(fresh.chauffeurVerifiedAt, null);
        return "400 licence-required; nothing saved";
    });

    await check("CH-05", "chauffeur endpoint guards: non-admin → 403, anonymous → 401, unknown partner → 404", async () => {
        const asPassenger = await api("PATCH", `/admin/rental-partners/${rentalPartner._id}/chauffeur`, {
            token: tokens.passenger,
            body: { status: "APPROVED" },
        });
        assert.strictEqual(asPassenger.status, 403, JSON.stringify(asPassenger.json));

        const anonymous = await api("PATCH", `/admin/rental-partners/${rentalPartner._id}/chauffeur`, {
            body: { status: "APPROVED" },
        });
        assert.strictEqual(anonymous.status, 401, JSON.stringify(anonymous.json));

        const missing = await api("PATCH", "/admin/rental-partners/000000000000000000000000/chauffeur", {
            token: tokens.admin,
            body: { status: "APPROVED" },
        });
        assert.strictEqual(missing.status, 404, JSON.stringify(missing.json));
        return "403 / 401 / 404 as expected";
    });

    await check("CH-06", "partner declares chauffeur details via PATCH /rental-partners/me/chauffeur", async () => {
        const past = await api("PATCH", "/rental-partners/me/chauffeur", {
            token: tokens.partner,
            body: {
                chauffeurName: "Muhammad Akram",
                chauffeurLicenceNumber: "RYK-2026-7788",
                chauffeurLicenceExpiry: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
            },
        });
        assert.strictEqual(past.status, 400, JSON.stringify(past.json));

        const res = await api("PATCH", "/rental-partners/me/chauffeur", {
            token: tokens.partner,
            body: {
                chauffeurName: "Muhammad Akram",
                chauffeurLicenceNumber: "RYK-2026-7788",
                chauffeurLicenceExpiry: futureDate(365).toISOString(),
            },
        });
        assert.strictEqual(res.status, 200, JSON.stringify(res.json));
        assert.strictEqual(res.json.rentalPartner.chauffeurName, "Muhammad Akram");
        assert.strictEqual(res.json.rentalPartner.chauffeurLicenceNumber, "RYK-2026-7788");
        assert.strictEqual(res.json.rentalPartner.chauffeurVerificationStatus, "PENDING");

        const fresh = await RentalPartner.findById(rentalPartner._id);
        assert.strictEqual(fresh.chauffeurLicenceNumber, "RYK-2026-7788");
        assert.ok(fresh.chauffeurLicenceExpiry > new Date(), "licence expiry stored in the future");
        return "past expiry 400; valid declaration stored, still PENDING review";
    });

    // -----------------------------------------------------------------
    // Section 3 — partner approval + an APPROVED With-Driver listing
    // -----------------------------------------------------------------
    console.log("\n== Section 3: partner KYC approval + listing ==");

    let vehicleId = null;

    await check("CH-07", "rental partner onboarding completes: KYC documents → admin application approval", async () => {
        await RentalPartnerDocument.insertMany(
            ["CNIC_FRONT", "CNIC_BACK", "PROFILE_PHOTO", "DRIVING_LICENSE"].map((documentType) => ({
                rentalPartnerId: rentalPartner._id,
                documentType,
                imageUrl: `https://example.com/kyc/${documentType}.jpg`,
                cloudinaryPublicId: `chauffeur/kyc/${documentType}`,
                verificationStatus: "APPROVED",
                expiryDate: futureDate(365),
            }))
        );

        const apply2 = await api("POST", "/rental-partners/apply", {
            token: tokens.partner,
            body: { businessName: "Chauffeur Test Rentals", providesChauffeur: true },
        });
        assert.strictEqual(apply2.json.rentalPartner.applicationStatus, "PENDING");

        const approve = await api("PATCH", `/admin/rental-partners/${rentalPartner._id}/status`, {
            token: tokens.admin,
            body: { status: "APPROVED" },
        });
        assert.strictEqual(approve.status, 200, JSON.stringify(approve.json));
        return "business KYC APPROVED (chauffeur still separately PENDING)";
    });

    await check("CH-08", "With-Driver listing created, agreement accepted, moderation APPROVED", async () => {
        const created = await api("POST", "/rentals/vehicles", {
            token: tokens.partner,
            body: {
                brand: "Toyota",
                model: "Corolla",
                year: 2022,
                registrationNumber: "CH-1001",
                transmission: "AUTOMATIC",
                seats: 5,
                hasAC: true,
                rentalModes: ["WITH_DRIVER"],
                photos: { exterior: ["https://example.com/car-ext.jpg"], interior: [], condition: [] },
                pricing: { daily: 8000, hourly: null, weekly: null, monthly: null },
                mileageLimitKmPerDay: 200,
                extraKmFee: 50,
                overtimeFeePerHour: 500,
                securityDeposit: 20000,
                cancellationPolicy: "MODERATE",
                pickupArea: { latitude: LAT, longitude: LNG, address: "Main Bazaar, Khanpur" },
                pickupAreaLabel: "Main Bazaar, Khanpur",
                exactPickupAddress: "House 12-B, Street 3, Mohalla Test, Khanpur",
                pickupContactName: "Chauffeur Test Rentals",
                pickupContactPhone: "03001234567",
                fuelPolicy: "Return with the same fuel level",
                insuranceNote: "Comprehensive cover",
                tollsNote: "Renter pays tolls",
            },
        });
        assert.strictEqual(created.status, 201, JSON.stringify(created.json));
        vehicleId = String(created.json.vehicle.id || created.json.vehicle._id);

        const accept = await api("POST", "/rentals/agreement/accept", { token: tokens.partner, body: {} });
        assert.strictEqual(accept.status, 200, JSON.stringify(accept.json));

        const moderate = await api("PATCH", `/admin/rentals/vehicles/${vehicleId}/moderate`, {
            token: tokens.admin,
            body: { status: "APPROVED" },
        });
        assert.strictEqual(moderate.status, 200, JSON.stringify(moderate.json));
        assert.strictEqual(moderate.json.vehicle.listingStatus, "APPROVED");
        return "listing APPROVED and bookable in principle";
    });

    // -----------------------------------------------------------------
    // Section 4 — THE GATE: blocked → verified → passes
    // -----------------------------------------------------------------
    console.log("\n== Section 4: the CHAUFFEUR_NOT_VERIFIED gate, before and after ==");

    const rentalStart = new Date(Date.now() + 26 * 60 * 60 * 1000);
    const rentalEnd = new Date(rentalStart.getTime() + 48 * 60 * 60 * 1000);
    const bookWithDriver = () =>
        api("POST", "/rentals/bookings", {
            token: tokens.passenger,
            body: { vehicleId, mode: "WITH_DRIVER", startAt: rentalStart, endAt: rentalEnd, billingUnit: "DAILY" },
        });

    await check("CH-09", "unverified chauffeur: With-Driver booking → 409 CHAUFFEUR_NOT_VERIFIED", async () => {
        const res = await bookWithDriver();
        assert.strictEqual(res.status, 409, JSON.stringify(res.json));
        assert.strictEqual(res.json.code, "CHAUFFEUR_NOT_VERIFIED");
        return "gate blocks exactly as the booking service specifies";
    });

    await check("CH-10", "admin verifies the chauffeur via the REAL endpoint → APPROVED with verifiedBy/At recorded", async () => {
        const res = await api("PATCH", `/admin/rental-partners/${rentalPartner._id}/chauffeur`, {
            token: tokens.admin,
            body: { status: "APPROVED" },
        });
        assert.strictEqual(res.status, 200, JSON.stringify(res.json));
        assert.strictEqual(res.json.rentalPartner.chauffeurVerificationStatus, "APPROVED");
        assert.strictEqual(String(res.json.rentalPartner.chauffeurVerifiedBy), String(adminUser._id));
        assert.ok(res.json.rentalPartner.chauffeurVerifiedAt, "chauffeurVerifiedAt must be set");

        const fresh = await RentalPartner.findById(rentalPartner._id);
        assert.strictEqual(fresh.chauffeurVerificationStatus, "APPROVED");
        assert.strictEqual(String(fresh.chauffeurVerifiedBy), String(adminUser._id));
        return "APPROVED persisted with admin attribution";
    });

    await check("CH-11", "after verification the same With-Driver booking succeeds — the gate passes", async () => {
        const res = await bookWithDriver();
        assert.strictEqual(res.status, 201, JSON.stringify(res.json));
        assert.strictEqual(res.json.booking.status, "REQUESTED");
        assert.strictEqual(res.json.booking.mode, "WITH_DRIVER");
        return "201 REQUESTED — CHAUFFEUR_NOT_VERIFIED no longer raised";
    });

    await check("CH-12", "unverify (→ PENDING) clears attribution and re-blocks With-Driver bookings", async () => {
        const res = await api("PATCH", `/admin/rental-partners/${rentalPartner._id}/chauffeur`, {
            token: tokens.admin,
            body: { status: "PENDING" },
        });
        assert.strictEqual(res.status, 200, JSON.stringify(res.json));
        assert.strictEqual(res.json.rentalPartner.chauffeurVerificationStatus, "PENDING");
        assert.strictEqual(res.json.rentalPartner.chauffeurVerifiedBy, null);
        assert.strictEqual(res.json.rentalPartner.chauffeurVerifiedAt, null);

        const blocked = await bookWithDriver();
        assert.strictEqual(blocked.status, 409, JSON.stringify(blocked.json));
        assert.strictEqual(blocked.json.code, "CHAUFFEUR_NOT_VERIFIED");
        return "PENDING re-blocks with 409 CHAUFFEUR_NOT_VERIFIED";
    });

    await check("CH-13", "transition rules: no PENDING→SUSPENDED, no SUSPENDED→APPROVED shortcut; review path restores booking", async () => {
        const chauffeur = (body) =>
            api("PATCH", `/admin/rental-partners/${rentalPartner._id}/chauffeur`, { token: tokens.admin, body });

        assert.strictEqual((await chauffeur({ status: "SUSPENDED" })).status, 400, "PENDING → SUSPENDED must be refused");
        assert.strictEqual((await chauffeur({ status: "UNDER_REVIEW" })).status, 200);
        assert.strictEqual((await chauffeur({ status: "APPROVED" })).status, 200);
        assert.strictEqual((await chauffeur({ status: "SUSPENDED" })).status, 200, "APPROVED → SUSPENDED is the hold path");
        assert.strictEqual((await chauffeur({ status: "APPROVED" })).status, 400, "SUSPENDED → APPROVED must re-enter review first");
        assert.strictEqual((await chauffeur({ status: "PENDING" })).status, 200);
        assert.strictEqual((await chauffeur({ status: "APPROVED" })).status, 200);

        const res = await bookWithDriver();
        assert.strictEqual(res.status, 201, JSON.stringify(res.json));
        return "invalid transitions 400; PENDING → APPROVED restores 201 booking";
    });

    await check("CH-14", "REJECTED requires a reason, stores it, and blocks bookings", async () => {
        const chauffeur = (body) =>
            api("PATCH", `/admin/rental-partners/${rentalPartner._id}/chauffeur`, { token: tokens.admin, body });

        assert.strictEqual((await chauffeur({ status: "PENDING" })).status, 200);

        const noReason = await chauffeur({ status: "REJECTED" });
        assert.strictEqual(noReason.status, 400, JSON.stringify(noReason.json));

        const rejected = await chauffeur({ status: "REJECTED", rejectionReason: "Licence photo illegible" });
        assert.strictEqual(rejected.status, 200, JSON.stringify(rejected.json));
        assert.strictEqual(rejected.json.rentalPartner.chauffeurRejectionReason, "Licence photo illegible");

        const blocked = await bookWithDriver();
        assert.strictEqual(blocked.status, 409, JSON.stringify(blocked.json));
        assert.strictEqual(blocked.json.code, "CHAUFFEUR_NOT_VERIFIED");
        return "reason required + stored; REJECTED blocks like any non-APPROVED state";
    });

    // -----------------------------------------------------------------
    // Wrap-up
    // -----------------------------------------------------------------
    if (serverProcess) {
        serverProcess.kill("SIGTERM");
        await new Promise((r) => setTimeout(r, 500));
        if (serverProcess.exitCode === null) serverProcess.kill("SIGKILL");
    }

    await mongoose.connection.db.dropDatabase();
    await mongoose.disconnect();

    const passed = results.filter((r) => r.ok).length;
    console.log(`\n=========================================`);
    console.log(`CHAUFFEUR INTEGRATION: ${passed}/${results.length} checks passed`);
    for (const r of results.filter((r) => !r.ok)) {
        console.log(`  FAILED ${r.id} ${r.name}: ${r.detail}`);
    }
    console.log(`=========================================`);

    if (passed !== results.length) {
        console.log(`\n--- backend server log (tail) ---\n${serverLog.slice(-3000)}`);
    }

    process.exit(passed === results.length ? 0 : 1);
})().catch(async (error) => {
    console.error("\nChauffeur suite crashed:", error);
    if (serverProcess && serverProcess.exitCode === null) {
        serverProcess.kill("SIGKILL");
    }
    try {
        if (mongoose && mongoose.connection.readyState === 1) {
            await mongoose.disconnect();
        }
    } catch { /* ignore */ }
    process.exit(1);
});
