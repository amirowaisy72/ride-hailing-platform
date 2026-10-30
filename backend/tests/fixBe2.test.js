// fix/be-purchases — DB-backed integration checks for:
//   ITEM 11  BD offer TTL 30 min + expired-offer visibility markers
//   ITEM 12  GPS freshness window 10 min + code "GPS_STALE"
//   ITEM 6   BD estimatedBudget cap at order creation
//   ITEM 7   driver earnings: summary == by-service totals
//   ITEM 14  GET /order-chats/unread/counts for a driver caller
//
// Plain node, modelled on tests/integration.phase8.test.js. Boots the
// REAL backend against a throwaway DB (safar_fix_be2_test) on port
// 5102 and drives everything over HTTP; direct DB writes are used
// only to backdate timestamps / seed settlements (fixture actions).
//
// Run:  node tests/fixBe2.test.js   (exit 0 = pass)

const assert = require("node:assert");
const { spawn } = require("node:child_process");
const path = require("node:path");

const BACKEND_DIR = path.join(__dirname, "..");
const RS_BASE =
    process.env.TEST_MONGODB_URI ||
    "mongodb://127.0.0.1:27017/?replicaSet=rs0";
const TEST_DB = "safar_fix_be2_test";
const PORT = 5102;
const BASE = `http://127.0.0.1:${PORT}/api/v1`;
const JWT_SECRET = "fix-be2-integration-secret";
const TEST_URI = `${RS_BASE.split("?")[0].replace(/\/?$/, "")}/${TEST_DB}?${RS_BASE.split("?")[1] || "replicaSet=rs0"}`;

const results = [];
async function check(id, name, fn) {
    try {
        const detail = await fn();
        results.push({ id, ok: true });
        console.log(`  PASS  ${id}  ${name}${detail ? ` — ${detail}` : ""}`);
    } catch (error) {
        results.push({ id, ok: false });
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
const PASSWORD = "FixBe2!pass1";
const delivery = { latitude: LAT, longitude: LNG, address: "Mohalla Test, Khanpur" };

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
    throw new Error(`backend did not become healthy. Log tail:\n${serverLog.slice(-2000)}`);
}

(async () => {
    const mongoose = require("mongoose");
    const bcrypt = require("bcryptjs");
    const { ObjectId } = require("mongodb");

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
    serverProcess.stdout.on("data", (d) => {
        serverLog += d;
    });
    serverProcess.stderr.on("data", (d) => {
        serverLog += d;
    });

    await check("BE2-00", "backend boots against the replica set", async () => {
        await waitForServer();
        return "healthy on :5102";
    });

    // --- fixtures ------------------------------------------------------
    const User = require("../src/models/User");
    const Driver = require("../src/models/Driver");
    const DriverDocument = require("../src/models/DriverDocument");
    const Vehicle = require("../src/models/Vehicle");
    const ServiceArea = require("../src/models/ServiceArea");
    const CommissionSettings = require("../src/models/CommissionSettings");
    const PurchaseOffer = require("../src/models/PurchaseOffer");
    const RideSettlement = require("../src/models/RideSettlement");
    const ParcelSettlement = require("../src/models/ParcelSettlement");
    const PurchaseSettlement = require("../src/models/PurchaseSettlement");

    const passwordHash = await bcrypt.hash(PASSWORD, 10);
    const mkUser = (email, role, activeMode = "PASSENGER") =>
        User.create({
            firstName: "FixBe2",
            lastName: email.split("@")[0],
            email,
            passwordHash,
            role,
            activeMode,
            emailVerified: true,
            status: "ACTIVE",
        });

    await mkUser("admin@fixbe2.test", "ADMIN");
    await mkUser("passenger@fixbe2.test", "PASSENGER");
    const driverUser = await mkUser("driver1@fixbe2.test", "DRIVER", "DRIVER");

    await CommissionSettings.create({
        key: "GLOBAL",
        percentage: 10,
        isActive: true,
        topUpRequired: false,
        minimumWalletBalance: 0,
        buyDeliverEnabled: true,
        buyDeliverMaxOrderValue: 5000,
        buyDeliverRadiusKm: 15,
        rentalsEnabled: true,
        rentalBookingFeePercent: 5,
        rentalsSelfDriveEnabled: false,
    });

    await ServiceArea.create({
        name: "Khanpur Test Area",
        city: "Khanpur",
        active: true,
        polygon: {
            type: "Polygon",
            coordinates: [
                [
                    [LNG - 0.11, LAT - 0.1],
                    [LNG + 0.11, LAT - 0.1],
                    [LNG + 0.11, LAT + 0.1],
                    [LNG - 0.11, LAT + 0.1],
                    [LNG - 0.11, LAT - 0.1],
                ],
            ],
        },
    });

    const tokens = {};
    for (const [key, email] of Object.entries({
        admin: "admin@fixbe2.test",
        passenger: "passenger@fixbe2.test",
        driver1: "driver1@fixbe2.test",
    })) {
        const res = await api("POST", "/auth/login", { body: { email, password: PASSWORD } });
        assert.strictEqual(res.status, 200, `login ${email}: ${JSON.stringify(res.json)}`);
        tokens[key] = res.json.accessToken;
    }

    const futureDate = (days) => new Date(Date.now() + days * 24 * 60 * 60 * 1000);

    let driver1 = null;
    await check("BE2-SETUP", "driver fully approved (BD service + legacy) and online with fresh GPS", async () => {
        const reg = await api("POST", "/drivers/register", { token: tokens.driver1, body: {} });
        assert.strictEqual(reg.status, 201, JSON.stringify(reg.json));
        driver1 = await Driver.findOne({ userId: driverUser._id });
        assert.ok(driver1);

        await DriverDocument.insertMany(
            ["CNIC_FRONT", "CNIC_BACK", "PROFILE_PHOTO", "DRIVING_LICENSE", "VEHICLE_REGISTRATION"].map(
                (documentType) => ({
                    driverId: driver1._id,
                    documentType,
                    imageUrl: `https://example.com/docs/${documentType}.jpg`,
                    cloudinaryPublicId: `fixbe2/${documentType}`,
                    verificationStatus: "APPROVED",
                    expiryDate: futureDate(365),
                })
            )
        );
        const vehicle = await Vehicle.create({
            driverId: driver1._id,
            vehicleType: "CAR_AC",
            registrationNumber: "BE2-1001",
            make: "Toyota",
            model: "Corolla",
            color: "White",
            modelYear: 2022,
            verificationStatus: "APPROVED",
            isActive: true,
            registrationExpiryDate: futureDate(365),
        });
        await Driver.updateOne({ _id: driver1._id }, { $set: { currentVehicleId: vehicle._id } });

        const apply = await api("POST", "/drivers/me/services/BUY_DELIVER/apply", {
            token: tokens.driver1,
            body: { transportMode: "CAR", policyAcknowledged: true },
        });
        assert.strictEqual(apply.json.service.applicationStatus, "PENDING", JSON.stringify(apply.json));

        const svc = await api("PATCH", `/admin/drivers/${driver1._id}/services/BUY_DELIVER/status`, {
            token: tokens.admin,
            body: { status: "APPROVED", purchaseLimit: 50000 },
        });
        assert.strictEqual(svc.status, 200, JSON.stringify(svc.json));

        const legacy = await api("PATCH", `/admin/drivers/${driver1._id}/status`, {
            token: tokens.admin,
            body: { status: "APPROVED" },
        });
        assert.strictEqual(legacy.status, 200, JSON.stringify(legacy.json));

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
        return "driver ready";
    });

    const setGpsAge = (msAgo) =>
        Driver.updateOne(
            { _id: driver1._id },
            { $set: { lastLocationUpdate: new Date(Date.now() - msAgo) } }
        );
    const refreshGps = () => setGpsAge(0);

    const createOrder = (estimatedBudget) =>
        api("POST", "/purchases", {
            token: tokens.passenger,
            body: { itemsText: "2 kg sugar, 1 litre milk", estimatedBudget, delivery, deliveryLabel: "Home" },
        });

    // --- ITEM 6 --------------------------------------------------------
    console.log("\n== ITEM 6: budget cap at creation (cap = PKR 5,000) ==");
    await check("BE2-01", "over-cap budget (250,500) rejected 400 naming the maximum", async () => {
        const res = await createOrder(250500);
        assert.strictEqual(res.status, 400, JSON.stringify(res.json));
        assert.ok(
            String(res.json.message).includes("5000"),
            `message must name the maximum, got: ${res.json.message}`
        );
        return `message: ${res.json.message}`;
    });

    await check("BE2-02", "at-cap budget (5,000) accepted", async () => {
        const res = await createOrder(5000);
        assert.strictEqual(res.status, 201, JSON.stringify(res.json));
        const cancel = await api("PATCH", `/purchases/${res.json.order._id}/cancel`, {
            token: tokens.passenger,
            body: {},
        });
        assert.strictEqual(cancel.status, 200);
        return "created then cancelled for cleanup";
    });

    await check("BE2-03", "no cap configured (null) keeps previous behaviour", async () => {
        await CommissionSettings.updateOne({ key: "GLOBAL" }, { $set: { buyDeliverMaxOrderValue: null } });
        try {
            const res = await createOrder(250500);
            assert.strictEqual(res.status, 201, JSON.stringify(res.json));
            await api("PATCH", `/purchases/${res.json.order._id}/cancel`, {
                token: tokens.passenger,
                body: {},
            });
        } finally {
            await CommissionSettings.updateOne({ key: "GLOBAL" }, { $set: { buyDeliverMaxOrderValue: 100000 } });
        }
        return "250,500 accepted with cap=null; cap restored to 100,000";
    });

    // --- ITEM 12 -------------------------------------------------------
    console.log("\n== ITEM 12: GPS freshness 10 min + GPS_STALE ==");
    await check("BE2-04", "5-minute-old GPS passes BOTH parcel and purchase feed gates", async () => {
        await setGpsAge(5 * 60 * 1000);
        const purchases = await api("GET", "/purchases/available", { token: tokens.driver1 });
        assert.strictEqual(purchases.status, 200, JSON.stringify(purchases.json));
        const parcels = await api("GET", "/parcels/available", { token: tokens.driver1 });
        assert.strictEqual(parcels.status, 200, JSON.stringify(parcels.json));
        return "both feeds 200 at 5 min (previously 403 at >2 min)";
    });

    await check("BE2-05", "11-minute-old GPS rejected 403 with code GPS_STALE on BOTH gates", async () => {
        await setGpsAge(11 * 60 * 1000);
        for (const route of ["/purchases/available", "/parcels/available"]) {
            const res = await api("GET", route, { token: tokens.driver1 });
            assert.strictEqual(res.status, 403, `${route}: ${JSON.stringify(res.json)}`);
            assert.strictEqual(res.json.code, "GPS_STALE", `${route} code`);
            assert.strictEqual(res.json.message, "Fresh driver GPS location required", `${route} message`);
        }
        await refreshGps();
        return "code + exact message on both middlewares";
    });

    // --- ITEM 11 -------------------------------------------------------
    console.log("\n== ITEM 11: offer TTL 30 min + expired visibility ==");
    let orderA = null;
    await check("BE2-06", "new offer lives 30 minutes (TTL)", async () => {
        const created = await createOrder(2000);
        assert.strictEqual(created.status, 201, JSON.stringify(created.json));
        orderA = created.json.order;

        await refreshGps();
        const offer = await api("POST", `/purchases/${orderA._id}/offers`, {
            token: tokens.driver1,
            body: { deliveryFee: 300 },
        });
        assert.strictEqual(offer.status, 201, JSON.stringify(offer.json));
        const ttlMs = new Date(offer.json.offer.expiresAt).getTime() - Date.now();
        assert.ok(ttlMs > 29 * 60 * 1000 && ttlMs <= 30 * 60 * 1000 + 5000, `TTL was ${Math.round(ttlMs / 1000)}s`);
        return `expiresAt - now ≈ ${Math.round(ttlMs / 60000)} min`;
    });

    await check("BE2-07", "passenger offers: live offer carries expired:false", async () => {
        const list = await api("GET", `/purchases/${orderA._id}/offers`, { token: tokens.passenger });
        assert.strictEqual(list.status, 200, JSON.stringify(list.json));
        assert.strictEqual(list.json.offers.length, 1);
        assert.strictEqual(list.json.offers[0].expired, false);
        return "live offer visible, expired:false";
    });

    await check("BE2-08", "passenger offers: offer expired 30 min ago still listed with expired:true; at 2 h it is gone", async () => {
        await PurchaseOffer.updateOne(
            { orderId: orderA._id, driverId: driver1._id },
            { $set: { expiresAt: new Date(Date.now() - 30 * 60 * 1000) } }
        );
        let list = await api("GET", `/purchases/${orderA._id}/offers`, { token: tokens.passenger });
        assert.strictEqual(list.json.offers.length, 1, JSON.stringify(list.json));
        assert.strictEqual(list.json.offers[0].expired, true);

        await PurchaseOffer.updateOne(
            { orderId: orderA._id, driverId: driver1._id },
            { $set: { expiresAt: new Date(Date.now() - 2 * 60 * 60 * 1000) } }
        );
        list = await api("GET", `/purchases/${orderA._id}/offers`, { token: tokens.passenger });
        assert.strictEqual(list.json.offers.length, 0, "offers expired >60 min ago must stay hidden");
        return "30 min ago → listed expired:true; 2 h ago → hidden";
    });

    await check("BE2-09", "driver feed embeds own EXPIRED offer with expired:true and own LIVE offer with expired:false", async () => {
        const mkOrderWithOffer = async (fee) => {
            const created = await createOrder(2000);
            assert.strictEqual(created.status, 201, JSON.stringify(created.json));
            await refreshGps();
            const offer = await api("POST", `/purchases/${created.json.order._id}/offers`, {
                token: tokens.driver1,
                body: { deliveryFee: fee },
            });
            assert.strictEqual(offer.status, 201, JSON.stringify(offer.json));
            return created.json.order;
        };

        const expiredOrder = await mkOrderWithOffer(280);
        await PurchaseOffer.updateOne(
            { orderId: expiredOrder._id, driverId: driver1._id },
            { $set: { expiresAt: new Date(Date.now() - 10 * 60 * 1000) } }
        );
        const liveOrder = await mkOrderWithOffer(320);

        await refreshGps();
        const feed = await api("GET", "/purchases/available", { token: tokens.driver1 });
        assert.strictEqual(feed.status, 200, JSON.stringify(feed.json));

        const expiredEntry = feed.json.orders.find((o) => o._id === expiredOrder._id);
        assert.ok(expiredEntry, "order with expired offer must be in the feed");
        assert.ok(expiredEntry.myOffer, "expired offer must still be embedded as myOffer");
        assert.strictEqual(expiredEntry.myOffer.expired, true);

        const liveEntry = feed.json.orders.find((o) => o._id === liveOrder._id);
        assert.ok(liveEntry?.myOffer, "live offer must be embedded");
        assert.strictEqual(liveEntry.myOffer.expired, false);
        return "myOffer expired:true / expired:false as contracted";
    });

    // --- ITEM 7 --------------------------------------------------------
    console.log("\n== ITEM 7: earnings summary == by-service ==");
    await check("BE2-10", "summary.netEarnings equals by-service totals after ride+parcel+BD settlements", async () => {
        await RideSettlement.create({
            rideId: new ObjectId(),
            driverId: driver1._id,
            fare: 600,
            commission: 60,
            commissionPercentage: 10,
            driverEarnings: 540,
            status: "SETTLED",
            settledAt: new Date(),
        });
        await ParcelSettlement.create({
            parcelOrderId: new ObjectId(),
            driverId: driver1._id,
            fare: 400,
            commission: 40,
            commissionPercentage: 10,
            driverEarnings: 360,
            status: "SETTLED",
            settledAt: new Date(),
        });
        await PurchaseSettlement.create({
            purchaseOrderId: new ObjectId(),
            driverId: driver1._id,
            fare: 250,
            commission: 25,
            commissionPercentage: 10,
            driverEarnings: 225,
            status: "SETTLED",
            settledAt: new Date(),
        });

        const summary = await api("GET", "/drivers/me/earnings", { token: tokens.driver1 });
        assert.strictEqual(summary.status, 200, JSON.stringify(summary.json));
        const byService = await api("GET", "/drivers/me/earnings-by-service", { token: tokens.driver1 });
        assert.strictEqual(byService.status, 200, JSON.stringify(byService.json));

        assert.strictEqual(byService.json.services.BUY_DELIVER.netEarnings, 225);
        assert.strictEqual(byService.json.totals.netEarnings, 1125);
        assert.strictEqual(summary.json.summary.netEarnings, 1125,
            `summary=${summary.json.summary.netEarnings} vs by-service=1125`);
        assert.strictEqual(summary.json.summary.netEarnings, byService.json.totals.netEarnings);
        assert.strictEqual(summary.json.summary.totalCommission, byService.json.totals.totalCommission);
        assert.strictEqual(summary.json.summary.settledTrips, 3);
        assert.strictEqual(summary.json.daily.today.earnings, 1125);
        return "both endpoints: netEarnings 1125 (540 ride + 360 parcel + 225 BD), commission 125";
    });

    // --- ITEM 14 -------------------------------------------------------
    console.log("\n== ITEM 14: unread counts for a driver caller ==");
    await check("BE2-11", "driver gets per-order unread counts for his BD conversation", async () => {
        const created = await createOrder(2000);
        assert.strictEqual(created.status, 201, JSON.stringify(created.json));
        const order = created.json.order;

        await refreshGps();
        const offer = await api("POST", `/purchases/${order._id}/offers`, {
            token: tokens.driver1,
            body: { deliveryFee: 300 },
        });
        assert.strictEqual(offer.status, 201, JSON.stringify(offer.json));

        const conv = await api("POST", "/order-chats", {
            token: tokens.passenger,
            body: { orderType: "PURCHASE", orderId: order._id, partnerUserId: String(driver1._id) },
        });
        assert.strictEqual(conv.status, 200, JSON.stringify(conv.json));
        const conversation = conv.json.conversation;

        const msg = await api("POST", `/order-chats/${conversation._id}/messages`, {
            token: tokens.passenger,
            body: { kind: "TEXT", body: "Please buy fresh milk only", clientMessageId: "be2-pass-1" },
        });
        assert.strictEqual(msg.status, 201, JSON.stringify(msg.json));

        const counts = await api("GET", "/order-chats/unread/counts", { token: tokens.driver1 });
        assert.strictEqual(counts.status, 200, JSON.stringify(counts.json));
        assert.strictEqual(counts.json.success, true);
        const entry = counts.json.conversations.find(
            (c) => String(c.conversationId) === String(conversation._id)
        );
        assert.ok(entry, `driver counts must include the BD conversation: ${JSON.stringify(counts.json)}`);
        assert.strictEqual(entry.orderType, "PURCHASE");
        assert.strictEqual(String(entry.orderId), String(order._id));
        // >= 1: besides the passenger's text, the thread also carries
        // materialised EVENT messages from the passenger side (e.g.
        // ORDER_CREATED) — all legitimately unread for the driver.
        assert.ok(entry.count >= 1, `expected unread >= 1, got ${entry.count}`);
        assert.strictEqual(
            counts.json.total,
            counts.json.conversations.reduce((sum, c) => sum + c.count, 0),
            "total must equal the sum of per-conversation counts"
        );

        // Reading the thread as the driver clears his per-order count.
        const history = await api("GET", `/order-chats/${conversation._id}/messages`, {
            token: tokens.driver1,
        });
        assert.strictEqual(history.status, 200, JSON.stringify(history.json));
        const after = await api("GET", "/order-chats/unread/counts", { token: tokens.driver1 });
        const afterEntry = after.json.conversations.find(
            (c) => String(c.conversationId) === String(conversation._id)
        );
        assert.ok(!afterEntry, "read conversation must drop out of the driver's unread counts");
        return `driver per-order count=${entry.count} before read, cleared after read`;
    });

    // --- teardown --------------------------------------------------------
    const failed = results.filter((r) => !r.ok).length;
    console.log(`\n${results.length - failed}/${results.length} checks passed`);

    try {
        serverProcess.kill("SIGTERM");
    } catch {
        // already gone
    }
    await mongoose.connection.db.dropDatabase();
    await mongoose.disconnect();
    process.exit(failed ? 1 : 0);
})().catch(async (error) => {
    console.error("FATAL", error);
    try {
        serverProcess?.kill("SIGTERM");
    } catch {
        // ignore
    }
    process.exit(1);
});
