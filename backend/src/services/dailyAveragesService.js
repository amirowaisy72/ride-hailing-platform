// Daily Averages — passenger request time vs driver online time.
//
// Pure by design (same approach as services/rentalBookingService):
// all date/clock math is plain functions, and computeDailyAverages
// takes the Mongoose models as arguments so tests can inject fakes
// without MongoDB — see tests/dailyAverages.test.js.
//
// Timezone: every "day" is a Pakistan calendar day (Asia/Karachi,
// fixed +05:00 — Pakistan has no daylight saving, so the fixed
// offset is correct, same as adminOperationsController.getTodayRides).
const PKT_OFFSET_MS = 5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidDateString(value) {
    if (typeof value !== "string" || !DATE_RE.test(value)) return false;
    const [y, m, d] = value.split("-").map(Number);
    const check = new Date(Date.UTC(y, m - 1, d));
    return (
        check.getUTCFullYear() === y &&
        check.getUTCMonth() === m - 1 &&
        check.getUTCDate() === d
    );
}

// PKT calendar date (YYYY-MM-DD) of an instant.
function pktDateString(date) {
    const shifted = new Date(date.getTime() + PKT_OFFSET_MS);
    return shifted.toISOString().slice(0, 10);
}

function pktTodayString(now = new Date()) {
    return pktDateString(now);
}

function pktYesterdayString(now = new Date()) {
    return pktDateString(new Date(now.getTime() - DAY_MS));
}

// [start, end) UTC instants covering a PKT calendar day.
function pktDayWindow(dateStr) {
    const [y, m, d] = dateStr.split("-").map(Number);
    const start = new Date(Date.UTC(y, m - 1, d) - PKT_OFFSET_MS);
    return { start, end: new Date(start.getTime() + DAY_MS) };
}

// Minutes since midnight PKT for an instant (0–1439).
function pktMinutesOfDay(date) {
    const shifted = new Date(date.getTime() + PKT_OFFSET_MS);
    return shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
}

// Mean of a list of instants, as minutes since midnight PKT.
// Returns null when the list is empty.
function averageMinutes(dates) {
    if (!dates || dates.length === 0) return null;
    const total = dates.reduce((sum, d) => sum + pktMinutesOfDay(d), 0);
    return Math.round(total / dates.length);
}

// 24 hourly buckets (index = PKT hour 0–23) for a list of instants.
function hourlyCounts(dates) {
    const counts = Array(24).fill(0);
    for (const d of dates || []) {
        const shifted = new Date(d.getTime() + PKT_OFFSET_MS);
        counts[shifted.getUTCHours()] += 1;
    }
    return counts;
}

// "3:21 PM" for minutes since midnight PKT; null stays null.
function minutesToClock(minutes) {
    if (minutes == null) return null;
    const h24 = Math.floor(minutes / 60) % 24;
    const m = minutes % 60;
    const suffix = h24 >= 12 ? "PM" : "AM";
    const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
    return `${h12}:${String(m).padStart(2, "0")} ${suffix}`;
}

// Gap between the two averages, in minutes. Positive means drivers
// came online LATER than passengers requested, on average.
function gapMinutes(passengerAvg, driverAvg) {
    if (passengerAvg == null || driverAvg == null) return null;
    return driverAvg - passengerAvg;
}

// "1h 6m" / "45m" / "0m" for an absolute minute count.
function gapLabel(minutes) {
    if (minutes == null) return null;
    const abs = Math.abs(minutes);
    const h = Math.floor(abs / 60);
    const m = abs % 60;
    if (h === 0) return `${m}m`;
    if (m === 0) return `${h}h`;
    return `${h}h ${m}m`;
}

// First online time per driver for one day, from that day's events.
function firstOnlinePerDriver(events) {
    const firstByDriver = new Map();
    for (const event of events || []) {
        if (!event || !event.onlineAt) continue;
        const key = String(event.driverId);
        const at = new Date(event.onlineAt);
        const prev = firstByDriver.get(key);
        if (!prev || at < prev) firstByDriver.set(key, at);
    }
    return [...firstByDriver.values()];
}

// Pure response builder: takes already-fetched data, returns the
// exact payload the endpoint sends. Kept separate so the math is
// unit-testable without a database.
function buildDailyAverages({ date, rideTimes, firstOnlineTimes, driverDataSince }) {
    const passengerAvg = averageMinutes(rideTimes);
    const driverAvg = averageMinutes(firstOnlineTimes);
    const gap = gapMinutes(passengerAvg, driverAvg);

    return {
        date,
        timezone: "Asia/Karachi",
        isToday: date === pktTodayString(),
        passengers: {
            rideCount: (rideTimes || []).length,
            avgRequestMinutes: passengerAvg,
            avgRequestTime: minutesToClock(passengerAvg),
            hourly: hourlyCounts(rideTimes),
        },
        drivers: {
            driverCount: (firstOnlineTimes || []).length,
            avgOnlineMinutes: driverAvg,
            avgOnlineTime: minutesToClock(driverAvg),
            hourly: hourlyCounts(firstOnlineTimes),
            // False until the first online event is ever recorded
            // (the log only exists from the day this feature ships),
            // so the dashboard can say "no driver data yet" instead
            // of showing a misleading 0.
            dataAvailable: driverDataSince != null,
            dataSince: driverDataSince || null,
        },
        gap: {
            minutes: gap,
            label: gapLabel(gap),
            direction:
                gap == null
                    ? null
                    : gap > 0
                      ? "drivers-later"
                      : gap < 0
                        ? "passengers-later"
                        : "same",
        },
    };
}

// Runs the two queries and builds the response. Ride times are
// retroactive (requestedAt is stored on every ride); driver times
// only exist from the day DriverOnlineEvent recording shipped.
async function computeDailyAverages(Ride, DriverOnlineEvent, dateStr) {
    if (!isValidDateString(dateStr)) {
        const error = new Error("Invalid date — use YYYY-MM-DD");
        error.status = 400;
        throw error;
    }
    if (dateStr > pktTodayString()) {
        const error = new Error("Date must not be in the future");
        error.status = 400;
        throw error;
    }

    const { start, end } = pktDayWindow(dateStr);

    const [rides, events, earliestEvent] = await Promise.all([
        // requestedAt is the booking instant; createdAt is only a
        // fallback for rides created before that field existed.
        Ride.find({
            $or: [
                { requestedAt: { $gte: start, $lt: end } },
                {
                    requestedAt: null,
                    createdAt: { $gte: start, $lt: end },
                },
            ],
        })
            .select("requestedAt createdAt")
            .lean(),
        DriverOnlineEvent.find({ date: dateStr })
            .select("driverId onlineAt")
            .lean(),
        DriverOnlineEvent.findOne()
            .sort({ date: 1 })
            .select("date")
            .lean(),
    ]);

    const rideTimes = (rides || []).map(
        (ride) => new Date(ride.requestedAt || ride.createdAt)
    );

    return buildDailyAverages({
        date: dateStr,
        rideTimes,
        firstOnlineTimes: firstOnlinePerDriver(events),
        driverDataSince: earliestEvent ? earliestEvent.date : null,
    });
}

module.exports = {
    PKT_OFFSET_MS,
    isValidDateString,
    pktDateString,
    pktTodayString,
    pktYesterdayString,
    pktDayWindow,
    pktMinutesOfDay,
    averageMinutes,
    hourlyCounts,
    minutesToClock,
    gapMinutes,
    gapLabel,
    firstOnlinePerDriver,
    buildDailyAverages,
    computeDailyAverages,
};
