// BE-1 FIX SUITE — ride auth gates, ride cancel paths, pricing errors,
// session rate limiter (plain node, no test framework).
//
// Boots the REAL backend (src/server.js) as a child process against a
// REAL MongoDB replica set and drives the flows over HTTP, asserting
// both API responses and resulting database state.
//
//   ITEM 2 — a driver whose ONLY approval is the per-service RIDE
//            record (services.RIDE=APPROVED, global verificationStatus
//            still PENDING) can submit a ride offer and be selected; a
//            driver with no approvals still gets 403; a legacy global
//            APPROVED driver keeps working by derivation.
//   ITEM 3 — passenger can cancel AFTER driver selection (driver freed,
//            passenger can rebook); the assigned driver can cancel an
//            assigned ride and the ride returns to REQUESTED, open for
//            new offers.
//   ITEM 9 — ride creation with no VehiclePricing for the vehicle type
//            returns 422 with a clear message, not a generic 500.
//   ITEM 10 — /auth/refresh is NOT throttled by the strict auth limiter
//            (sessionLimiter instead): >10 refreshes from one IP do
//            not produce a 429.
//
// Uses its OWN throwaway database (safar_fix_be1_test) and port (5101)
// so it never clashes with the shared stack or other suites.
//
// Run:  node tests/integration.rideAuthFixes.test.js
// Exit code 0 = every check passed, 1 = at least one failure.

const assert = require("node:assert");
const { spawn } = require("node:child_process");
const path = require("node:path");

const BACKEND_DIR = path.join(__dirname, "..");
const RS_BASE =
    process.env.TEST_MONGODB_URI ||
    "mongodb://127.0.0.1:27017/?replicaSet=rs0";
const TEST_DB = "safar_fix_be1_test";
const PORT = 5101;
const BASE = `http://127.0.0.1:${PORT}/api/v1`;
const JWT_SECRET = "be1-fix-integration-secret";

const TEST_URI = `${RS_BASE.split("?")[0].replace(/\/?$/, "")}/${TEST_DB}?${RS_BASE.split("?")[1] || "replicaSet=rs0"}`;

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

const LAT = 28.6469;
const LNG = 70.6579;
const PASSWORD = "Be1Fix!pass1";

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

    console.log("\n== Setup: replica set + backend boot + fixtures ==");

    let helloInfo = null;
    await check("BE-00", "MongoDB reachable and is a replica set", async () => {
        const client = new MongoClient(RS_BASE);
        await client.connect();
        helloInfo = await client.db("admin").command({ hello: 1 });
        await client.close();
        assert.ok(helloInfo.setName, "replica set required (transactions)");
        assert.strictEqual(helloInfo.isWritablePrimary, true);
        return `set=${helloInfo.setName}`;
    });

    if (!helloInfo) {
        console.log("\nDatabase unavailable — aborting.");
        process.exit(1);
    }

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

    const User = require("../src/models/User");
    const Driver = require("../src/models/Driver");
    const DriverDocument = require("../src/models/DriverDocument");
    const Vehicle = require("../src/models/Vehicle");
    const Ride = require("../src/models/Ride");
    const RideOffer = require("../src/models/RideOffer");
    const ServiceArea = require("../src/models/ServiceArea");
    const CommissionSettings = require("../src/models/CommissionSettings");
    const VehiclePricing = require("../src/models/VehiclePricing");

    const passwordHash = await bcrypt.hash(PASSWORD, 10);
    const mkUser = (email, role, activeMode = "PASSENGER") =>
        User.create({
            firstName: "Be1",
            lastName: email.split("@")[0],
            email,
            passwordHash,
            role,
            activeMode,
            emailVerified: true,
            status: "ACTIVE",
        });

    const passengerUser = await mkUser("passenger@be1.test", "PASSENGER");
    const passenger2User = await mkUser("passenger2@be1.test", "PASSENGER");
    const rideOnlyUser = await mkUser("rideonly@be1.test", "DRIVER", "DRIVER");
    const legacyUser = await mkUser("legacy@be1.test", "DRIVER", "DRIVER");
    const noApprovalUser = await mkUser("noapproval@be1.test", "DRIVER", "DRIVER");

    await CommissionSettings.create({
        key: "GLOBAL",
        percentage: 10,
        isActive: true,
        topUpRequired: false,
        minimumWalletBalance: 0,
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

    // Pricing exists ONLY for CAR_AC — BIKE is deliberately unpriced
    // for the ITEM 9 check.
    await VehiclePricing.create({
        vehicleType: "CAR_AC",
        baseFare: 150,
        perKmRate: 60,
        minimumFare: 200,
        isActive: true,
    });

    const futureDate = (days) => new Date(Date.now() + days * 24 * 60 * 60 * 1000);

    async function seedDriverVerification(driverId, registrationNumber) {
        const docTypes = ["CNIC_FRONT", "CNIC_BACK", "PROFILE_PHOTO", "DRIVING_LICENSE", "VEHICLE_REGISTRATION"];
        await DriverDocument.insertMany(
            docTypes.map((documentType) => ({
                driverId,
                documentType,
                imageUrl: `https://example.com/docs/${registrationNumber}/${documentType}.jpg`,
                cloudinaryPublicId: `be1/${registrationNumber}/${documentType}`,
                verificationStatus: "APPROVED",
                expiryDate: futureDate(365),
            }))
        );

        const vehicle = await Vehicle.create({
            driverId,
            vehicleType: "CAR_AC",
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

    async function refreshGps(driverId) {
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

    const baseDriverFields = {
        isOnline: true,
        isAvailable: true,
        currentLocation: { type: "Point", coordinates: [LNG, LAT] },
        lastLocationUpdate: new Date(),
    };

    // RIDE-ONLY approval: global status stays PENDING; only the
    // per-service RIDE record is APPROVED.
    const rideOnlyDriver = await Driver.create({
        userId: rideOnlyUser._id,
        verificationStatus: "PENDING",
        services: {
            RIDE: { status: "APPROVED", enabled: true },
            PARCEL: { status: "NOT_APPLIED", enabled: true },
            BUY_DELIVER: { status: "NOT_APPLIED", enabled: true },
        },
        ...baseDriverFields,
    });
    await seedDriverVerification(rideOnlyDriver._id, "BE1-1001");

    // Legacy approval: global APPROVED, per-service records untouched
    // (NOT_APPLIED) — eligibility must be DERIVED, as before Phase 2.
    const legacyDriver = await Driver.create({
        userId: legacyUser._id,
        verificationStatus: "APPROVED",
        ...baseDriverFields,
    });
    await seedDriverVerification(legacyDriver._id, "BE1-1002");

    // No approvals at all: no documents, no vehicle, nothing APPROVED.
    const noApprovalDriver = await Driver.create({
        userId: noApprovalUser._id,
        verificationStatus: "PENDING",
        ...baseDriverFields,
    });

    const tokens = {};
    await check("BE-01", "backend boots; all fixture users log in", async () => {
        await waitForServer();
        for (const [key, email] of Object.entries({
            passenger: "passenger@be1.test",
            passenger2: "passenger2@be1.test",
            rideOnly: "rideonly@be1.test",
            legacy: "legacy@be1.test",
            noApproval: "noapproval@be1.test",
        })) {
            const res = await api("POST", "/auth/login", { body: { email, password: PASSWORD } });
            assert.strictEqual(res.status, 200, `login ${email}: HTTP ${res.status} ${JSON.stringify(res.json)}`);
            assert.ok(res.json.accessToken);
            tokens[key] = res.json.accessToken;
        }
        return "5/5 logins";
    });

    const rideBody = {
        pickup: { latitude: LAT, longitude: LNG },
        destination: { latitude: LAT + 0.02, longitude: LNG + 0.01 },
        requestedPrice: 600,
        vehicleType: "CAR_AC",
    };

    async function createRide(token) {
        const res = await api("POST", "/rides", { token, body: rideBody });
        assert.strictEqual(res.status, 201, `create ride: HTTP ${res.status} ${JSON.stringify(res.json)}`);
        return res.json.ride;
    }

    // -----------------------------------------------------------------
    console.log("\n== ITEM 2: per-service RIDE approval opens the ride gates ==");

    let ride1 = null;
    let rideOnlyOffer = null;

    await check("BE-02", "passenger creates a ride; unapproved driver offer → 403", async () => {
        ride1 = await createRide(tokens.passenger);
        assert.strictEqual(ride1.status, "REQUESTED");

        await refreshGps(noApprovalDriver._id);
        const res = await api("POST", `/rides/${ride1._id}/offers`, {
            token: tokens.noApproval,
            body: { price: 550 },
        });
        assert.strictEqual(res.status, 403, `unapproved offer: HTTP ${res.status} ${JSON.stringify(res.json)}`);
        return `blocked: ${res.json.message}`;
    });

    await check("BE-03", "RIDE-only approved driver (global PENDING) can submit an offer", async () => {
        const before = await Driver.findById(rideOnlyDriver._id);
        assert.strictEqual(before.verificationStatus, "PENDING", "fixture must keep global status PENDING");
        assert.strictEqual(before.services.RIDE.status, "APPROVED");

        await refreshGps(rideOnlyDriver._id);
        const res = await api("POST", `/rides/${ride1._id}/offers`, {
            token: tokens.rideOnly,
            body: { price: 600 },
        });
        assert.strictEqual(res.status, 201, `ride-only offer: HTTP ${res.status} ${JSON.stringify(res.json)}`);
        rideOnlyOffer = res.json.offer;
        assert.ok(rideOnlyOffer?._id);
        return "offer accepted on per-service RIDE approval alone";
    });

    await check("BE-04", "passenger can SELECT the RIDE-only approved driver", async () => {
        const offers = await api("GET", `/rides/${ride1._id}/offers`, { token: tokens.passenger });
        assert.strictEqual(offers.status, 200, JSON.stringify(offers.json));
        const mine = offers.json.offers.find((o) => String(o._id) === String(rideOnlyOffer._id));
        assert.ok(mine, "the RIDE-only driver's offer must be listed");

        const res = await api("POST", `/rides/${ride1._id}/select-driver`, {
            token: tokens.passenger,
            body: { offerId: rideOnlyOffer._id },
        });
        assert.strictEqual(res.status, 200, `select: HTTP ${res.status} ${JSON.stringify(res.json)}`);

        const ride = await Ride.findById(ride1._id);
        assert.strictEqual(ride.status, "DRIVER_SELECTED");
        assert.strictEqual(String(ride.driverId), String(rideOnlyDriver._id));
        assert.strictEqual(ride.finalPrice, 600);

        const driver = await Driver.findById(rideOnlyDriver._id);
        assert.strictEqual(driver.isAvailable, false, "selection must claim the driver");
        assert.strictEqual(driver.verificationStatus, "PENDING", "global status must remain untouched");
        return "DRIVER_SELECTED at PKR 600; global status still PENDING";
    });

    await check("BE-05", "legacy global-APPROVED driver still offers by derivation; pre-selection cancel unchanged", async () => {
        const ride2 = await createRide(tokens.passenger2);

        await refreshGps(legacyDriver._id);
        const offer = await api("POST", `/rides/${ride2._id}/offers`, {
            token: tokens.legacy,
            body: { price: 600 },
        });
        assert.strictEqual(offer.status, 201, `legacy offer: HTTP ${offer.status} ${JSON.stringify(offer.json)}`);

        const cancel = await api("POST", `/rides/${ride2._id}/cancel`, { token: tokens.passenger2, body: {} });
        assert.strictEqual(cancel.status, 200, `pre-selection cancel: HTTP ${cancel.status} ${JSON.stringify(cancel.json)}`);
        assert.strictEqual(cancel.json.ride.status, "CANCELLED");
        return "legacy path intact; original cancel path intact";
    });

    // -----------------------------------------------------------------
    console.log("\n== ITEM 9: missing VehiclePricing is a clear non-500 error ==");

    await check("BE-06", "ride creation for an unpriced vehicle type → 422 naming the pricing problem", async () => {
        const res = await api("POST", "/rides", {
            token: tokens.passenger2,
            body: { ...rideBody, vehicleType: "BIKE" },
        });
        assert.strictEqual(res.status, 422, `unpriced ride: HTTP ${res.status} ${JSON.stringify(res.json)}`);
        assert.match(res.json.message, /Pricing is not available for this vehicle type/);
        return res.json.message;
    });

    // -----------------------------------------------------------------
    console.log("\n== ITEM 10: /auth/refresh is not on the strict auth limiter ==");

    await check("BE-07", "15 refresh attempts from one IP produce no 429 (sessionLimiter)", async () => {
        const bogusToken = "a".repeat(64);
        let lastStatus = null;
        for (let i = 0; i < 15; i++) {
            const res = await api("POST", "/auth/refresh", { body: { refreshToken: bogusToken } });
            assert.notStrictEqual(res.status, 429, `refresh #${i + 1} was rate-limited — sessionLimiter not applied`);
            lastStatus = res.status;
        }
        return `15/15 refreshes answered (last HTTP ${lastStatus}), zero 429s`;
    });

    // -----------------------------------------------------------------
    console.log("\n== ITEM 3: cancel paths after driver selection ==");

    let ride3 = null;

    await check("BE-08", "passenger cancels AFTER selection: ride CANCELLED, driver freed, offer closed, passenger can rebook", async () => {
        // ride1 is DRIVER_SELECTED with rideOnlyDriver (from BE-04).
        const res = await api("POST", `/rides/${ride1._id}/cancel`, { token: tokens.passenger, body: {} });
        assert.strictEqual(res.status, 200, `cancel after selection: HTTP ${res.status} ${JSON.stringify(res.json)}`);
        assert.strictEqual(res.json.ride.status, "CANCELLED");

        const offer = await RideOffer.findById(rideOnlyOffer._id);
        assert.strictEqual(offer.status, "REJECTED", "the accepted offer must be closed by a passenger cancel");

        const driver = await Driver.findById(rideOnlyDriver._id);
        assert.strictEqual(driver.isAvailable, true, "driver must be freed (isAvailable follows isOnline)");
        assert.strictEqual(driver.isOnline, true);

        const active = await api("GET", "/rides/active", { token: tokens.passenger });
        assert.strictEqual(active.status, 200, JSON.stringify(active.json));
        assert.strictEqual(active.json.ride, null, "cancelled ride must leave the passenger's active slot");

        ride3 = await createRide(tokens.passenger);
        return "CANCELLED; driver available again; new ride created immediately";
    });

    await check("BE-09", "assigned driver cancels: ride returns to REQUESTED with driver cleared and offer withdrawn", async () => {
        await refreshGps(rideOnlyDriver._id);
        const offerRes = await api("POST", `/rides/${ride3._id}/offers`, {
            token: tokens.rideOnly,
            body: { price: 600 },
        });
        assert.strictEqual(offerRes.status, 201, `offer: HTTP ${offerRes.status} ${JSON.stringify(offerRes.json)}`);

        const select = await api("POST", `/rides/${ride3._id}/select-driver`, {
            token: tokens.passenger,
            body: { offerId: offerRes.json.offer._id },
        });
        assert.strictEqual(select.status, 200, `select: HTTP ${select.status} ${JSON.stringify(select.json)}`);

        const res = await api("POST", `/rides/${ride3._id}/cancel`, { token: tokens.rideOnly, body: {} });
        assert.strictEqual(res.status, 200, `driver cancel: HTTP ${res.status} ${JSON.stringify(res.json)}`);
        assert.strictEqual(res.json.ride.status, "REQUESTED");
        assert.strictEqual(res.json.ride.driverId, null);

        const ride = await Ride.findById(ride3._id);
        assert.strictEqual(ride.status, "REQUESTED");
        assert.strictEqual(ride.driverId, null);
        assert.strictEqual(ride.finalPrice, null, "agreed price must be cleared on release");

        const offer = await RideOffer.findById(offerRes.json.offer._id);
        assert.strictEqual(offer.status, "WITHDRAWN", "the cancelling driver's accepted offer must be withdrawn");

        const driver = await Driver.findById(rideOnlyDriver._id);
        assert.strictEqual(driver.isAvailable, true, "cancelling driver must be available again");

        const driverActive = await api("GET", "/drivers/me/active-ride", { token: tokens.rideOnly });
        assert.strictEqual(driverActive.status, 200, JSON.stringify(driverActive.json));
        assert.strictEqual(driverActive.json.ride, null, "released ride must leave the driver's active slot");
        return "ride re-opened (REQUESTED, no driver, no price); offer WITHDRAWN; driver free";
    });

    await check("BE-10", "released ride accepts new offers; a non-party driver cannot cancel it; passenger pre-selection cancel still works", async () => {
        await refreshGps(legacyDriver._id);
        const offer = await api("POST", `/rides/${ride3._id}/offers`, {
            token: tokens.legacy,
            body: { price: 620 },
        });
        assert.strictEqual(offer.status, 201, `re-offer on released ride: HTTP ${offer.status} ${JSON.stringify(offer.json)}`);

        const stranger = await api("POST", `/rides/${ride3._id}/cancel`, { token: tokens.noApproval, body: {} });
        assert.strictEqual(stranger.status, 403, `non-party cancel: HTTP ${stranger.status} ${JSON.stringify(stranger.json)}`);

        const cancel = await api("POST", `/rides/${ride3._id}/cancel`, { token: tokens.passenger, body: {} });
        assert.strictEqual(cancel.status, 200, `passenger cancel of released ride: HTTP ${cancel.status} ${JSON.stringify(cancel.json)}`);
        assert.strictEqual(cancel.json.ride.status, "CANCELLED");
        return "re-search proven by a fresh offer; non-party refused 403; passenger cancel OK";
    });

    await check("BE-11", "neither party can cancel once the trip has STARTED", async () => {
        const ride4 = await createRide(tokens.passenger);

        await refreshGps(rideOnlyDriver._id);
        const offerRes = await api("POST", `/rides/${ride4._id}/offers`, {
            token: tokens.rideOnly,
            body: { price: 600 },
        });
        assert.strictEqual(offerRes.status, 201, JSON.stringify(offerRes.json));

        const select = await api("POST", `/rides/${ride4._id}/select-driver`, {
            token: tokens.passenger,
            body: { offerId: offerRes.json.offer._id },
        });
        assert.strictEqual(select.status, 200, JSON.stringify(select.json));

        for (const status of ["DRIVER_EN_ROUTE", "DRIVER_ARRIVED", "TRIP_STARTED"]) {
            const step = await api("PATCH", `/rides/${ride4._id}/status`, {
                token: tokens.rideOnly,
                body: { status },
            });
            assert.strictEqual(step.status, 200, `trip step ${status}: HTTP ${step.status} ${JSON.stringify(step.json)}`);
        }

        const passengerCancel = await api("POST", `/rides/${ride4._id}/cancel`, { token: tokens.passenger, body: {} });
        assert.strictEqual(passengerCancel.status, 409, `passenger cancel after start: HTTP ${passengerCancel.status}`);

        const driverCancel = await api("POST", `/rides/${ride4._id}/cancel`, { token: tokens.rideOnly, body: {} });
        assert.strictEqual(driverCancel.status, 409, `driver cancel after start: HTTP ${driverCancel.status}`);

        const complete = await api("PATCH", `/rides/${ride4._id}/status`, {
            token: tokens.rideOnly,
            body: { status: "TRIP_COMPLETED" },
        });
        assert.strictEqual(complete.status, 200, `completion cleanup: HTTP ${complete.status} ${JSON.stringify(complete.json)}`);
        return "both cancels refused 409 at TRIP_STARTED; trip completed normally";
    });

    // -----------------------------------------------------------------
    const failed = results.filter((r) => !r.ok);
    console.log(`\n${results.length - failed.length}/${results.length} checks passed`);

    try {
        await mongoose.connection.db.dropDatabase();
    } catch { /* best effort */ }
    await mongoose.disconnect().catch(() => {});
    if (serverProcess) serverProcess.kill("SIGTERM");

    process.exit(failed.length ? 1 : 0);
})().catch(async (error) => {
    console.error("Suite aborted:", error);
    if (serverProcess) serverProcess.kill("SIGTERM");
    process.exit(1);
});
