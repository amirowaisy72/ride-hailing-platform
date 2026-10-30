// Phase 2 (Amir review A13/A14) — DATABASE-BACKED INTEGRATION TESTS
// for the Buy & Deliver budget-cap approval model + optional receipt
// (plain node, no test framework; harness copied from
// tests/integration.phase8.test.js).
//
// These tests boot the REAL backend (src/server.js) as a child process
// against a REAL MongoDB replica set and drive the purchase flow over
// HTTP, asserting both API responses and database state:
//
//   CAP-03/04/05/06 (a) WITHIN CAP — estimate <= the passenger's stated
//     budget auto-approves (SHOPPING -> PURCHASE_APPROVED,
//     estimateApprovalSource="BUDGET_CAP", approvedMaxAmount = the
//     stated budget) with NO passenger approval call; passenger
//     approve/reject on such an order are cleanly refused (409) by the
//     existing status guards; an actual spend above the budget ceiling
//     is blocked; >6 receipt photos are blocked; and recording the
//     purchase with actual <= ceiling and ZERO receipt photos succeeds.
//   CAP-07/08/09 (b)+(c) OVER CAP — estimate > budget lands in
//     AWAITING_APPROVAL; recording a purchase before passenger approval
//     is rejected (409); after explicit passenger approval
//     (estimateApprovalSource="PASSENGER") the flow proceeds as before,
//     INCLUDING the cost-increase cycle PURCHASE_APPROVED ->
//     AWAITING_APPROVAL and a passenger rejection back to SHOPPING;
//     the final purchase (with a receipt photo) succeeds.
//
// PREREQUISITE — a MongoDB replica set reachable at TEST_MONGODB_URI
// (default mongodb://127.0.0.1:27017/?replicaSet=rs0), same as the
// Phase 8 suite. Uses one THROWAWAY database
// (safar_p2_capmodel_test), dropped before/after itself.
//
// Run:  node tests/purchaseBudgetCap.integration.test.js
// Exit code 0 = every check passed, 1 = at least one failure.

const assert = require("node:assert");
const { spawn } = require("node:child_process");
const path = require("node:path");

const BACKEND_DIR = path.join(__dirname, "..");
const RS_BASE =
    process.env.TEST_MONGODB_URI ||
    "mongodb://127.0.0.1:27017/?replicaSet=rs0";
const TEST_DB = "safar_p2_capmodel_test";
const PORT = 5719;
const BASE = `http://127.0.0.1:${PORT}/api/v1`;
const JWT_SECRET = "p2-capmodel-integration-secret";

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
const PASSWORD = "CapModel!pass1";
const delivery = { latitude: LAT, longitude: LNG, address: "Mohalla Test, Khanpur" };

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

    console.log("\n== Section 0: replica-set database + backend boot ==");

    let helloInfo = null;
    await check("CAP-00", "MongoDB reachable and is a replica set", async () => {
        const client = new MongoClient(RS_BASE);
        await client.connect();
        helloInfo = await client.db("admin").command({ hello: 1 });
        await client.close();

        assert.ok(helloInfo.setName, "no replica set name");
        assert.strictEqual(helloInfo.isWritablePrimary, true);
        return `set=${helloInfo.setName}`;
    });

    if (!helloInfo) {
        console.log("\nDatabase unavailable — aborting (nothing else can run).");
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
    const ServiceArea = require("../src/models/ServiceArea");
    const CommissionSettings = require("../src/models/CommissionSettings");
    const PurchaseOrder = require("../src/models/PurchaseOrder");

    const passwordHash = await bcrypt.hash(PASSWORD, 10);
    const mkUser = (email, role, activeMode = "PASSENGER") =>
        User.create({
            firstName: "CapModel",
            lastName: email.split("@")[0],
            email,
            passwordHash,
            role,
            activeMode,
            emailVerified: true,
            status: "ACTIVE",
        });

    await mkUser("admin@capmodel.test", "ADMIN");
    await mkUser("passenger@capmodel.test", "PASSENGER");
    const driverUser = await mkUser("driver@capmodel.test", "DRIVER", "DRIVER");

    await CommissionSettings.create({
        key: "GLOBAL",
        percentage: 10,
        isActive: true,
        topUpRequired: false,
        minimumWalletBalance: 0,
        bankName: "CapModel Bank",
        bankAccountTitle: "Safar Platform",
        bankAccountNumber: "PK00 CAP 0001",
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
    let driver = null;

    await check("CAP-01", "backend boots; fixture users log in through the real auth API", async () => {
        await waitForServer();
        for (const [key, email] of Object.entries({
            admin: "admin@capmodel.test",
            passenger: "passenger@capmodel.test",
            driver: "driver@capmodel.test",
        })) {
            const res = await api("POST", "/auth/login", { body: { email, password: PASSWORD } });
            assert.strictEqual(res.status, 200, `login ${email}: HTTP ${res.status} ${JSON.stringify(res.json)}`);
            assert.ok(res.json.accessToken);
            tokens[key] = res.json.accessToken;
        }
        return "3/3 logins issued JWTs";
    });

    const futureDate = (days) => new Date(Date.now() + days * 24 * 60 * 60 * 1000);

    async function refreshGpsFixture(driverId) {
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

    await check("CAP-02", "partner becomes Buy & Deliver eligible (register, documents, apply, admin approval, online, GPS)", async () => {
        const reg = await api("POST", "/drivers/register", { token: tokens.driver, body: {} });
        assert.strictEqual(reg.status, 201, JSON.stringify(reg.json));

        driver = await Driver.findOne({ userId: driverUser._id });
        assert.ok(driver);

        const docTypes = ["CNIC_FRONT", "CNIC_BACK", "PROFILE_PHOTO", "DRIVING_LICENSE", "VEHICLE_REGISTRATION"];
        await DriverDocument.insertMany(
            docTypes.map((documentType) => ({
                driverId: driver._id,
                documentType,
                imageUrl: `https://example.com/docs/CAP-1001/${documentType}.jpg`,
                cloudinaryPublicId: `capmodel/CAP-1001/${documentType}`,
                verificationStatus: "APPROVED",
                expiryDate: futureDate(365),
            }))
        );

        const vehicle = await Vehicle.create({
            driverId: driver._id,
            vehicleType: "CAR_AC",
            registrationNumber: "CAP-1001",
            make: "Toyota",
            model: "Corolla",
            color: "White",
            modelYear: 2022,
            verificationStatus: "APPROVED",
            isActive: true,
            registrationExpiryDate: futureDate(365),
        });
        await Driver.updateOne({ _id: driver._id }, { $set: { currentVehicleId: vehicle._id } });

        const apply = await api("POST", "/drivers/me/services/BUY_DELIVER/apply", {
            token: tokens.driver,
            body: { transportMode: "CAR", policyAcknowledged: true },
        });
        assert.strictEqual(apply.status, 200, JSON.stringify(apply.json));
        assert.strictEqual(apply.json.service.applicationStatus, "PENDING");

        const approveService = await api("PATCH", `/admin/drivers/${driver._id}/services/BUY_DELIVER/status`, {
            token: tokens.admin,
            body: { status: "APPROVED", purchaseLimit: 50000 },
        });
        assert.strictEqual(approveService.status, 200, JSON.stringify(approveService.json));

        const approveGlobal = await api("PATCH", `/admin/drivers/${driver._id}/status`, {
            token: tokens.admin,
            body: { status: "APPROVED" },
        });
        assert.strictEqual(approveGlobal.status, 200, JSON.stringify(approveGlobal.json));

        const online = await api("PATCH", "/drivers/me/online-status", {
            token: tokens.driver,
            body: { isOnline: true },
        });
        assert.strictEqual(online.status, 200, JSON.stringify(online.json));

        const loc = await api("PATCH", "/drivers/me/location", {
            token: tokens.driver,
            body: { latitude: LAT, longitude: LNG },
        });
        assert.strictEqual(loc.status, 200, JSON.stringify(loc.json));
        return "eligible partner online with fresh GPS, purchase limit PKR 50,000";
    });

    // Drives a fresh order to SHOPPING with this partner assigned.
    async function driveToShopping(budget, itemsText) {
        const created = await api("POST", "/purchases", {
            token: tokens.passenger,
            body: { itemsText, estimatedBudget: budget, delivery, deliveryLabel: "Home" },
        });
        assert.strictEqual(created.status, 201, JSON.stringify(created.json));
        const order = created.json.order;
        assert.strictEqual(order.status, "BIDDING");
        assert.strictEqual(order.estimateApprovalSource ?? null, null);

        await refreshGpsFixture(driver._id);
        const offer = await api("POST", `/purchases/${order._id}/offers`, {
            token: tokens.driver,
            body: { deliveryFee: 300 },
        });
        assert.strictEqual(offer.status, 201, JSON.stringify(offer.json));

        const list = await api("GET", `/purchases/${order._id}/offers`, { token: tokens.passenger });
        assert.strictEqual(list.json.offers.length, 1);

        const accept = await api("POST", `/purchases/${order._id}/offers/${list.json.offers[0]._id}/accept`, {
            token: tokens.passenger,
            body: {},
        });
        assert.strictEqual(accept.status, 200, JSON.stringify(accept.json));
        assert.strictEqual(accept.json.order.status, "DRIVER_SELECTED");

        const start = await api("PATCH", `/purchases/${order._id}/start-shopping`, {
            token: tokens.driver,
            body: {},
        });
        assert.strictEqual(start.status, 200, JSON.stringify(start.json));
        assert.strictEqual(start.json.order.status, "SHOPPING");
        return order;
    }

    console.log("\n== Section 1: within-cap auto-approval (a) ==");

    let capOrder = null;
    await check("CAP-03", "within-cap: estimate 2500 <= budget 3000 auto-approves as BUDGET_CAP with NO passenger approval call", async () => {
        capOrder = await driveToShopping(3000, "2 kg sugar, 1 litre milk");

        const estimate = await api("POST", `/purchases/${capOrder._id}/cost-estimate`, {
            token: tokens.driver,
            body: { amount: 2500 },
        });
        assert.strictEqual(estimate.status, 200, JSON.stringify(estimate.json));
        assert.strictEqual(estimate.json.order.status, "PURCHASE_APPROVED");
        assert.strictEqual(estimate.json.order.estimateApprovalSource, "BUDGET_CAP");
        assert.strictEqual(
            estimate.json.order.approvedMaxAmount,
            3000,
            "the recorded ceiling is the passenger's stated budget (the cap), not the estimate"
        );
        assert.strictEqual(estimate.json.order.estimatedCost, 2500);

        const fresh = await PurchaseOrder.findById(capOrder._id);
        assert.strictEqual(fresh.status, "PURCHASE_APPROVED");
        assert.strictEqual(fresh.estimateApprovalSource, "BUDGET_CAP");
        assert.ok(
            !fresh.events.some((e) => e.type === "AMOUNT_APPROVED"),
            "no passenger AMOUNT_APPROVED event may exist — no passenger approval call was made"
        );
        const autoEvent = fresh.events.find((e) => e.type === "ESTIMATE_AUTO_APPROVED");
        assert.ok(autoEvent, "an ESTIMATE_AUTO_APPROVED audit event must be recorded");
        assert.strictEqual(autoEvent.actorRole, "SYSTEM");

        // Passenger visibility: the passenger-facing detail endpoint
        // serializes the approval source.
        const detail = await api("GET", `/purchases/${capOrder._id}`, { token: tokens.passenger });
        assert.strictEqual(detail.status, 200, JSON.stringify(detail.json));
        assert.strictEqual(detail.json.order.status, "PURCHASE_APPROVED");
        assert.strictEqual(detail.json.order.estimateApprovalSource, "BUDGET_CAP");
        assert.strictEqual(detail.json.order.approvedMaxAmount, 3000);
        return "PURCHASE_APPROVED via BUDGET_CAP; ceiling = budget 3000; passenger detail exposes the source";
    });

    await check("CAP-04", "passenger approve/reject on a cap-auto-approved order are cleanly refused (409) and change nothing", async () => {
        const approve = await api("POST", `/purchases/${capOrder._id}/approve-amount`, {
            token: tokens.passenger,
            body: { amount: 2500 },
        });
        assert.strictEqual(approve.status, 409, JSON.stringify(approve.json));

        const reject = await api("POST", `/purchases/${capOrder._id}/reject-estimate`, {
            token: tokens.passenger,
            body: {},
        });
        assert.strictEqual(reject.status, 409, JSON.stringify(reject.json));

        const fresh = await PurchaseOrder.findById(capOrder._id);
        assert.strictEqual(fresh.status, "PURCHASE_APPROVED");
        assert.strictEqual(fresh.estimateApprovalSource, "BUDGET_CAP");
        assert.strictEqual(fresh.approvedMaxAmount, 3000);
        return "both endpoints 409 via the existing AWAITING_APPROVAL status guard; order untouched";
    });

    await check("CAP-05", "over-ceiling spend and >6 receipt photos are blocked before any purchase is recorded (c)", async () => {
        const above = await api("POST", `/purchases/${capOrder._id}/purchased`, {
            token: tokens.driver,
            body: { actualCost: 3100, receiptImageUrls: [] },
        });
        assert.strictEqual(above.status, 409, JSON.stringify(above.json));
        assert.strictEqual(above.json.code, "ABOVE_APPROVED_AMOUNT");

        const tooMany = await api("POST", `/purchases/${capOrder._id}/purchased`, {
            token: tokens.driver,
            body: {
                actualCost: 2800,
                receiptImageUrls: Array.from(
                    { length: 7 },
                    (_, i) => `https://example.com/r${i}.jpg`
                ),
            },
        });
        assert.strictEqual(tooMany.status, 400, JSON.stringify(tooMany.json));
        assert.strictEqual(tooMany.json.code, "INVALID_RECEIPT_URLS");

        const badUrl = await api("POST", `/purchases/${capOrder._id}/purchased`, {
            token: tokens.driver,
            body: { actualCost: 2800, receiptImageUrls: [""] },
        });
        assert.strictEqual(badUrl.status, 400, JSON.stringify(badUrl.json));

        const fresh = await PurchaseOrder.findById(capOrder._id);
        assert.strictEqual(fresh.status, "PURCHASE_APPROVED");
        assert.strictEqual(fresh.actualCost, null);
        return "3100 > ceiling 3000 refused; 7 photos refused; empty URL refused; nothing recorded";
    });

    await check("CAP-06", "record purchase at 2800 (above estimate, at/below budget) with NO receipt photos succeeds", async () => {
        const ok = await api("POST", `/purchases/${capOrder._id}/purchased`, {
            token: tokens.driver,
            body: { actualCost: 2800 },
        });
        assert.strictEqual(ok.status, 200, JSON.stringify(ok.json));
        assert.strictEqual(ok.json.order.status, "PURCHASED");
        assert.deepStrictEqual(ok.json.order.receiptImageUrls, []);
        assert.strictEqual(ok.json.order.actualCost, 2800);
        assert.strictEqual(
            ok.json.order.customerTotalPayable,
            3100,
            "payable = shopping 2800 + delivery fee 300"
        );
        return "PURCHASED with zero receipt photos; payable PKR 3,100";
    });

    console.log("\n== Section 2: over-cap passenger approval path (b) ==");

    let overOrder = null;
    await check("CAP-07", "over-cap: estimate 2500 > budget 2000 lands in AWAITING_APPROVAL; purchase before approval rejected", async () => {
        overOrder = await driveToShopping(2000, "1 kg rice, 500 g daal");

        const estimate = await api("POST", `/purchases/${overOrder._id}/cost-estimate`, {
            token: tokens.driver,
            body: { amount: 2500 },
        });
        assert.strictEqual(estimate.status, 200, JSON.stringify(estimate.json));
        assert.strictEqual(estimate.json.order.status, "AWAITING_APPROVAL");
        assert.strictEqual(estimate.json.order.estimateApprovalSource ?? null, null);
        assert.strictEqual(estimate.json.order.approvedMaxAmount ?? null, null);

        const early = await api("POST", `/purchases/${overOrder._id}/purchased`, {
            token: tokens.driver,
            body: { actualCost: 2400 },
        });
        assert.strictEqual(early.status, 409, "purchase before passenger approval must be impossible");
        return "AWAITING_APPROVAL with no approval source/ceiling; early purchase 409";
    });

    await check("CAP-08", "passenger approval proceeds as before (source PASSENGER); cost-increase + rejection cycle intact", async () => {
        const approve = await api("POST", `/purchases/${overOrder._id}/approve-amount`, {
            token: tokens.passenger,
            body: { amount: 2500 },
        });
        assert.strictEqual(approve.status, 200, JSON.stringify(approve.json));
        assert.strictEqual(approve.json.order.status, "PURCHASE_APPROVED");
        assert.strictEqual(approve.json.order.estimateApprovalSource, "PASSENGER");
        assert.strictEqual(approve.json.order.approvedMaxAmount, 2500);
        assert.ok(approve.json.order.codAcknowledgedAt, "explicit passenger approval still records the COD acknowledgment");

        // Increase above the approved ceiling loops back to the passenger.
        const increase = await api("POST", `/purchases/${overOrder._id}/cost-estimate`, {
            token: tokens.driver,
            body: { amount: 2600 },
        });
        assert.strictEqual(increase.status, 200, JSON.stringify(increase.json));
        assert.strictEqual(increase.json.order.status, "AWAITING_APPROVAL");

        // Passenger rejection returns the order to SHOPPING, as before.
        const reject = await api("POST", `/purchases/${overOrder._id}/reject-estimate`, {
            token: tokens.passenger,
            body: {},
        });
        assert.strictEqual(reject.status, 200, JSON.stringify(reject.json));
        assert.strictEqual(reject.json.order.status, "SHOPPING");

        // Re-submit + re-approve restores the approved state.
        const again = await api("POST", `/purchases/${overOrder._id}/cost-estimate`, {
            token: tokens.driver,
            body: { amount: 2500 },
        });
        assert.strictEqual(again.status, 200, JSON.stringify(again.json));
        assert.strictEqual(again.json.order.status, "AWAITING_APPROVAL");

        const approve2 = await api("POST", `/purchases/${overOrder._id}/approve-amount`, {
            token: tokens.passenger,
            body: { amount: 2500 },
        });
        assert.strictEqual(approve2.status, 200, JSON.stringify(approve2.json));
        assert.strictEqual(approve2.json.order.status, "PURCHASE_APPROVED");
        assert.strictEqual(approve2.json.order.estimateApprovalSource, "PASSENGER");
        return "PASSENGER approval, increase -> AWAITING_APPROVAL, reject -> SHOPPING, re-approval all unchanged";
    });

    await check("CAP-09", "after passenger approval the purchase proceeds WITH a receipt photo, as before", async () => {
        const ok = await api("POST", `/purchases/${overOrder._id}/purchased`, {
            token: tokens.driver,
            body: {
                actualCost: 2400,
                receiptImageUrls: ["https://example.com/receipt-over.jpg"],
            },
        });
        assert.strictEqual(ok.status, 200, JSON.stringify(ok.json));
        assert.strictEqual(ok.json.order.status, "PURCHASED");
        assert.deepStrictEqual(ok.json.order.receiptImageUrls, [
            "https://example.com/receipt-over.jpg",
        ]);
        assert.strictEqual(ok.json.order.customerTotalPayable, 2700);
        return "PURCHASED with receipt stored; payable PKR 2,700";
    });

    // -----------------------------------------------------------------
    // Wrap-up (same pattern as integration.phase8)
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
    console.log(`CAPMODEL INTEGRATION: ${passed}/${results.length} checks passed`);
    for (const r of results.filter((r) => !r.ok)) {
        console.log(`  FAILED ${r.id} ${r.name}: ${r.detail}`);
    }
    console.log(`=========================================`);

    if (passed !== results.length) {
        console.log(`\n--- backend server log (tail) ---\n${serverLog.slice(-3000)}`);
    }

    process.exit(passed === results.length ? 0 : 1);
})().catch(async (error) => {
    console.error("\nCap-model integration suite crashed:", error);
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
