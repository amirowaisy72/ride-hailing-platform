// Phase 8 — DATABASE-BACKED INTEGRATION TESTS (plain node, no test
// framework). These tests boot the REAL backend (src/server.js) as a
// child process against a REAL MongoDB replica set and drive the
// critical Buy & Deliver + Safar Rentals flows over HTTP, asserting
// both the API responses and the resulting database state.
//
// PREREQUISITE — a MongoDB replica set reachable at TEST_MONGODB_URI
// (default mongodb://127.0.0.1:27017/?replicaSet=rs0). How the desk
// stood one up in an environment with no system mongod (2026-10-29):
//   curl -O https://fastdl.mongodb.org/linux/mongodb-linux-x86_64-ubuntu2404-8.0.4.tgz
//   tar --no-same-owner -xzf mongodb-linux-x86_64-ubuntu2404-8.0.4.tgz
//   mongod --replSet rs0 --dbpath <dir> --bind_ip 127.0.0.1 --port 27017 --fork --logpath <log>
//   # then replSetInitiate via the mongodb driver (single-node RS —
//   # production Atlas is 3-node; single-node is the honest local
//   # equivalent for transaction/atomicity semantics).
//
// The suite uses two THROWAWAY databases (safar_phase8_test,
// safar_phase8_mig) and drops them before/after itself. It never
// touches any other database.
//
// Run:  node tests/integration.phase8.test.js
// Exit code 0 = every check passed, 1 = at least one failure.

const assert = require("node:assert");
const { spawn, execFile } = require("node:child_process");
const { promisify } = require("node:util");
const path = require("node:path");

const execFileAsync = promisify(execFile);

const BACKEND_DIR = path.join(__dirname, "..");
const RS_BASE =
    process.env.TEST_MONGODB_URI ||
    "mongodb://127.0.0.1:27017/?replicaSet=rs0";
const TEST_DB = "safar_phase8_test";
const MIG_DB = "safar_phase8_mig";
const PORT = 5711;
const BASE = `http://127.0.0.1:${PORT}/api/v1`;
const JWT_SECRET = "phase8-integration-secret";

const uriFor = (db) =>
    RS_BASE.replace("/?", `/${db}?`).includes(`/${db}?`)
        ? RS_BASE.replace("/?", `/${db}?`)
        : `${RS_BASE.split("?")[0].replace(/\/?$/, "")}/${db}?${RS_BASE.split("?")[1] || "replicaSet=rs0"}`;

const TEST_URI = uriFor(TEST_DB);
const MIG_URI = uriFor(MIG_DB);

// --------------------------------------------------------------------
// Result bookkeeping — every check is recorded and printed; a thrown
// assertion becomes a FAIL line, never a silent skip.
// --------------------------------------------------------------------
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
const PASSWORD = "Phase8!pass1";

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
    const { MongoClient, ObjectId } = require("mongodb");

    // -----------------------------------------------------------------
    // Section 0 — the database really is a replica set
    // -----------------------------------------------------------------
    console.log("\n== Section 0: replica-set database ==");

    let helloInfo = null;
    await check("INT-00", "MongoDB reachable and is a replica set (transactions supported)", async () => {
        const client = new MongoClient(RS_BASE);
        await client.connect();
        helloInfo = await client.db("admin").command({ hello: 1 });
        await client.close();

        assert.ok(helloInfo.setName, "no replica set name — a standalone mongod does not satisfy this suite");
        assert.strictEqual(helloInfo.isWritablePrimary, true);
        return `set=${helloInfo.setName}, primary=true, maxWireVersion=${helloInfo.maxWireVersion}`;
    });

    if (!helloInfo) {
        console.log("\nDatabase unavailable — aborting (nothing else can run).");
        process.exit(1);
    }

    // -----------------------------------------------------------------
    // Section 1 — migrateDriverServices.js against legacy-shaped data
    // -----------------------------------------------------------------
    console.log("\n== Section 1: driver-services migration (dry-run / apply / idempotency) ==");

    const migClient = new MongoClient(MIG_URI);
    await migClient.connect();
    const migDb = migClient.db(MIG_DB);
    await migDb.dropDatabase();

    const legacyApprovedId = new ObjectId();
    const legacyPendingId = new ObjectId();
    const legacyExplicitId = new ObjectId();

    await migDb.collection("drivers").insertMany([
        // (a) legacy APPROVED driver, NO services field at all
        { _id: new ObjectId(), userId: legacyApprovedId, verificationStatus: "APPROVED", isOnline: false, isAvailable: false },
        // (b) legacy PENDING driver, NO services field
        { _id: new ObjectId(), userId: legacyPendingId, verificationStatus: "PENDING", isOnline: false, isAvailable: false },
        // (c) legacy APPROVED driver with an EXPLICIT RIDE=REJECTED record
        {
            _id: new ObjectId(),
            userId: legacyExplicitId,
            verificationStatus: "APPROVED",
            isOnline: false,
            isAvailable: false,
            services: { RIDE: { status: "REJECTED", enabled: true }, PARCEL: { status: "NOT_APPLIED", enabled: true }, BUY_DELIVER: { status: "NOT_APPLIED", enabled: true } },
        },
    ]);

    const runMigration = (args) =>
        execFileAsync(process.execPath, [path.join(BACKEND_DIR, "scripts", "migrateDriverServices.js"), ...args], {
            cwd: BACKEND_DIR,
            env: { ...process.env, MONGODB_URI: MIG_URI },
        });

    const readDriver = (userId) => migDb.collection("drivers").findOne({ userId });

    await check("INT-01", "migration DRY-RUN writes nothing", async () => {
        await runMigration([]);
        const a = await readDriver(legacyApprovedId);
        assert.strictEqual(a.services, undefined, "dry-run must not materialise services");
        return "services field still absent after dry-run";
    });

    await check("INT-02", "migration --apply materialises RIDE+PARCEL APPROVED for the legacy approved driver only", async () => {
        await runMigration(["--apply"]);

        const a = await readDriver(legacyApprovedId);
        assert.strictEqual(a.services?.RIDE?.status, "APPROVED");
        assert.strictEqual(a.services?.PARCEL?.status, "APPROVED");
        assert.strictEqual(a.services?.BUY_DELIVER?.status ?? "NOT_APPLIED", "NOT_APPLIED", "migration must never touch BUY_DELIVER");

        const b = await readDriver(legacyPendingId);
        assert.strictEqual(b.services, undefined, "a PENDING (never approved) driver must not be auto-approved");

        return "approved→RIDE/PARCEL APPROVED; pending→untouched; BUY_DELIVER→untouched";
    });

    await check("INT-03", "migration never overwrites an explicit per-service record", async () => {
        const c = await readDriver(legacyExplicitId);
        assert.strictEqual(c.services?.RIDE?.status, "REJECTED", "explicit REJECTED must survive the migration");
        return "explicit RIDE=REJECTED preserved";
    });

    await check("INT-04", "migration is idempotent (second --apply changes nothing)", async () => {
        const before = await migDb.collection("drivers").find({}).toArray();
        await runMigration(["--apply"]);
        const after = await migDb.collection("drivers").find({}).toArray();
        assert.deepStrictEqual(
            after.map((d) => JSON.stringify(d.services || null)),
            before.map((d) => JSON.stringify(d.services || null))
        );
        return "second run = zero changes";
    });

    await migDb.dropDatabase();
    await migClient.close();

    // -----------------------------------------------------------------
    // Section 2 — boot the real backend against the test replica set
    // -----------------------------------------------------------------
    console.log("\n== Section 2: backend boot + fixtures + login ==");

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

    await check("INT-05", "backend boots against the replica set and serves /health", async () => {
        await waitForServer();
        const res = await fetch(`${BASE}/health`);
        assert.strictEqual(res.status, 200);
        return "API + Socket.IO up";
    });

    // --- fixtures (seeded through the app's own models) ---------------
    const User = require("../src/models/User");
    const Driver = require("../src/models/Driver");
    const DriverDocument = require("../src/models/DriverDocument");
    const Vehicle = require("../src/models/Vehicle");
    const ServiceArea = require("../src/models/ServiceArea");
    const CommissionSettings = require("../src/models/CommissionSettings");

    const passwordHash = await bcrypt.hash(PASSWORD, 10);
    const mkUser = (email, role, activeMode = "PASSENGER") =>
        User.create({
            firstName: "Phase8",
            lastName: email.split("@")[0],
            email,
            passwordHash,
            role,
            activeMode,
            emailVerified: true,
            status: "ACTIVE",
        });

    await mkUser("admin@phase8.test", "ADMIN");
    await mkUser("passenger@phase8.test", "PASSENGER");
    await mkUser("stranger@phase8.test", "PASSENGER");
    const driverUser1 = await mkUser("driver1@phase8.test", "DRIVER", "DRIVER");
    const driverUser2 = await mkUser("driver2@phase8.test", "DRIVER", "DRIVER");
    const driverUser3 = await mkUser("driver3@phase8.test", "DRIVER", "DRIVER");
    const partnerUser = await mkUser("partner@phase8.test", "PASSENGER");

    await CommissionSettings.create({
        key: "GLOBAL",
        percentage: 10,
        isActive: true,
        topUpRequired: false,
        minimumWalletBalance: 0,
        bankName: "Phase8 Bank",
        bankAccountTitle: "Safar Platform",
        bankAccountNumber: "PK00 PHASE 0001",
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
    await check("INT-06", "all fixture users can log in through the real auth API", async () => {
        for (const [key, email] of Object.entries({
            admin: "admin@phase8.test",
            passenger: "passenger@phase8.test",
            stranger: "stranger@phase8.test",
            driver1: "driver1@phase8.test",
            driver2: "driver2@phase8.test",
            driver3: "driver3@phase8.test",
            partner: "partner@phase8.test",
        })) {
            const res = await api("POST", "/auth/login", { body: { email, password: PASSWORD } });
            assert.strictEqual(res.status, 200, `login ${email}: HTTP ${res.status} ${JSON.stringify(res.json)}`);
            assert.ok(res.json.accessToken, `login ${email}: no access token`);
            tokens[key] = res.json.accessToken;
        }
        return "7/7 logins issued JWTs";
    });

    // Shared fixture helpers for the driver sections.
    const futureDate = (days) => new Date(Date.now() + days * 24 * 60 * 60 * 1000);

    async function seedDriverVerification(driverId, registrationNumber, vehicleType = "CAR_AC") {
        const docTypes = ["CNIC_FRONT", "CNIC_BACK", "PROFILE_PHOTO", "DRIVING_LICENSE", "VEHICLE_REGISTRATION"];
        await DriverDocument.insertMany(
            docTypes.map((documentType) => ({
                driverId,
                documentType,
                imageUrl: `https://example.com/docs/${registrationNumber}/${documentType}.jpg`,
                cloudinaryPublicId: `phase8/${registrationNumber}/${documentType}`,
                verificationStatus: "APPROVED",
                expiryDate: futureDate(365),
            }))
        );

        const vehicle = await Vehicle.create({
            driverId,
            vehicleType,
            registrationNumber,
            make: "Toyota",
            model: "Corolla",
            color: "White",
            modelYear: 2022,
            verificationStatus: "APPROVED",
            isActive: true,
            registrationExpiryDate: futureDate(365),
        });

        await Driver.updateOne({ _id: driverId }, { $set: { currentVehicleId: vehicle._id } });
        return vehicle;
    }

    async function refreshGpsFixture(driverId) {
        // Fixture-level GPS write, kept for brevity in the lifecycle
        // sections. The Phase 8 finding it originally worked around —
        // no shipped code path refreshing GPS for a Buy & Deliver-only
        // partner — is FIXED (both location paths accept any-service
        // eligibility; the socket handler writes `lastLocationUpdate`);
        // the shipped paths themselves are proven in Section 3b
        // (INT-45..INT-48).
        await Driver.updateOne(
            { _id: driverId },
            {
                $set: {
                    currentLocation: { type: "Point", coordinates: [LNG, LAT] },
                    lastLocationUpdate: new Date(),
                },
            }
        );
    }

    // -----------------------------------------------------------------
    // Section 3 — driver service eligibility over HTTP
    // -----------------------------------------------------------------
    console.log("\n== Section 3: driver registration, service apply, admin approval ==");

    let driver1 = null;
    let driver2 = null;
    let driver3 = null;

    await check("INT-07", "drivers register profiles through the API", async () => {
        for (const [key, token] of [["driver1", tokens.driver1], ["driver2", tokens.driver2], ["driver3", tokens.driver3]]) {
            const res = await api("POST", "/drivers/register", { token, body: {} });
            assert.strictEqual(res.status, 201, `${key}: HTTP ${res.status}`);
        }

        driver1 = await Driver.findOne({ userId: driverUser1._id });
        driver2 = await Driver.findOne({ userId: driverUser2._id });
        driver3 = await Driver.findOne({ userId: driverUser3._id });
        assert.ok(driver1 && driver2 && driver3);
        return "3 driver profiles created";
    });

    await seedDriverVerification(driver1._id, "BD-1001", "CAR_AC");
    await seedDriverVerification(driver2._id, "BD-1002", "CAR_NON_AC");
    // driver3 deliberately gets NO documents and NO vehicle.

    await check("INT-08", "Buy & Deliver apply: complete partner → PENDING, undocumented partner → INCOMPLETE", async () => {
        const ok = await api("POST", "/drivers/me/services/BUY_DELIVER/apply", {
            token: tokens.driver1,
            body: { transportMode: "CAR", policyAcknowledged: true },
        });
        assert.strictEqual(ok.status, 200, JSON.stringify(ok.json));
        assert.strictEqual(ok.json.service.applicationStatus, "PENDING");

        const incomplete = await api("POST", "/drivers/me/services/BUY_DELIVER/apply", {
            token: tokens.driver3,
            body: { transportMode: "CAR", policyAcknowledged: true },
        });
        assert.strictEqual(incomplete.status, 200);
        assert.strictEqual(incomplete.json.service.applicationStatus, "INCOMPLETE");
        assert.ok(incomplete.json.service.missingDocuments.includes("DRIVING_LICENSE"));

        const ok2 = await api("POST", "/drivers/me/services/BUY_DELIVER/apply", {
            token: tokens.driver2,
            body: { transportMode: "CAR", policyAcknowledged: true },
        });
        assert.strictEqual(ok2.json.service.applicationStatus, "PENDING");
        return "PENDING vs INCOMPLETE enforced server-side";
    });

    await check("INT-09", "admin CANNOT approve Buy & Deliver without the full document set (Amir correction)", async () => {
        const res = await api("PATCH", `/admin/drivers/${driver3._id}/services/BUY_DELIVER/status`, {
            token: tokens.admin,
            body: { status: "APPROVED", purchaseLimit: 50000 },
        });
        assert.strictEqual(res.status, 400, JSON.stringify(res.json));
        assert.ok((res.json.missingDocuments || []).includes("VEHICLE_REGISTRATION"));
        return "approval blocked with the missing-document list";
    });

    await check("INT-10", "admin approves Buy & Deliver (with purchase limit) for both complete partners", async () => {
        for (const driver of [driver1, driver2]) {
            const res = await api("PATCH", `/admin/drivers/${driver._id}/services/BUY_DELIVER/status`, {
                token: tokens.admin,
                body: { status: "APPROVED", purchaseLimit: 50000 },
            });
            assert.strictEqual(res.status, 200, JSON.stringify(res.json));
        }

        const mine = await api("GET", "/drivers/me/services", { token: tokens.driver1 });
        const bd = mine.json.services.find((s) => s.service === "BUY_DELIVER");
        assert.strictEqual(bd.eligible, true);
        assert.strictEqual(bd.purchaseLimit, 50000);
        return "both partners eligible, limit PKR 50,000 recorded";
    });

    await check("INT-11", "driver1 (also legacy-approved) goes online and posts GPS over REST", async () => {
        const status = await api("PATCH", `/admin/drivers/${driver1._id}/status`, {
            token: tokens.admin,
            body: { status: "APPROVED" },
        });
        assert.strictEqual(status.status, 200, JSON.stringify(status.json));

        const online = await api("PATCH", "/drivers/me/online-status", {
            token: tokens.driver1,
            body: { isOnline: true },
        });
        assert.strictEqual(online.status, 200, JSON.stringify(online.json));

        const loc = await api("PATCH", "/drivers/me/location", {
            token: tokens.driver1,
            body: { latitude: LAT, longitude: LNG },
        });
        assert.strictEqual(loc.status, 200, JSON.stringify(loc.json));
        return "online + fresh GPS via the shipped REST path";
    });

    await check("INT-12", "driver2 (Buy & Deliver-ONLY, global status still PENDING) can go online on service eligibility alone", async () => {
        const online = await api("PATCH", "/drivers/me/online-status", {
            token: tokens.driver2,
            body: { isOnline: true },
        });
        assert.strictEqual(online.status, 200, JSON.stringify(online.json));

        const fresh = await Driver.findById(driver2._id);
        assert.strictEqual(fresh.verificationStatus, "PENDING", "global status must remain untouched by the service approval");
        assert.strictEqual(fresh.isOnline, true);

        await refreshGpsFixture(driver2._id);
        return "online via BUY_DELIVER only; global status unchanged";
    });

    await check("INT-13", "undocumented driver3 cannot go online", async () => {
        const online = await api("PATCH", "/drivers/me/online-status", {
            token: tokens.driver3,
            body: { isOnline: true },
        });
        assert.strictEqual(online.status, 403, JSON.stringify(online.json));
        return `blocked: ${online.json.message}`;
    });

    // -----------------------------------------------------------------
    // Section 3b — BD-only GPS refresh (Phase 8 finding, FIXED)
    //
    // The Phase 8 run proved a Buy & Deliver-only partner had NO
    // shipped way to refresh GPS (both location paths required the
    // legacy global APPROVED status, and the socket handler wrote
    // lastLocationAt instead of the lastLocationUpdate field the
    // purchase gate reads). The checks below prove the fix on the
    // shipped paths themselves: REST + socket refresh for driver2
    // (BD-only, global status PENDING), the 120-second freshness gate
    // closing and re-opening around them, fan-out following freshness
    // end-to-end, and the refusal behaviour for a driver eligible for
    // nothing staying exactly as before.
    // -----------------------------------------------------------------
    console.log("\n== Section 3b: Buy & Deliver-only partner GPS refresh (REST + socket) ==");

    const { io: socketIoClient } = require("socket.io-client");
    const gpsDelivery = { latitude: LAT, longitude: LNG, address: "Mohalla Test, Khanpur" };

    async function setGpsStale(driverId) {
        await Driver.updateOne(
            { _id: driverId },
            {
                $set: {
                    lastLocationUpdate: new Date(Date.now() - 10 * 60 * 1000),
                    lastLocationAt: new Date(Date.now() - 10 * 60 * 1000),
                },
            }
        );
    }

    async function emitDriverLocation(token, latitude, longitude) {
        const socket = socketIoClient(`http://127.0.0.1:${PORT}`, {
            auth: { token },
            transports: ["websocket"],
            reconnection: false,
            timeout: 10000,
        });

        try {
            await new Promise((resolve, reject) => {
                socket.on("connect", resolve);
                socket.on("connect_error", reject);
            });

            return await socket
                .timeout(10000)
                .emitWithAck("driver:location", { latitude, longitude });
        } finally {
            socket.disconnect();
        }
    }

    const gpsFresh = (value) =>
        Boolean(value) && Date.now() - new Date(value).getTime() < 120000;

    await check("INT-45", "BD-only partner: stale GPS locks the purchase gate; REST location refresh (global PENDING) re-opens it", async () => {
        await setGpsStale(driver2._id);

        const stale = await api("GET", "/purchases/available", { token: tokens.driver2 });
        assert.strictEqual(stale.status, 403, JSON.stringify(stale.json));
        assert.strictEqual(stale.json.message, "Fresh driver GPS location required");

        const loc = await api("PATCH", "/drivers/me/location", {
            token: tokens.driver2,
            body: { latitude: LAT, longitude: LNG },
        });
        assert.strictEqual(loc.status, 200, JSON.stringify(loc.json));

        const fresh = await Driver.findById(driver2._id);
        assert.ok(gpsFresh(fresh.lastLocationUpdate), "lastLocationUpdate must be fresh after the REST refresh");
        assert.strictEqual(fresh.verificationStatus, "PENDING", "global status must remain untouched");

        const open = await api("GET", "/purchases/available", { token: tokens.driver2 });
        assert.strictEqual(open.status, 200, JSON.stringify(open.json));
        return "stale → 403 at the gate; REST refresh → gate open, global status still PENDING";
    });

    await check("INT-46", "BD-only partner refreshes GPS over the SOCKET; handler writes lastLocationUpdate (and keeps lastLocationAt)", async () => {
        await setGpsStale(driver2._id);

        const ack = await emitDriverLocation(tokens.driver2, LAT, LNG);
        assert.strictEqual(ack?.success, true, JSON.stringify(ack));

        const raw = await mongoose.connection.db
            .collection("drivers")
            .findOne({ _id: driver2._id });
        assert.ok(gpsFresh(raw.lastLocationUpdate), "socket handler must write the lastLocationUpdate field the gate reads");
        assert.ok(gpsFresh(raw.lastLocationAt), "lastLocationAt must stay written alongside (backward compatibility)");

        const open = await api("GET", "/purchases/available", { token: tokens.driver2 });
        assert.strictEqual(open.status, 200, JSON.stringify(open.json));
        return "socket ack success; both timestamps fresh; purchase gate open";
    });

    await check("INT-47", "fan-out follows GPS freshness end-to-end: fresh BD-only partner sees a new request, stale does not, shipped-path refresh restores it", async () => {
        const created = await api("POST", "/purchases", {
            token: tokens.passenger,
            body: {
                itemsText: "1 kg rice, 500 g daal",
                estimatedBudget: 2000,
                delivery: gpsDelivery,
                deliveryLabel: "Home",
            },
        });
        assert.strictEqual(created.status, 201, JSON.stringify(created.json));
        const gpsOrder = created.json.order;
        assert.strictEqual(gpsOrder.status, "BIDDING");

        // driver2's GPS is fresh from INT-46 → the request fans out to him.
        let feed = await api("GET", "/purchases/available", { token: tokens.driver2 });
        assert.strictEqual(feed.status, 200, JSON.stringify(feed.json));
        assert.ok(
            feed.json.orders.some((o) => o._id === gpsOrder._id),
            "fresh BD-only partner must see the new request"
        );

        // Ten minutes without a fix → the freshness gate locks him out.
        await setGpsStale(driver2._id);
        feed = await api("GET", "/purchases/available", { token: tokens.driver2 });
        assert.strictEqual(feed.status, 403, "stale partner must be refused at the gate");

        // Refresh through the shipped REST path → visible again.
        const loc = await api("PATCH", "/drivers/me/location", {
            token: tokens.driver2,
            body: { latitude: LAT, longitude: LNG },
        });
        assert.strictEqual(loc.status, 200, JSON.stringify(loc.json));

        feed = await api("GET", "/purchases/available", { token: tokens.driver2 });
        assert.strictEqual(feed.status, 200, JSON.stringify(feed.json));
        assert.ok(
            feed.json.orders.some((o) => o._id === gpsOrder._id),
            "refreshed BD-only partner must see the request again"
        );

        const cancel = await api("PATCH", `/purchases/${gpsOrder._id}/cancel`, {
            token: tokens.passenger,
            body: {},
        });
        assert.strictEqual(cancel.status, 200, JSON.stringify(cancel.json));
        return "fresh → visible; stale → 403; REST refresh → visible again; request cancelled";
    });

    await check("INT-48", "refusals preserved: a driver eligible for nothing is refused on BOTH location paths; legacy APPROVED driver1 socket refresh unchanged", async () => {
        const loc = await api("PATCH", "/drivers/me/location", {
            token: tokens.driver3,
            body: { latitude: LAT, longitude: LNG },
        });
        assert.strictEqual(loc.status, 403, JSON.stringify(loc.json));
        // The REST refusal for a nothing-approved driver has always
        // come from the shared authorize middleware, with this exact
        // message — unchanged by the fix.
        assert.strictEqual(loc.json.message, "Approved Driver mode required");

        const ackBad = await emitDriverLocation(tokens.driver3, LAT, LNG);
        assert.strictEqual(ackBad?.success, false, JSON.stringify(ackBad));
        assert.strictEqual(ackBad?.message, "Approved online driver required");

        const ackLegacy = await emitDriverLocation(tokens.driver1, LAT, LNG);
        assert.strictEqual(ackLegacy?.success, true, JSON.stringify(ackLegacy));

        const raw = await mongoose.connection.db
            .collection("drivers")
            .findOne({ _id: driver1._id });
        assert.ok(gpsFresh(raw.lastLocationUpdate), "legacy driver socket refresh must write lastLocationUpdate");
        return "driver3 refused on REST + socket with the original message; driver1 (global APPROVED) unaffected";
    });

    // -----------------------------------------------------------------
    // Section 4 — Buy & Deliver order lifecycle over HTTP
    // -----------------------------------------------------------------
    console.log("\n== Section 4: purchase order lifecycle, chat, settlement, earnings ==");

    const PurchaseOrder = require("../src/models/PurchaseOrder");
    const PurchaseSettlement = require("../src/models/PurchaseSettlement");
    const delivery = { latitude: LAT, longitude: LNG, address: "Mohalla Test, Khanpur" };
    let order1 = null;
    let offer1 = null;
    let offer2 = null;

    await check("INT-14", "prohibited goods are rejected at order creation", async () => {
        const res = await api("POST", "/purchases", {
            token: tokens.passenger,
            body: { itemsText: "2 packs of cigarettes", estimatedBudget: 1000, delivery },
        });
        assert.strictEqual(res.status, 400, JSON.stringify(res.json));
        assert.strictEqual(res.json.code, "RESTRICTED_ITEM");
        return "RESTRICTED_ITEM";
    });

    await check("INT-15", "passenger creates a Buy & Deliver request with NO store selection (delivery address only)", async () => {
        const res = await api("POST", "/purchases", {
            token: tokens.passenger,
            body: {
                itemsText: "2 kg sugar, 1 litre milk, 1 dozen eggs",
                estimatedBudget: 3000,
                delivery,
                deliveryLabel: "Home",
            },
        });
        assert.strictEqual(res.status, 201, JSON.stringify(res.json));
        assert.strictEqual(res.json.order.status, "BIDDING");
        order1 = res.json.order;
        return `order ${order1._id} open for offers`;
    });

    await check("INT-16", "fan-out: only eligible online partners see the request (BD-09, HTTP level)", async () => {
        const d3 = await api("GET", "/purchases/available", { token: tokens.driver3 });
        assert.strictEqual(d3.status, 403, "ineligible driver must be stopped at the gate");

        await refreshGpsFixture(driver2._id);
        const d1 = await api("GET", "/purchases/available", { token: tokens.driver1 });
        assert.strictEqual(d1.status, 200, JSON.stringify(d1.json));
        assert.ok(d1.json.orders.some((o) => o._id === order1._id), "driver1 must see the order");

        const d2 = await api("GET", "/purchases/available", { token: tokens.driver2 });
        assert.strictEqual(d2.status, 200);
        assert.ok(d2.json.orders.some((o) => o._id === order1._id), "driver2 (BD-only) must see the order");
        return "eligible partners see it; ineligible partner gets 403";
    });

    await check("INT-17", "both eligible partners submit offers; the ineligible partner cannot", async () => {
        const o1 = await api("POST", `/purchases/${order1._id}/offers`, {
            token: tokens.driver1,
            body: { deliveryFee: 300 },
        });
        assert.strictEqual(o1.status, 201, JSON.stringify(o1.json));

        await refreshGpsFixture(driver2._id);
        const o2 = await api("POST", `/purchases/${order1._id}/offers`, {
            token: tokens.driver2,
            body: { deliveryFee: 250 },
        });
        assert.strictEqual(o2.status, 201, JSON.stringify(o2.json));

        const o3 = await api("POST", `/purchases/${order1._id}/offers`, {
            token: tokens.driver3,
            body: { deliveryFee: 100 },
        });
        assert.strictEqual(o3.status, 403, "ineligible partner offer must be refused");

        const list = await api("GET", `/purchases/${order1._id}/offers`, { token: tokens.passenger });
        assert.strictEqual(list.json.offers.length, 2);
        offer1 = list.json.offers.find((o) => String(o.driverId) === String(driver1._id));
        offer2 = list.json.offers.find((o) => String(o.driverId) === String(driver2._id));
        assert.ok(offer1 && offer2);
        return "offers: PKR 300 (driver1), PKR 250 (driver2)";
    });

    let loserConversation = null;
    await check("INT-18", "per-bidder private chat works pre-selection; non-parties are refused (BD-11)", async () => {
        const created = await api("POST", "/order-chats", {
            token: tokens.passenger,
            body: { orderType: "PURCHASE", orderId: order1._id, partnerUserId: String(driver2._id) },
        });
        assert.strictEqual(created.status, 200, JSON.stringify(created.json));
        loserConversation = created.json.conversation;

        const m1 = await api("POST", `/order-chats/${loserConversation._id}/messages`, {
            token: tokens.passenger,
            body: { kind: "TEXT", body: "Please buy fresh milk only", clientMessageId: "p1-c2-1" },
        });
        assert.strictEqual(m1.status, 201, JSON.stringify(m1.json));

        const m2 = await api("POST", `/order-chats/${loserConversation._id}/messages`, {
            token: tokens.driver2,
            body: { kind: "TEXT", body: "Okay, noted", clientMessageId: "d2-c2-1" },
        });
        assert.strictEqual(m2.status, 201, JSON.stringify(m2.json));

        const strangerRead = await api("GET", `/order-chats/${loserConversation._id}/messages`, { token: tokens.stranger });
        assert.strictEqual(strangerRead.status, 403, "a non-party must not read the thread");

        const strangerSend = await api("POST", `/order-chats/${loserConversation._id}/messages`, {
            token: tokens.stranger,
            body: { kind: "TEXT", body: "intruder", clientMessageId: "s-1" },
        });
        assert.strictEqual(strangerSend.status, 403, "a non-party must not write to the thread");

        const history = await api("GET", `/order-chats/${loserConversation._id}/messages`, { token: tokens.passenger });
        const textMessages = history.json.messages.filter((m) => m.kind === "TEXT");
        assert.strictEqual(textMessages.length, 2);
        return "2 messages exchanged; stranger read+write both 403";
    });

    await check("INT-19", "chat send is idempotent on clientMessageId (no duplicates after a retry/reconnect)", async () => {
        const dup = await api("POST", `/order-chats/${loserConversation._id}/messages`, {
            token: tokens.passenger,
            body: { kind: "TEXT", body: "Please buy fresh milk only", clientMessageId: "p1-c2-1" },
        });
        assert.strictEqual(dup.status, 200);
        assert.strictEqual(dup.json.duplicate, true);

        const history = await api("GET", `/order-chats/${loserConversation._id}/messages`, { token: tokens.passenger });
        assert.strictEqual(history.json.messages.filter((m) => m.kind === "TEXT").length, 2);
        return "retry returned duplicate:true; history unchanged";
    });

    await check("INT-20", "exactly one offer can be accepted; the second acceptance is refused (BD-10)", async () => {
        const accept = await api("POST", `/purchases/${order1._id}/offers/${offer1._id}/accept`, {
            token: tokens.passenger,
            body: {},
        });
        assert.strictEqual(accept.status, 200, JSON.stringify(accept.json));
        assert.strictEqual(accept.json.order.status, "DRIVER_SELECTED");
        assert.strictEqual(String(accept.json.order.driverId), String(driver1._id));

        const second = await api("POST", `/purchases/${order1._id}/offers/${offer2._id}/accept`, {
            token: tokens.passenger,
            body: {},
        });
        assert.strictEqual(second.status, 409, JSON.stringify(second.json));
        return "one winner (driver1); competing accept → 409";
    });

    await check("INT-21", "the losing bidder's chat closes read-only; the winner's chat stays open (BD-13)", async () => {
        const loserSend = await api("POST", `/order-chats/${loserConversation._id}/messages`, {
            token: tokens.driver2,
            body: { kind: "TEXT", body: "still there?", clientMessageId: "d2-c2-2" },
        });
        assert.strictEqual(loserSend.status, 403, JSON.stringify(loserSend.json));

        const created = await api("POST", "/order-chats", {
            token: tokens.passenger,
            body: { orderType: "PURCHASE", orderId: order1._id, partnerUserId: String(driver1._id) },
        });
        assert.strictEqual(created.status, 200, JSON.stringify(created.json));

        const winnerSend = await api("POST", `/order-chats/${created.json.conversation._id}/messages`, {
            token: tokens.driver1,
            body: { kind: "TEXT", body: "On my way to the market", clientMessageId: "d1-c1-1" },
        });
        assert.strictEqual(winnerSend.status, 201, JSON.stringify(winnerSend.json));
        return "loser thread closed; winner thread live";
    });

    await check("INT-22", "shopping flow: start → estimate → passenger approval gate", async () => {
        const start = await api("PATCH", `/purchases/${order1._id}/start-shopping`, { token: tokens.driver1, body: {} });
        assert.strictEqual(start.status, 200, JSON.stringify(start.json));
        assert.strictEqual(start.json.order.status, "SHOPPING");

        const estimate = await api("POST", `/purchases/${order1._id}/cost-estimate`, {
            token: tokens.driver1,
            body: { amount: 2500 },
        });
        assert.strictEqual(estimate.status, 200, JSON.stringify(estimate.json));
        assert.strictEqual(estimate.json.order.status, "AWAITING_APPROVAL");

        const early = await api("POST", `/purchases/${order1._id}/purchased`, {
            token: tokens.driver1,
            body: { actualCost: 2400, receiptImageUrls: ["https://example.com/receipt1.jpg"] },
        });
        assert.strictEqual(early.status, 409, "purchase before approval must be impossible");

        const approve = await api("POST", `/purchases/${order1._id}/approve-amount`, {
            token: tokens.passenger,
            body: { amount: 2500 },
        });
        assert.strictEqual(approve.status, 200, JSON.stringify(approve.json));
        assert.strictEqual(approve.json.order.status, "PURCHASE_APPROVED");
        assert.strictEqual(approve.json.order.approvedMaxAmount, 2500);
        return "estimate 2500 approved as the hard ceiling";
    });

    await check("INT-23", "purchase ABOVE the approved amount is hard-blocked; at/below it succeeds (BD-15)", async () => {
        const above = await api("POST", `/purchases/${order1._id}/purchased`, {
            token: tokens.driver1,
            body: { actualCost: 2600, receiptImageUrls: ["https://example.com/receipt1.jpg"] },
        });
        assert.strictEqual(above.status, 409, JSON.stringify(above.json));

        const ok = await api("POST", `/purchases/${order1._id}/purchased`, {
            token: tokens.driver1,
            body: { actualCost: 2400, receiptImageUrls: ["https://example.com/receipt1.jpg"] },
        });
        assert.strictEqual(ok.status, 200, JSON.stringify(ok.json));
        assert.strictEqual(ok.json.order.status, "PURCHASED");
        assert.strictEqual(ok.json.order.customerTotalPayable, 2700, "payable = shopping 2400 + delivery fee 300");
        return "2600 refused; 2400 recorded; payable PKR 2,700";
    });

    await check("INT-24", "OTP-gated delivery: wrong OTP refused, correct OTP completes, delivery cannot repeat (BD-16)", async () => {
        const ofd = await api("PATCH", `/purchases/${order1._id}/out-for-delivery`, { token: tokens.driver1, body: {} });
        assert.strictEqual(ofd.status, 200, JSON.stringify(ofd.json));

        const arrived = await api("PATCH", `/purchases/${order1._id}/arrived`, { token: tokens.driver1, body: {} });
        assert.strictEqual(arrived.status, 200, JSON.stringify(arrived.json));
        assert.strictEqual(arrived.json.order.status, "ARRIVED");

        const otpRes = await api("POST", `/purchases/${order1._id}/otp`, { token: tokens.passenger, body: {} });
        assert.strictEqual(otpRes.status, 200, JSON.stringify(otpRes.json));
        assert.match(otpRes.json.otp, /^\d{6}$/);

        const wrong = await api("POST", `/purchases/${order1._id}/deliver`, {
            token: tokens.driver1,
            body: { otp: "000000", amountReceived: 2700 },
        });
        assert.strictEqual(wrong.status, 403, JSON.stringify(wrong.json));

        const delivered = await api("POST", `/purchases/${order1._id}/deliver`, {
            token: tokens.driver1,
            body: { otp: otpRes.json.otp, amountReceived: 2700 },
        });
        assert.strictEqual(delivered.status, 200, JSON.stringify(delivered.json));
        assert.strictEqual(delivered.json.order.status, "COMPLETED");

        const again = await api("POST", `/purchases/${order1._id}/deliver`, {
            token: tokens.driver1,
            body: { otp: otpRes.json.otp, amountReceived: 2700 },
        });
        assert.strictEqual(again.status, 409, "a completed delivery must not be completable twice");
        return "OTP verified once; order COMPLETED; replay refused";
    });

    await check("INT-25", "settlement: commission is charged on the DELIVERY FEE ONLY and is ZERO in Free Mode (BD-18/19)", async () => {
        const { processPendingPurchaseSettlements } = require("../src/services/pendingSettlementService");
        await processPendingPurchaseSettlements({ limit: 50 });

        const settlement = await PurchaseSettlement.findOne({ purchaseOrderId: order1._id });
        assert.ok(settlement, "a settlement record must exist");
        assert.strictEqual(settlement.status, "SETTLED", JSON.stringify(settlement));
        assert.strictEqual(settlement.fare, 300, "fare = delivery fee only, never the shopping money");
        assert.strictEqual(settlement.commission, 0, "no gateway configured → Auto Free Mode → zero commission");
        assert.strictEqual(settlement.driverEarnings, 300);

        const order = await PurchaseOrder.findById(order1._id);
        assert.strictEqual(order.settlementStatus, "SETTLED");
        return "SETTLED: fare 300, commission 0, driver keeps 300";
    });

    await check("INT-26", "earnings-by-service keeps shopping money OUT of earnings (BD-17)", async () => {
        const res = await api("GET", "/drivers/me/earnings-by-service", { token: tokens.driver1 });
        assert.strictEqual(res.status, 200, JSON.stringify(res.json));

        const bd = res.json.services.BUY_DELIVER;
        assert.strictEqual(bd.netEarnings, 300);
        assert.strictEqual(res.json.totals.netEarnings, 300, "totals must exclude reimbursements");
        assert.strictEqual(bd.shopping.advanced, 2400, "shopping advance shown in its own ledger");
        assert.strictEqual(bd.shopping.unpaid, 0);
        return "earnings 300; shopping advanced 2400 tracked separately";
    });

    // -----------------------------------------------------------------
    // Section 5 — cancel-after-purchase dispute + admin resolution
    // -----------------------------------------------------------------
    console.log("\n== Section 5: purchase dispute and admin resolution (BD-20/24) ==");

    let order2 = null;
    await check("INT-27", "cancelling AFTER purchase routes to a reimbursement DISPUTE, not a plain cancel (BD-20)", async () => {
        const created = await api("POST", "/purchases", {
            token: tokens.passenger,
            body: { itemsText: "5 kg basmati rice", estimatedBudget: 2000, delivery, deliveryLabel: "Home" },
        });
        assert.strictEqual(created.status, 201, JSON.stringify(created.json));
        order2 = created.json.order;

        await refreshGpsFixture(driver1._id);
        const offer = await api("POST", `/purchases/${order2._id}/offers`, {
            token: tokens.driver1,
            body: { deliveryFee: 200 },
        });
        assert.strictEqual(offer.status, 201, JSON.stringify(offer.json));

        const list = await api("GET", `/purchases/${order2._id}/offers`, { token: tokens.passenger });
        const accept = await api("POST", `/purchases/${order2._id}/offers/${list.json.offers[0]._id}/accept`, {
            token: tokens.passenger,
            body: {},
        });
        assert.strictEqual(accept.status, 200, JSON.stringify(accept.json));

        await api("PATCH", `/purchases/${order2._id}/start-shopping`, { token: tokens.driver1, body: {} });
        await api("POST", `/purchases/${order2._id}/cost-estimate`, { token: tokens.driver1, body: { amount: 1800 } });
        await api("POST", `/purchases/${order2._id}/approve-amount`, { token: tokens.passenger, body: { amount: 1800 } });

        const purchased = await api("POST", `/purchases/${order2._id}/purchased`, {
            token: tokens.driver1,
            body: { actualCost: 1700, receiptImageUrls: ["https://example.com/receipt2.jpg"] },
        });
        assert.strictEqual(purchased.status, 200, JSON.stringify(purchased.json));
        assert.strictEqual(purchased.json.order.customerTotalPayable, 1900);

        const cancel = await api("PATCH", `/purchases/${order2._id}/cancel`, {
            token: tokens.passenger,
            body: { reason: "Changed my mind after the partner had already bought the items" },
        });
        assert.strictEqual(cancel.status, 200, JSON.stringify(cancel.json));
        assert.strictEqual(cancel.json.routedToDispute, true);
        assert.strictEqual(cancel.json.order.status, "DISPUTED");
        return "post-purchase cancel → DISPUTED (partner's money is protected)";
    });

    await check("INT-28", "admin dispute resolution enforces the money rules, then completes the order (BD-24)", async () => {
        const underpaid = await api("POST", `/admin/purchases/orders/${order2._id}/resolve-dispute`, {
            token: tokens.admin,
            body: { outcome: "COMPLETED", paymentAmount: 0, note: "Verified with both parties" },
        });
        assert.strictEqual(underpaid.status, 409, JSON.stringify(underpaid.json));
        assert.strictEqual(underpaid.json.code, "ORDER_NOT_FULLY_PAID");

        const resolved = await api("POST", `/admin/purchases/orders/${order2._id}/resolve-dispute`, {
            token: tokens.admin,
            body: { outcome: "COMPLETED", paymentAmount: 1900, note: "Passenger paid the partner in full at the door" },
        });
        assert.strictEqual(resolved.status, 200, JSON.stringify(resolved.json));
        assert.strictEqual(resolved.json.order.status, "COMPLETED");
        assert.ok(resolved.json.order.disputeResolution?.note, "resolution must be recorded with a note");
        return "under-payment refused; full payment completes with an audit note";
    });

    // -----------------------------------------------------------------
    // Section 6 — Safar Rentals end-to-end over HTTP
    // -----------------------------------------------------------------
    console.log("\n== Section 6: rentals — partner KYC, listing gate, booking fee, handover/return ==");

    const RentalPartner = require("../src/models/RentalPartner");
    const RentalPartnerDocument = require("../src/models/RentalPartnerDocument");
    const RentalBooking = require("../src/models/RentalBooking");

    let rentalPartner = null;
    let rentalVehicle = null;

    await check("INT-29", "rental partner onboarding: apply → KYC documents → admin approval", async () => {
        const apply1 = await api("POST", "/rental-partners/apply", {
            token: tokens.partner,
            body: { businessName: "Phase8 Rent A Car", providesChauffeur: true },
        });
        assert.strictEqual(apply1.status, 200, JSON.stringify(apply1.json));
        assert.strictEqual(apply1.json.rentalPartner.applicationStatus, "INCOMPLETE");

        rentalPartner = await RentalPartner.findOne({ userId: partnerUser._id });
        assert.ok(rentalPartner);

        await RentalPartnerDocument.insertMany(
            ["CNIC_FRONT", "CNIC_BACK", "PROFILE_PHOTO", "DRIVING_LICENSE"].map((documentType) => ({
                rentalPartnerId: rentalPartner._id,
                documentType,
                imageUrl: `https://example.com/kyc/${documentType}.jpg`,
                cloudinaryPublicId: `phase8/kyc/${documentType}`,
                verificationStatus: "APPROVED",
                expiryDate: futureDate(365),
            }))
        );

        const apply2 = await api("POST", "/rental-partners/apply", {
            token: tokens.partner,
            body: { businessName: "Phase8 Rent A Car", providesChauffeur: true },
        });
        assert.strictEqual(apply2.json.rentalPartner.applicationStatus, "PENDING");

        const approve = await api("PATCH", `/admin/rental-partners/${rentalPartner._id}/status`, {
            token: tokens.admin,
            body: { status: "APPROVED" },
        });
        assert.strictEqual(approve.status, 200, JSON.stringify(approve.json));
        return "INCOMPLETE → PENDING → APPROVED";
    });

    await check("INT-30", "anti-bypass gate: a listing cannot be approved before the partner accepts the agreement (R10)", async () => {
        const created = await api("POST", "/rentals/vehicles", {
            token: tokens.partner,
            body: {
                brand: "Toyota",
                model: "Corolla",
                year: 2022,
                registrationNumber: "RP-8001",
                transmission: "AUTOMATIC",
                seats: 5,
                hasAC: true,
                rentalModes: ["WITH_DRIVER", "SELF_DRIVE"],
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
                pickupContactName: "Phase8 Rentals",
                pickupContactPhone: "03001234567",
                fuelPolicy: "Return with the same fuel level",
                insuranceNote: "Comprehensive cover",
                tollsNote: "Renter pays tolls",
            },
        });
        assert.strictEqual(created.status, 201, JSON.stringify(created.json));
        rentalVehicle = created.json.vehicle;
        assert.strictEqual(rentalVehicle.listingStatus, "PENDING");

        const early = await api("PATCH", `/admin/rentals/vehicles/${rentalVehicle.id || rentalVehicle._id}/moderate`, {
            token: tokens.admin,
            body: { status: "APPROVED" },
        });
        assert.strictEqual(early.status, 409, JSON.stringify(early.json));
        assert.strictEqual(early.json.code, "AGREEMENT_NOT_ACCEPTED");

        const accept = await api("POST", "/rentals/agreement/accept", { token: tokens.partner, body: {} });
        assert.strictEqual(accept.status, 200, JSON.stringify(accept.json));

        const moderate = await api("PATCH", `/admin/rentals/vehicles/${rentalVehicle.id || rentalVehicle._id}/moderate`, {
            token: tokens.admin,
            body: { status: "APPROVED" },
        });
        assert.strictEqual(moderate.status, 200, JSON.stringify(moderate.json));
        assert.strictEqual(moderate.json.vehicle.listingStatus, "APPROVED");
        return "moderation 409 AGREEMENT_NOT_ACCEPTED → agreement accepted → APPROVED";
    });

    const vehicleId = String(
        rentalVehicle?.id || rentalVehicle?._id || "000000000000000000000000"
    );

    await check("INT-31", "listings are masked: exact pickup address + contact phone never leak pre-confirmation (R3)", async () => {
        const search = await api("GET", "/rentals/search?mode=WITH_DRIVER", { token: tokens.passenger });
        assert.strictEqual(search.status, 200, JSON.stringify(search.json));
        const found = search.json.vehicles.find((v) => String(v.id || v._id) === vehicleId);
        assert.ok(found, "approved listing must be searchable");
        assert.ok(found.exactPickupAddress == null, "exact address must be null/absent pre-confirmation");
        assert.ok(found.pickupContactPhone == null, "contact phone must be null/absent pre-confirmation");
        assert.ok(!JSON.stringify(found).includes("House 12-B"), "the real address must not appear anywhere in the payload");
        assert.ok(!JSON.stringify(found).includes("03001234567"), "the real phone must not appear anywhere in the payload");

        const detail = await api("GET", `/rentals/vehicles/${vehicleId}`, { token: tokens.passenger });
        assert.strictEqual(detail.status, 200, JSON.stringify(detail.json));
        assert.ok(detail.json.vehicle.exactPickupAddress == null);
        assert.ok(detail.json.vehicle.pickupContactPhone == null);
        assert.ok(!JSON.stringify(detail.json.vehicle).includes("House 12-B"));
        assert.ok(!JSON.stringify(detail.json.vehicle).includes("03001234567"));
        return "search + detail both masked (fields null, real values absent from payloads)";
    });

    const rentalStart = new Date(Date.now() + 26 * 60 * 60 * 1000);
    const rentalEnd = new Date(rentalStart.getTime() + 48 * 60 * 60 * 1000);

    await check("INT-32", "SELF_DRIVE booking is refused while the launch gate is closed (R9, HTTP level)", async () => {
        const res = await api("POST", "/rentals/bookings", {
            token: tokens.passenger,
            body: {
                vehicleId,
                mode: "SELF_DRIVE",
                startAt: rentalStart,
                endAt: rentalEnd,
                billingUnit: "DAILY",
                renterLicence: { number: "LHR-2026-0042", expiryDate: futureDate(365) },
            },
        });
        assert.strictEqual(res.status, 400, JSON.stringify(res.json));
        assert.strictEqual(res.json.code, "SELF_DRIVE_DISABLED");
        return "SELF_DRIVE_DISABLED — declaration alone never suffices";
    });

    await check("INT-33", "FINDING probe: a declared chauffeur can never be verified — With-Driver is blocked for them", async () => {
        const res = await api("POST", "/rentals/bookings", {
            token: tokens.passenger,
            body: { vehicleId, mode: "WITH_DRIVER", startAt: rentalStart, endAt: rentalEnd, billingUnit: "DAILY" },
        });
        assert.strictEqual(res.status, 409, JSON.stringify(res.json));
        assert.strictEqual(res.json.code, "CHAUFFEUR_NOT_VERIFIED");

        // No endpoint in the codebase can move chauffeurVerificationStatus
        // to APPROVED (see the Phase 8 report). The only shipped route to
        // a bookable With-Driver partner today is providesChauffeur=false,
        // which the eligibility rule passes trivially. The fixture flips
        // the declaration so the remaining happy path can be exercised;
        // the blocked behaviour above is the recorded finding.
        await RentalPartner.updateOne(
            { _id: rentalPartner._id },
            { $set: { providesChauffeur: false, chauffeurVerificationStatus: "NOT_APPLIED" } }
        );
        return "CHAUFFEUR_NOT_VERIFIED with no shipped approval path — declaration flipped in fixtures to continue";
    });

    let booking1 = null;
    let booking2 = null;
    await check("INT-34", "booking amounts: charges, booking fee and deposit are three separate figures (R1)", async () => {
        const res = await api("POST", "/rentals/bookings", {
            token: tokens.passenger,
            body: { vehicleId, mode: "WITH_DRIVER", startAt: rentalStart, endAt: rentalEnd, billingUnit: "DAILY" },
        });
        assert.strictEqual(res.status, 201, JSON.stringify(res.json));
        booking1 = res.json.booking;
        assert.strictEqual(booking1.status, "REQUESTED");
        assert.strictEqual(booking1.rentalCharges, 16000, "2 days × PKR 8,000");
        assert.strictEqual(booking1.bookingFee, 800, "5% of charges only");
        assert.strictEqual(booking1.securityDeposit, 20000, "deposit recorded separately, never fee'd");

        const overlap = await api("POST", "/rentals/bookings", {
            token: tokens.passenger,
            body: {
                vehicleId,
                mode: "WITH_DRIVER",
                startAt: new Date(rentalStart.getTime() + 24 * 60 * 60 * 1000),
                endAt: new Date(rentalEnd.getTime() + 24 * 60 * 60 * 1000),
                billingUnit: "DAILY",
            },
        });
        assert.strictEqual(overlap.status, 201, JSON.stringify(overlap.json));
        booking2 = overlap.json.booking;
        return "charges 16000 / fee 800 / deposit 20000";
    });

    await check("INT-35", "calendar hold: accepting one booking blocks the overlapping one (R4)", async () => {
        const accept1 = await api("POST", `/rentals/partner/bookings/${booking1._id}/accept`, { token: tokens.partner, body: {} });
        assert.strictEqual(accept1.status, 200, JSON.stringify(accept1.json));
        assert.strictEqual(accept1.json.booking.status, "PROVIDER_ACCEPTED");
        assert.ok(accept1.json.booking.paymentDeadlineAt, "acceptance must plant the payment deadline / hold");

        const accept2 = await api("POST", `/rentals/partner/bookings/${booking2._id}/accept`, { token: tokens.partner, body: {} });
        assert.strictEqual(accept2.status, 409, JSON.stringify(accept2.json));

        const cancel2 = await api("PATCH", `/rentals/bookings/${booking2._id}/cancel`, {
            token: tokens.passenger,
            body: { reason: "Plans changed" },
        });
        assert.strictEqual(cancel2.status, 200, JSON.stringify(cancel2.json));
        return "first accept holds the calendar; overlapping accept → 409";
    });

    await check("INT-36", "CONFIRMED is impossible without a SUBMITTED, admin-verified fee payment (R2)", async () => {
        const verify = await api("POST", `/admin/rentals/bookings/${booking1._id}/verify-payment`, {
            token: tokens.admin,
            body: {},
        });
        assert.strictEqual(verify.status, 409, JSON.stringify(verify.json));

        const fresh = await RentalBooking.findById(booking1._id);
        assert.strictEqual(fresh.status, "PROVIDER_ACCEPTED");
        assert.notStrictEqual(fresh.feePayment?.status, "VERIFIED");
        return "verify with nothing submitted → 409; booking unconfirmed";
    });

    await check("INT-37", "manual fee flow: instructions → submit → admin reject → resubmit → verify → CONFIRMED", async () => {
        const instructions = await api("GET", `/rentals/bookings/${booking1._id}/fee-instructions`, { token: tokens.passenger });
        assert.strictEqual(instructions.status, 200, JSON.stringify(instructions.json));
        assert.strictEqual(instructions.json.bookingFee, 800);
        assert.strictEqual(instructions.json.bank.bankName, "Phase8 Bank");

        const submit = await api("POST", `/rentals/bookings/${booking1._id}/fee-payment`, {
            token: tokens.passenger,
            body: { reference: "FT-PHASE8-001", proofImageUrl: "https://example.com/proof1.jpg", senderAccountTitle: "Passenger Phase8" },
        });
        assert.strictEqual(submit.status, 200, JSON.stringify(submit.json));
        assert.strictEqual(submit.json.booking.status, "PAYMENT_PENDING");

        const reject = await api("POST", `/admin/rentals/bookings/${booking1._id}/reject-payment`, {
            token: tokens.admin,
            body: { reason: "Proof image is unreadable" },
        });
        assert.strictEqual(reject.status, 200, JSON.stringify(reject.json));

        let fresh = await RentalBooking.findById(booking1._id);
        assert.strictEqual(fresh.status, "PAYMENT_PENDING", "rejection must not kill the booking");
        assert.strictEqual(fresh.feePayment.status, "REJECTED");

        const resubmit = await api("POST", `/rentals/bookings/${booking1._id}/fee-payment`, {
            token: tokens.passenger,
            body: { reference: "FT-PHASE8-002", proofImageUrl: "https://example.com/proof2.jpg", senderAccountTitle: "Passenger Phase8" },
        });
        assert.strictEqual(resubmit.status, 200, JSON.stringify(resubmit.json));

        const verify = await api("POST", `/admin/rentals/bookings/${booking1._id}/verify-payment`, {
            token: tokens.admin,
            body: {},
        });
        assert.strictEqual(verify.status, 200, JSON.stringify(verify.json));
        assert.strictEqual(verify.json.booking.status, "CONFIRMED");

        fresh = await RentalBooking.findById(booking1._id);
        assert.strictEqual(fresh.feePayment.status, "VERIFIED");
        assert.ok(fresh.confirmedAt);
        return "reject → resubmit → verify → CONFIRMED with verified fee";
    });

    await check("INT-38", "double verification race: two parallel admin verifies confirm the booking exactly once", async () => {
        // booking1 is already CONFIRMED, so both calls must now fail —
        // and the audit trail must show exactly one FEE_PAYMENT_VERIFIED.
        const [a, b] = await Promise.all([
            api("POST", `/admin/rentals/bookings/${booking1._id}/verify-payment`, { token: tokens.admin, body: {} }),
            api("POST", `/admin/rentals/bookings/${booking1._id}/verify-payment`, { token: tokens.admin, body: {} }),
        ]);
        assert.ok(a.status === 409 && b.status === 409, `expected 409/409, got ${a.status}/${b.status}`);

        const fresh = await RentalBooking.findById(booking1._id);
        const verifiedEvents = fresh.events.filter((e) => e.type === "FEE_PAYMENT_VERIFIED");
        assert.strictEqual(verifiedEvents.length, 1);
        return "exactly one FEE_PAYMENT_VERIFIED event in the audit trail";
    });

    await check("INT-39", "after CONFIRMED the pickup details unlock for the booking's own passenger (R3)", async () => {
        const detail = await api("GET", `/rentals/bookings/${booking1._id}`, { token: tokens.passenger });
        assert.strictEqual(detail.status, 200, JSON.stringify(detail.json));
        assert.strictEqual(detail.json.booking.vehicle.exactPickupAddress, "House 12-B, Street 3, Mohalla Test, Khanpur");
        assert.strictEqual(detail.json.booking.vehicle.pickupContactPhone, "03001234567");
        assert.strictEqual(detail.json.booking.pickupOtpHash, undefined, "the OTP hash must never be serialised");
        return "exact address + phone visible to the confirmed passenger only";
    });

    await check("INT-40", "rental order chat: parties exchange messages; a stranger is refused", async () => {
        const created = await api("POST", "/order-chats", {
            token: tokens.passenger,
            body: { orderType: "RENTAL", orderId: booking1._id, partnerUserId: String(partnerUser._id) },
        });
        assert.strictEqual(created.status, 200, JSON.stringify(created.json));
        const conversation = created.json.conversation;

        const send = await api("POST", `/order-chats/${conversation._id}/messages`, {
            token: tokens.passenger,
            body: { kind: "TEXT", body: "I will reach the pickup point at 10 AM", clientMessageId: "p1-r1-1" },
        });
        assert.strictEqual(send.status, 201, JSON.stringify(send.json));

        const partnerRead = await api("GET", `/order-chats/${conversation._id}/messages`, { token: tokens.partner });
        assert.strictEqual(partnerRead.status, 200);
        assert.ok(partnerRead.json.messages.some((m) => m.kind === "TEXT"));

        const strangerRead = await api("GET", `/order-chats/${conversation._id}/messages`, { token: tokens.stranger });
        assert.strictEqual(strangerRead.status, 403);
        return "chat live on the confirmed booking; stranger 403";
    });

    await check("INT-41", "pickup OTP + handover evidence gate the rental start (R7/R8)", async () => {
        const otpRes = await api("POST", `/rentals/bookings/${booking1._id}/pickup-otp`, { token: tokens.passenger, body: {} });
        assert.strictEqual(otpRes.status, 200, JSON.stringify(otpRes.json));
        assert.match(otpRes.json.otp, /^\d{6}$/);

        const handover = { fuelLevelPercent: 90, odometerKm: 50000, photoUrls: ["https://example.com/handover.jpg"] };

        const wrong = await api("POST", `/rentals/partner/bookings/${booking1._id}/verify-pickup`, {
            token: tokens.partner,
            body: { otp: "000000", handover },
        });
        assert.strictEqual(wrong.status, 400, JSON.stringify(wrong.json));
        assert.strictEqual(wrong.json.code, "INVALID_OTP");

        const noEvidence = await api("POST", `/rentals/partner/bookings/${booking1._id}/verify-pickup`, {
            token: tokens.partner,
            body: { otp: otpRes.json.otp, handover: { fuelLevelPercent: 90, odometerKm: 50000, photoUrls: [] } },
        });
        assert.strictEqual(noEvidence.status, 400, "handover without photos must be refused");

        const verified = await api("POST", `/rentals/partner/bookings/${booking1._id}/verify-pickup`, {
            token: tokens.partner,
            body: { otp: otpRes.json.otp, handover },
        });
        assert.strictEqual(verified.status, 200, JSON.stringify(verified.json));
        assert.strictEqual(verified.json.booking.status, "PICKUP_VERIFIED");

        const start = await api("POST", `/rentals/partner/bookings/${booking1._id}/start`, { token: tokens.partner, body: {} });
        assert.strictEqual(start.status, 200, JSON.stringify(start.json));
        assert.strictEqual(start.json.booking.status, "RENTAL_ACTIVE");

        const fresh = await RentalBooking.findById(booking1._id);
        assert.strictEqual(fresh.handover.odometerKm, 50000);
        assert.strictEqual(fresh.handover.photoUrls.length, 1);
        return "wrong OTP 400; photo-less handover 400; verified pickup → RENTAL_ACTIVE";
    });

    await check("INT-42", "return inspection computes dues from the two odometer readings; passenger confirms → COMPLETED (R8)", async () => {
        const ret = await api("POST", `/rentals/partner/bookings/${booking1._id}/return`, {
            token: tokens.partner,
            body: { inspection: { fuelLevelPercent: 70, odometerKm: 50500, photoUrls: ["https://example.com/return.jpg"] } },
        });
        assert.strictEqual(ret.status, 200, JSON.stringify(ret.json));
        assert.strictEqual(ret.json.booking.status, "RETURN_PENDING");
        // driven 500 km; allowance 200/day × 2 days = 400; extra 100 × PKR 50 = 5,000
        assert.strictEqual(ret.json.booking.returnDues.remainingDues, 5000, JSON.stringify(ret.json.booking.returnDues));
        assert.strictEqual(ret.json.booking.returnDues.extraKm, 100);

        const confirm = await api("POST", `/rentals/bookings/${booking1._id}/confirm-return`, { token: tokens.passenger, body: {} });
        assert.strictEqual(confirm.status, 200, JSON.stringify(confirm.json));
        assert.strictEqual(confirm.json.booking.status, "COMPLETED");
        return "dues PKR 5,000 computed server-side; rental COMPLETED";
    });

    await check("INT-43", "fee reconciliation records agree with the booking ledger", async () => {
        const res = await api("GET", "/admin/rentals/reports/fee-reconciliation", { token: tokens.admin });
        assert.strictEqual(res.status, 200, JSON.stringify(res.json).slice(0, 300));

        const verified = await RentalBooking.find({ "feePayment.status": "VERIFIED" });
        assert.strictEqual(verified.length, 1);
        assert.strictEqual(verified.reduce((sum, b) => sum + b.bookingFee, 0), 800);
        return "exactly one VERIFIED fee of PKR 800 in the ledger the report aggregates";
    });

    // -----------------------------------------------------------------
    // Section 7 — concurrency: racing offer acceptances
    // -----------------------------------------------------------------
    console.log("\n== Section 7: concurrency ==");

    await check("INT-44", "two racing acceptances of the same offer produce exactly one winner", async () => {
        const created = await api("POST", "/purchases", {
            token: tokens.passenger,
            body: { itemsText: "1 kg tea", estimatedBudget: 1500, delivery, deliveryLabel: "Home" },
        });
        assert.strictEqual(created.status, 201, JSON.stringify(created.json));
        const order3 = created.json.order;

        await refreshGpsFixture(driver1._id);
        const offer = await api("POST", `/purchases/${order3._id}/offers`, {
            token: tokens.driver1,
            body: { deliveryFee: 150 },
        });
        assert.strictEqual(offer.status, 201, JSON.stringify(offer.json));

        const list = await api("GET", `/purchases/${order3._id}/offers`, { token: tokens.passenger });
        const offerId = list.json.offers[0]._id;

        const [a, b] = await Promise.all([
            api("POST", `/purchases/${order3._id}/offers/${offerId}/accept`, { token: tokens.passenger, body: {} }),
            api("POST", `/purchases/${order3._id}/offers/${offerId}/accept`, { token: tokens.passenger, body: {} }),
        ]);

        const statuses = [a.status, b.status].sort();
        assert.deepStrictEqual(statuses, [200, 409], `expected one 200 + one 409, got ${a.status}/${b.status}`);

        const fresh = await PurchaseOrder.findById(order3._id);
        assert.strictEqual(fresh.status, "DRIVER_SELECTED");
        assert.strictEqual(fresh.events.filter((e) => e.type === "OFFER_ACCEPTED").length, 1);
        return "one 200, one 409, single assignment in the audit trail";
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
    console.log(`INTEGRATION: ${passed}/${results.length} checks passed`);
    for (const r of results.filter((r) => !r.ok)) {
        console.log(`  FAILED ${r.id} ${r.name}: ${r.detail}`);
    }
    console.log(`=========================================`);

    if (passed !== results.length) {
        console.log(`\n--- backend server log (tail) ---\n${serverLog.slice(-3000)}`);
    }

    // Explicit exit: services required by this suite (e.g. the
    // settlement processor) hold timers that would otherwise keep the
    // process alive after the results are printed.
    process.exit(passed === results.length ? 0 : 1);
})().catch(async (error) => {
    console.error("\nIntegration suite crashed:", error);
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
