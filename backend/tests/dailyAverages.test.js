// Daily Averages tests (plain node, no test framework, no DB).
//
// services/dailyAveragesService.js is pure by design, so these
// tests exercise the REAL production math (PKT day windows, clock
// averages, gap labels) and the endpoint builder against plain
// fixtures — the same approach as tests/rentalBookingService.test.js.
// computeDailyAverages is tested with fake models (chainable
// find/select/lean stubs), never a live database.
//
// Run:  node tests/dailyAverages.test.js
// Exit code 0 = all passed, 1 = at least one failure.

const assert = require("node:assert");

const {
    isValidDateString,
    pktDateString,
    pktTodayString,
    pktYesterdayString,
    pktDayWindow,
    averageMinutes,
    hourlyCounts,
    minutesToClock,
    gapMinutes,
    gapLabel,
    firstOnlinePerDriver,
    buildDailyAverages,
    computeDailyAverages,
} = require("../src/services/dailyAveragesService");

const tests = [];
function test(name, fn) {
    tests.push({ name, fn });
}

// 2026-11-09 15:21 PKT == 2026-11-09 10:21 UTC.
const at = (utcIso) => new Date(utcIso);

test("pktDateString gives the PKT calendar date", () => {
    assert.strictEqual(pktDateString(at("2026-11-09T10:21:00.000Z")), "2026-11-09");
    // 19:30 UTC is 00:30 PKT the next day.
    assert.strictEqual(pktDateString(at("2026-11-09T19:30:00.000Z")), "2026-11-10");
});

test("pktTodayString / pktYesterdayString are one day apart", () => {
    const now = at("2026-11-10T00:30:00.000Z"); // 05:30 PKT on 10 Nov
    assert.strictEqual(pktTodayString(now), "2026-11-10");
    assert.strictEqual(pktYesterdayString(now), "2026-11-09");
});

test("pktDayWindow covers exactly one PKT day in UTC", () => {
    const { start, end } = pktDayWindow("2026-11-09");
    assert.strictEqual(start.toISOString(), "2026-11-08T19:00:00.000Z");
    assert.strictEqual(end.toISOString(), "2026-11-09T19:00:00.000Z");
});

test("isValidDateString rejects bad dates", () => {
    assert.strictEqual(isValidDateString("2026-11-09"), true);
    assert.strictEqual(isValidDateString("2026-02-30"), false);
    assert.strictEqual(isValidDateString("2026-13-01"), false);
    assert.strictEqual(isValidDateString("2026-11-9"), false);
    assert.strictEqual(isValidDateString("tomorrow"), false);
    assert.strictEqual(isValidDateString(""), false);
    assert.strictEqual(isValidDateString(null), false);
});

test("minutesToClock formats 12-hour PKT times", () => {
    assert.strictEqual(minutesToClock(0), "12:00 AM");
    assert.strictEqual(minutesToClock(60), "1:00 AM");
    assert.strictEqual(minutesToClock(720), "12:00 PM");
    assert.strictEqual(minutesToClock(921), "3:21 PM");
    assert.strictEqual(minutesToClock(987), "4:27 PM");
    assert.strictEqual(minutesToClock(1439), "11:59 PM");
    assert.strictEqual(minutesToClock(null), null);
});

test("averageMinutes averages clock times, null when empty", () => {
    // 9:00 AM (540) + 5:02 PM (1022) -> 781 -> 1:01 PM.
    assert.strictEqual(
        averageMinutes([at("2026-11-09T04:00:00.000Z"), at("2026-11-09T12:02:00.000Z")]),
        781
    );
    assert.strictEqual(averageMinutes([]), null);
    assert.strictEqual(averageMinutes(null), null);
});

test("hourlyCounts buckets by PKT hour", () => {
    const counts = hourlyCounts([
        at("2026-11-09T04:00:00.000Z"), // 9:00 AM PKT
        at("2026-11-09T04:30:00.000Z"), // 9:30 AM PKT
        at("2026-11-09T12:02:00.000Z"), // 5:02 PM PKT
    ]);
    assert.strictEqual(counts.length, 24);
    assert.strictEqual(counts[9], 2);
    assert.strictEqual(counts[17], 1);
    assert.strictEqual(counts[0], 0);
});

test("gapMinutes and gapLabel describe the gap", () => {
    assert.strictEqual(gapMinutes(921, 987), 66);
    assert.strictEqual(gapMinutes(987, 921), -66);
    assert.strictEqual(gapMinutes(null, 987), null);
    assert.strictEqual(gapLabel(66), "1h 6m");
    assert.strictEqual(gapLabel(45), "45m");
    assert.strictEqual(gapLabel(120), "2h");
    assert.strictEqual(gapLabel(0), "0m");
    assert.strictEqual(gapLabel(-135), "2h 15m");
    assert.strictEqual(gapLabel(null), null);
});

test("firstOnlinePerDriver keeps each driver's earliest online time", () => {
    const firsts = firstOnlinePerDriver([
        { driverId: "d1", onlineAt: at("2026-11-09T12:00:00.000Z") },
        { driverId: "d1", onlineAt: at("2026-11-09T09:00:00.000Z") },
        { driverId: "d2", onlineAt: at("2026-11-09T11:00:00.000Z") },
        { driverId: "d3", onlineAt: null },
    ]);
    assert.strictEqual(firsts.length, 2);
    assert.deepStrictEqual(
        firsts.map((d) => d.toISOString()).sort(),
        ["2026-11-09T09:00:00.000Z", "2026-11-09T11:00:00.000Z"]
    );
});

test("buildDailyAverages returns the full payload with a drivers-later gap", () => {
    const out = buildDailyAverages({
        date: "2026-11-09",
        rideTimes: [
            at("2026-11-09T04:00:00.000Z"), // 9:00 AM PKT (540)
            at("2026-11-09T12:02:00.000Z"), // 5:02 PM PKT (1022)
        ],
        firstOnlineTimes: [
            at("2026-11-09T11:53:00.000Z"), // 4:53 PM PKT (1013)
            at("2026-11-09T13:53:00.000Z"), // 6:53 PM PKT (1133)
        ],
        driverDataSince: "2026-11-10",
    });

    assert.strictEqual(out.date, "2026-11-09");
    assert.strictEqual(out.timezone, "Asia/Karachi");
    assert.strictEqual(out.passengers.rideCount, 2);
    assert.strictEqual(out.passengers.avgRequestMinutes, 781);
    assert.strictEqual(out.passengers.avgRequestTime, "1:01 PM");
    assert.strictEqual(out.drivers.driverCount, 2);
    assert.strictEqual(out.drivers.avgOnlineMinutes, 1073);
    assert.strictEqual(out.drivers.avgOnlineTime, "5:53 PM");
    assert.strictEqual(out.drivers.dataAvailable, true);
    assert.strictEqual(out.drivers.dataSince, "2026-11-10");
    assert.strictEqual(out.gap.minutes, 292);
    assert.strictEqual(out.gap.label, "4h 52m");
    assert.strictEqual(out.gap.direction, "drivers-later");
});

test("buildDailyAverages reports honestly when a side has no data", () => {
    const out = buildDailyAverages({
        date: "2026-11-09",
        rideTimes: [at("2026-11-09T04:00:00.000Z")],
        firstOnlineTimes: [],
        driverDataSince: null,
    });

    assert.strictEqual(out.passengers.rideCount, 1);
    assert.strictEqual(out.passengers.avgRequestTime, "9:00 AM");
    assert.strictEqual(out.drivers.driverCount, 0);
    assert.strictEqual(out.drivers.avgOnlineTime, null);
    assert.strictEqual(out.drivers.dataAvailable, false);
    assert.strictEqual(out.gap.minutes, null);
    assert.strictEqual(out.gap.label, null);
    assert.strictEqual(out.gap.direction, null);
});

// --- computeDailyAverages with fake models (no MongoDB) ---

function fakeQuery(result) {
    return {
        select() {
            return this;
        },
        sort() {
            return this;
        },
        lean() {
            return Promise.resolve(result);
        },
    };
}

test("computeDailyAverages queries the right PKT window and date", async () => {
    let rideQuery = null;
    let eventQuery = null;
    const Ride = {
        find(query) {
            rideQuery = query;
            return fakeQuery([
                { requestedAt: at("2026-11-09T04:00:00.000Z"), createdAt: at("2026-11-09T04:00:00.000Z") },
                { requestedAt: null, createdAt: at("2026-11-09T12:02:00.000Z") },
            ]);
        },
    };
    const DriverOnlineEvent = {
        find(query) {
            eventQuery = query;
            return fakeQuery([
                { driverId: "d1", onlineAt: at("2026-11-09T11:53:00.000Z") },
            ]);
        },
        findOne() {
            return fakeQuery({ date: "2026-11-10" });
        },
    };

    const out = await computeDailyAverages(Ride, DriverOnlineEvent, "2026-11-09");

    assert.deepStrictEqual(eventQuery, { date: "2026-11-09" });
    assert.strictEqual(
        rideQuery.$or[0].requestedAt.$gte.toISOString(),
        "2026-11-08T19:00:00.000Z"
    );
    assert.strictEqual(
        rideQuery.$or[0].requestedAt.$lt.toISOString(),
        "2026-11-09T19:00:00.000Z"
    );
    assert.strictEqual(out.passengers.rideCount, 2);
    assert.strictEqual(out.passengers.avgRequestTime, "1:01 PM");
    assert.strictEqual(out.drivers.driverCount, 1);
    assert.strictEqual(out.drivers.avgOnlineTime, "4:53 PM");
    assert.strictEqual(out.drivers.dataAvailable, true);
});

test("computeDailyAverages rejects bad and future dates with 400", async () => {
    const Ride = { find: () => fakeQuery([]) };
    const DriverOnlineEvent = {
        find: () => fakeQuery([]),
        findOne: () => fakeQuery(null),
    };

    await assert.rejects(
        computeDailyAverages(Ride, DriverOnlineEvent, "not-a-date"),
        (err) => err.status === 400
    );
    await assert.rejects(
        computeDailyAverages(Ride, DriverOnlineEvent, "2999-01-01"),
        (err) => err.status === 400
    );
});

async function main() {
    let passed = 0;
    for (const { name, fn } of tests) {
        try {
            await fn();
            passed += 1;
            console.log(`ok - ${name}`);
        } catch (error) {
            console.error(`FAIL - ${name}\n  ${error.message}`);
        }
    }
    console.log(`${passed}/${tests.length} tests passed`);
    if (passed !== tests.length) process.exit(1);
}

main();
