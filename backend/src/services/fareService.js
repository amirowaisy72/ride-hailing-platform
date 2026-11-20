const VehiclePricing = require("../models/VehiclePricing");

const calculateSuggestedFare = async (vehicleType, distanceKm) => {
    if (!Number.isFinite(distanceKm) || distanceKm <= 0) {
        throw new Error("Invalid distance");
    }

    const pricing = await VehiclePricing.findOne({
        vehicleType,
        isActive: true,
    });

    if (!pricing) {
        throw new Error("Vehicle pricing unavailable");
    }

    const fare = Math.max(
        pricing.minimumFare,
        pricing.baseFare + distanceKm * pricing.perKmRate
    );

    return {
        vehicleType,
        currency: "PKR",
        distanceKm,
        suggestedFare: Math.ceil(fare),
    };
};

// ---------------------------------------------------------------------------
// Fare limits (Safar To-Do #4). A passenger's requested fare and a
// driver's offer/counter may not be absurdly low or high versus the
// CALCULATED fare for the same vehicle type + distance — a PKR 10
// request was seen live. The band is a tunable decision for the user:
// 50%–150% of the calculated fare. Change the two constants below and
// every enforcement point follows; nothing else hard-codes a band.
//
// BACKWARD COMPAT (top priority — old app 1.0.7 and earlier must keep
// working exactly as today): enforcement is version-gated through the
// checkout's own gate, utils/clientVersion.js `isNewClient(req)` —
// true only for clients that positively identify themselves with
// X-App-Version-Code >= 10 (first release after 1.0.7, code 9). Old
// clients send no version header, so they are NEVER rejected: an
// out-of-band fare from an old client proceeds exactly as before, and
// the band rides along in the response as advisory info the new client
// can show. Only a new client, built to expect the FARE_OUT_OF_BAND
// error, gets the clean 400. There is no other per-request version
// signal in this codebase (the app reports its version only at
// launch, via appVersionReportController), so a version-row lookup
// would depend on a possibly stale row; the header gate is
// deterministic. Once 1.0.7 usage is negligible, the isNewClient
// check can be removed and enforcement made unconditional.
// ---------------------------------------------------------------------------
const FARE_BAND_MIN_MULTIPLIER = 0.5;
const FARE_BAND_MAX_MULTIPLIER = 1.5;

const fareBandFor = async (vehicleType, distanceKm) => {
    const { suggestedFare } = await calculateSuggestedFare(
        vehicleType,
        distanceKm
    );

    return {
        vehicleType,
        currency: "PKR",
        distanceKm,
        suggestedFare,
        minFare: Math.max(1, Math.floor(suggestedFare * FARE_BAND_MIN_MULTIPLIER)),
        maxFare: Math.ceil(suggestedFare * FARE_BAND_MAX_MULTIPLIER),
    };
};

const isFareWithinBand = (price, band) =>
    Number.isSafeInteger(price) &&
    band &&
    price >= band.minFare &&
    price <= band.maxFare;

module.exports = {
    calculateSuggestedFare,
    fareBandFor,
    isFareWithinBand,
    FARE_BAND_MIN_MULTIPLIER,
    FARE_BAND_MAX_MULTIPLIER,
};
