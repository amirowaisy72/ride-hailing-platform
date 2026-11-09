const Ride = require("../models/Ride");
const DriverOnlineEvent = require("../models/DriverOnlineEvent");
const {
    computeDailyAverages,
    pktYesterdayString,
} = require("../services/dailyAveragesService");

// GET /admin/operations/daily-averages?date=YYYY-MM-DD
// Admin-only (router applies protect + authorize("ADMIN")).
// ADDITIVE ONLY: new read-only endpoint — no existing endpoint,
// response shape or required field is changed, and nothing in the
// driver/passenger app calls it, so the Play Store app is
// untouched (no rebuild needed).
//
// ?date defaults to yesterday (the last complete day). The
// passenger side is retroactive — ride requestedAt is stored on
// every ride — while the driver side only exists from the day
// DriverOnlineEvent recording shipped; until then the payload
// reports drivers.dataAvailable: false.
async function getDailyAverages(req, res) {
    try {
        const raw =
            typeof req.query.date === "string" && req.query.date.trim() !== ""
                ? req.query.date.trim()
                : pktYesterdayString();
        const dailyAverages = await computeDailyAverages(
            Ride,
            DriverOnlineEvent,
            raw
        );

        return res.json({ success: true, dailyAverages });
    } catch (error) {
        if (error.status === 400) {
            return res
                .status(400)
                .json({ success: false, message: error.message });
        }

        console.error("Daily averages error:", error.message);
        return res.status(500).json({
            success: false,
            message: "Unable to load daily averages",
        });
    }
}

module.exports = { getDailyAverages };
