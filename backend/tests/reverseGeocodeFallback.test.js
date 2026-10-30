// Location-name reliability (Amir review A4) — unit tests for the
// reverse-geocode fallback chain and the "Near <saved place>" fallback.
//
// Plain node, no test framework, no DB, NO live network: the VM cannot
// reach the geocoding providers, so global.fetch is stubbed per test and
// the two Mongoose statics on the request path (IntegrationSetting.findOne
// for the maps-enabled gate, SavedPlace.find for the fallback lookup) are
// replaced with in-memory stubs. That is exactly why the chain is built
// from stub-able seams.
//
// Run:  node tests/reverseGeocodeFallback.test.js
// Exit code 0 = all passed, 1 = at least one failure.

const assert = require("node:assert");

const IntegrationSetting = require("../src/models/IntegrationSetting");
const SavedPlace = require("../src/models/SavedPlace");
const {
    reverseGeocode,
} = require("../src/integrations/maps/mapService");
const {
    NEARBY_RADIUS_KM,
    haversineKm,
    findNearestSavedPlace,
    savedPlaceLocation,
    nearestSavedPlaceLocation,
} = require("../src/services/nearestSavedPlaceService");
const {
    getAddressFromCoordinates,
} = require("../src/controllers/locationController");

// Khanpur, Punjab — the app's home turf.
const LAT = 28.4212;
const LON = 70.3029;

// ~0.5 km north of the point above (0.0045° latitude ≈ 0.50 km).
const NEAR_PLACE = {
    name: "Home",
    type: "HOME",
    latitude: LAT + 0.0045,
    longitude: LON,
};
// ~1.5 km east.
const MID_PLACE = {
    name: "Office",
    type: "WORK",
    latitude: LAT,
    longitude: LON + 0.0165,
};
// ~5.5 km north — outside the 2 km radius.
const FAR_PLACE = {
    name: "Farmhouse",
    type: "FAVORITE",
    latitude: LAT + 0.05,
    longitude: LON,
};

// ---------------------------------------------------------------------------
// Stubs
// ---------------------------------------------------------------------------

const realFetch = global.fetch;
const realConsoleError = console.error;
let fetchCalls = [];

// behaviour: { nominatim: "ok"|"http-error"|"error-payload"|"reject",
//              bigdatacloud: "ok"|"http-error"|"empty"|"reject" }
function stubFetch(behaviour) {
    fetchCalls = [];
    global.fetch = async (url) => {
        const href = String(url);
        fetchCalls.push(href);

        if (href.includes("nominatim.openstreetmap.org")) {
            if (behaviour.nominatim === "reject") {
                throw new Error("network unreachable");
            }
            if (behaviour.nominatim === "http-error") {
                return { ok: false, status: 503, json: async () => ({}) };
            }
            if (behaviour.nominatim === "error-payload") {
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({ error: "Unable to geocode" }),
                };
            }
            return {
                ok: true,
                status: 200,
                json: async () => ({
                    display_name: "Main Bazaar Road, Khanpur, Punjab, Pakistan",
                }),
            };
        }

        if (href.includes("api.bigdatacloud.net")) {
            if (behaviour.bigdatacloud === "reject") {
                throw new Error("network unreachable");
            }
            if (behaviour.bigdatacloud === "http-error") {
                return { ok: false, status: 500, json: async () => ({}) };
            }
            if (behaviour.bigdatacloud === "empty") {
                return { ok: true, status: 200, json: async () => ({}) };
            }
            return {
                ok: true,
                status: 200,
                json: async () => ({
                    latitude: LAT,
                    longitude: LON,
                    locality: "Khanpur",
                    city: "Khanpur",
                    principalSubdivision: "Punjab",
                    countryName: "Pakistan",
                }),
            };
        }

        throw new Error(`Unexpected fetch in test: ${href}`);
    };
}

function stubMapsEnabled() {
    IntegrationSetting.findOne = () => ({ lean: async () => null });
}

function stubSavedPlaces(places) {
    SavedPlace.find = () => ({ lean: async () => places });
}

function mockRes() {
    return {
        statusCode: 200,
        body: null,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(payload) {
            this.body = payload;
            return this;
        },
    };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const tests = [];
function test(name, fn) {
    tests.push({ name, fn });
}

test("primary Nominatim succeeds → its result, secondary never called", async () => {
    stubMapsEnabled();
    stubFetch({ nominatim: "ok", bigdatacloud: "ok" });

    const result = await reverseGeocode(LAT, LON);

    assert.deepStrictEqual(result, {
        name: "Main Bazaar Road, Khanpur, Punjab, Pakistan",
        latitude: LAT,
        longitude: LON,
        source: "provider",
    });
    assert.strictEqual(fetchCalls.length, 1);
    assert.ok(fetchCalls[0].includes("nominatim.openstreetmap.org"));
});

test("primary fails (HTTP error) → BigDataCloud result, normalized + de-duplicated", async () => {
    stubMapsEnabled();
    stubFetch({ nominatim: "http-error", bigdatacloud: "ok" });

    const result = await reverseGeocode(LAT, LON);

    // locality "Khanpur" and city "Khanpur" collapse to one entry.
    assert.deepStrictEqual(result, {
        name: "Khanpur, Punjab, Pakistan",
        latitude: LAT,
        longitude: LON,
        source: "provider",
    });
    assert.strictEqual(fetchCalls.length, 2);
    assert.ok(fetchCalls[1].includes("api.bigdatacloud.net"));
});

test("primary returns an error payload → chain still falls through to secondary", async () => {
    stubMapsEnabled();
    stubFetch({ nominatim: "error-payload", bigdatacloud: "ok" });

    const result = await reverseGeocode(LAT, LON);

    assert.strictEqual(result.name, "Khanpur, Punjab, Pakistan");
    assert.strictEqual(fetchCalls.length, 2);
});

test("both providers fail → throws 'Reverse geocoding unavailable' as before", async () => {
    stubMapsEnabled();
    stubFetch({ nominatim: "reject", bigdatacloud: "http-error" });

    await assert.rejects(
        () => reverseGeocode(LAT, LON),
        /Reverse geocoding unavailable/
    );
    assert.strictEqual(fetchCalls.length, 2);
});

test("secondary returns no locality fields → treated as failure, error propagates", async () => {
    stubMapsEnabled();
    stubFetch({ nominatim: "http-error", bigdatacloud: "empty" });

    await assert.rejects(
        () => reverseGeocode(LAT, LON),
        /Reverse geocoding unavailable/
    );
});

test("invalid coordinates are rejected before any provider call", async () => {
    stubMapsEnabled();
    stubFetch({ nominatim: "ok", bigdatacloud: "ok" });

    await assert.rejects(() => reverseGeocode(91, LON), /Invalid coordinates/);
    assert.strictEqual(fetchCalls.length, 0);
});

test("haversineKm: 1° of latitude ≈ 111.19 km, identical points = 0", () => {
    assert.strictEqual(haversineKm(LAT, LON, LAT, LON), 0);
    const oneDegree = haversineKm(28, 70, 29, 70);
    assert.ok(Math.abs(oneDegree - 111.19) < 0.5, `got ${oneDegree}`);
});

test("findNearestSavedPlace picks the CLOSEST place within 2 km", () => {
    const nearest = findNearestSavedPlace([MID_PLACE, FAR_PLACE, NEAR_PLACE], LAT, LON);

    assert.ok(nearest);
    assert.strictEqual(nearest.place.name, "Home");
    assert.ok(nearest.distanceKm < 0.6, `got ${nearest.distanceKm}`);
    assert.ok(nearest.distanceKm <= NEARBY_RADIUS_KM);
});

test("findNearestSavedPlace returns null when every place is beyond 2 km", () => {
    assert.strictEqual(findNearestSavedPlace([FAR_PLACE], LAT, LON), null);
    assert.strictEqual(findNearestSavedPlace([], LAT, LON), null);
});

test("findNearestSavedPlace skips records with broken coordinates", () => {
    const broken = { name: "Broken", latitude: "x", longitude: null };
    const nearest = findNearestSavedPlace([broken, NEAR_PLACE], LAT, LON);
    assert.strictEqual(nearest.place.name, "Home");
});

test("savedPlaceLocation label is exactly 'Near <name>' with the REQUESTED coordinates", () => {
    assert.deepStrictEqual(savedPlaceLocation(NEAR_PLACE, LAT, LON), {
        name: "Near Home",
        latitude: LAT,
        longitude: LON,
        source: "saved-place",
    });
});

test("nearestSavedPlaceLocation (DB wrapper) resolves a nearby place and null when far", async () => {
    stubSavedPlaces([FAR_PLACE, NEAR_PLACE]);
    const location = await nearestSavedPlaceLocation("user-1", LAT, LON);
    assert.strictEqual(location.name, "Near Home");
    assert.strictEqual(location.source, "saved-place");

    stubSavedPlaces([FAR_PLACE]);
    assert.strictEqual(await nearestSavedPlaceLocation("user-1", LAT, LON), null);
    assert.strictEqual(await nearestSavedPlaceLocation(null, LAT, LON), null);
});

test("controller: providers down + saved place nearby → 200 with the Near label", async () => {
    stubMapsEnabled();
    stubFetch({ nominatim: "reject", bigdatacloud: "reject" });
    stubSavedPlaces([NEAR_PLACE]);

    const res = mockRes();
    await getAddressFromCoordinates(
        { query: { latitude: String(LAT), longitude: String(LON) }, user: { _id: "user-1" } },
        res
    );

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.success, true);
    assert.deepStrictEqual(res.body.location, {
        name: "Near Home",
        latitude: LAT,
        longitude: LON,
        source: "saved-place",
    });
});

test("controller: providers down + NO saved place nearby → today's 502 is preserved", async () => {
    stubMapsEnabled();
    stubFetch({ nominatim: "reject", bigdatacloud: "reject" });
    stubSavedPlaces([FAR_PLACE]);

    const res = mockRes();
    await getAddressFromCoordinates(
        { query: { latitude: String(LAT), longitude: String(LON) }, user: { _id: "user-1" } },
        res
    );

    assert.strictEqual(res.statusCode, 502);
    assert.deepStrictEqual(res.body, {
        success: false,
        message: "Reverse geocoding unavailable",
    });
});

// ---------------------------------------------------------------------------
// Runner (same pattern as tests/locationEligibility.test.js)
// ---------------------------------------------------------------------------

(async () => {
    let passed = 0;
    const failures = [];

    console.error = () => {}; // chain logs expected provider failures

    for (const { name, fn } of tests) {
        try {
            await fn();
            passed += 1;
            console.log(`  PASS  ${name}`);
        } catch (error) {
            failures.push({ name, error });
            console.log(`  FAIL  ${name}`);
            console.log(`        ${error.message.split("\n")[0]}`);
        } finally {
            global.fetch = realFetch;
        }
    }

    console.error = realConsoleError;

    console.log(
        `\n${passed}/${tests.length} tests passed` +
            (failures.length ? ` — ${failures.length} FAILED` : "")
    );

    process.exitCode = failures.length ? 1 : 0;
})();
