const crypto = require("crypto");
const mongoose = require("mongoose");
const Ride = require("../models/Ride");
const Driver = require("../models/Driver");
const User = require("../models/User");
const SosAlert = require("../models/SosAlert");
const RideLocationTrail = require("../models/RideLocationTrail");
const { publishEvent } = require("../services/socketService");
const { sendPushToUser } = require("../services/pushService");

// ---------------------------------------------------------------------
// Safety (Safar To-Do #5, Phase 1) — all routes here are NEW and
// additive. No existing endpoint, field, or response shape is changed.
//
// (a) SOS: POST /safety/sos — one tap from an active ride. The alert
//     is stored for the admin dashboard, pushed to every admin, and
//     published on the socket. There is NO police integration: the
//     alert goes to Safar admin + the app shows a one-tap call to 15.
// (b) Passenger verification: GET /safety/rides/:rideId/passenger-
//     verification — what a driver sees BEFORE offering on a ride.
//     (The same object is also attached inline to the available-rides
//     feed; see driverRideController.) NOTE on honesty: this codebase
//     has NO SMS phone verification, so no field claims a phone is
//     "verified". It reports phone-on-file + email-verified + ride
//     history, which is everything the system actually knows.
// (c) Live sharing: POST /safety/rides/:rideId/share-link creates a
//     24-hour token link; GET /safety/shared/:token is public and
//     returns the ride's live position — no login, no phone numbers.
// (d) GPS trail: GET /admin/safety/rides/:rideId/trail — the FIR pack:
//     full trail + driver/passenger details for a police complaint.
// (e) Safety complaints: NOTHING added — the complaints system already
//     has a SAFETY category end to end (Complaint model enum +
//     ComplaintsSection + admin complaints page).
// ---------------------------------------------------------------------

const ACTIVE_RIDE_STATUSES = [
    "DRIVER_SELECTED",
    "DRIVER_EN_ROUTE",
    "DRIVER_ARRIVED",
    "TRIP_STARTED",
];

const REQUEST_STATUSES = ["REQUESTED", "SEARCHING", "BIDDING"];

// Web app base used for share/invite links. Set FRONTEND_URL in the
// backend env; the fallback is the known live web app URL.
function webAppBaseUrl() {
    return (
        process.env.FRONTEND_URL || "https://ride-hailing-app-ywrq.onrender.com"
    ).replace(/\/$/, "");
}

function personName(user) {
    return [user?.firstName, user?.lastName].filter(Boolean).join(" ") || "Safar user";
}

async function resolveRideParty(ride, userId) {
    const callerId = String(userId);
    if (String(ride.passengerId) === callerId) {
        return { role: "PASSENGER", driver: null };
    }
    if (ride.driverId) {
        const driver = await Driver.findById(ride.driverId).select("userId").lean();
        if (driver && String(driver.userId) === callerId) {
            return { role: "DRIVER", driver };
        }
    }
    return null;
}

// (a) POST /safety/sos
const sendSos = async (req, res) => {
    try {
        const { rideId, latitude, longitude, note } = req.body || {};

        if (!mongoose.isValidObjectId(rideId)) {
            return res.status(400).json({ success: false, message: "Invalid ride ID" });
        }

        const ride = await Ride.findById(rideId).select("passengerId driverId status").lean();
        if (!ride) {
            return res.status(404).json({ success: false, message: "Ride not found" });
        }

        if (!ACTIVE_RIDE_STATUSES.includes(ride.status)) {
            return res.status(409).json({
                success: false,
                message: "SOS is available only during an active ride",
            });
        }

        const party = await resolveRideParty(ride, req.user._id);
        if (!party) {
            return res.status(403).json({ success: false, message: "Access denied" });
        }

        // Location: prefer the SOS press coordinates; a driver with no
        // fix falls back to their last known live location.
        let coords = null;
        if (Number.isFinite(Number(latitude)) && Number.isFinite(Number(longitude))) {
            coords = [Number(longitude), Number(latitude)];
        } else if (party.role === "DRIVER" && ride.driverId) {
            const driver = await Driver.findById(ride.driverId)
                .select("currentLocation")
                .lean();
            const saved = driver?.currentLocation?.coordinates;
            if (Array.isArray(saved) && saved.length === 2 && saved.every(Number.isFinite)) {
                coords = saved;
            }
        }

        const alert = await SosAlert.create({
            ride: ride._id,
            reporter: req.user._id,
            reporterRole: party.role,
            location: coords
                ? { type: "Point", coordinates: coords }
                : undefined,
            note: typeof note === "string" ? note.slice(0, 500) : "",
        });

        // Admin side: dashboard list (the stored row) + push to every
        // admin with a registered device + a socket event for any
        // live admin listener. All best-effort — the SOS is already
        // stored, so a notify failure never fails the SOS itself.
        const alertPayload = {
            alertId: String(alert._id),
            rideId: String(ride._id),
            reporterRole: party.role,
            status: alert.status,
            createdAt: alert.createdAt,
        };
        try {
            publishEvent("safety:sos", "admin:sos", alertPayload);
            const admins = await User.find({ role: "ADMIN", status: "ACTIVE" })
                .select("_id")
                .lean();
            await Promise.all(
                admins.map((admin) =>
                    sendPushToUser(
                        admin._id,
                        `SOS alert — ${party.role === "DRIVER" ? "driver" : "passenger"} needs help`,
                        `Ride ${String(ride._id).slice(-6)}: tap to open the SOS alert in the dashboard.`,
                        { type: "SOS_ALERT", alertId: String(alert._id), rideId: String(ride._id) }
                    )
                )
            );
        } catch (notifyError) {
            console.error("SOS admin notify failed:", notifyError.message);
        }

        return res.status(201).json({
            success: true,
            message: "SOS alert sent to Safar admin. If you are in danger, also call 15 now.",
            alert: { id: String(alert._id), status: alert.status, createdAt: alert.createdAt },
            emergencyCall: { number: "15", label: "Police (Pakistan)" },
        });
    } catch (error) {
        console.error("SOS error:", error.message);
        return res.status(500).json({ success: false, message: "Failed to send SOS alert" });
    }
};

// Shared builder for the passenger-verification object (used by the
// standalone endpoint below and by driverRideController's feed).
async function buildPassengerVerification(passengerId) {
    const passenger = await User.findById(passengerId)
        .select("firstName lastName profileImage phone emailVerified rideNoShowCount rating ratingCount createdAt")
        .lean();
    if (!passenger) return null;

    const [completedRides, totalRides] = await Promise.all([
        Ride.countDocuments({ passengerId, status: "TRIP_COMPLETED" }),
        Ride.countDocuments({ passengerId }),
    ]);

    return {
        name: personName(passenger),
        profileImage: passenger.profileImage || null,
        // Honest signals only — see the header note: no SMS phone
        // verification exists, so "verified" is never claimed.
        phoneProvided: Boolean(passenger.phone),
        emailVerified: passenger.emailVerified === true,
        completedRides,
        totalRides,
        cancelledRides: Math.max(0, totalRides - completedRides),
        noShowCount: passenger.rideNoShowCount || 0,
        rating: passenger.rating || 0,
        ratingCount: passenger.ratingCount || 0,
        memberSince: passenger.createdAt || null,
    };
}

// (b) GET /safety/rides/:rideId/passenger-verification
const getPassengerVerification = async (req, res) => {
    try {
        const { rideId } = req.params;
        if (!mongoose.isValidObjectId(rideId)) {
            return res.status(400).json({ success: false, message: "Invalid ride ID" });
        }

        const ride = await Ride.findOne({
            _id: rideId,
            status: { $in: REQUEST_STATUSES },
            driverId: null,
        })
            .select("passengerId status")
            .lean();

        if (!ride) {
            return res.status(404).json({
                success: false,
                message: "Open ride request not found",
            });
        }

        const verification = await buildPassengerVerification(ride.passengerId);
        if (!verification) {
            return res.status(404).json({ success: false, message: "Passenger not found" });
        }

        return res.json({ success: true, passengerVerification: verification });
    } catch (error) {
        console.error("Passenger verification error:", error.message);
        return res.status(500).json({ success: false, message: "Failed to load passenger details" });
    }
};

// (c) POST /safety/rides/:rideId/share-link
const createShareLink = async (req, res) => {
    try {
        const { rideId } = req.params;
        if (!mongoose.isValidObjectId(rideId)) {
            return res.status(400).json({ success: false, message: "Invalid ride ID" });
        }

        const ride = await Ride.findById(rideId).select("passengerId driverId status").lean();
        if (!ride) {
            return res.status(404).json({ success: false, message: "Ride not found" });
        }

        if (!ACTIVE_RIDE_STATUSES.includes(ride.status)) {
            return res.status(409).json({
                success: false,
                message: "Live sharing is available only during an active ride",
            });
        }

        const party = await resolveRideParty(ride, req.user._id);
        if (!party) {
            return res.status(403).json({ success: false, message: "Access denied" });
        }

        const token = crypto.randomBytes(24).toString("hex");
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

        await Ride.updateOne(
            { _id: ride._id },
            { $set: { shareToken: token, shareTokenExpiresAt: expiresAt } }
        );

        return res.json({
            success: true,
            shareUrl: `${webAppBaseUrl()}/share/ride?token=${token}`,
            token,
            expiresAt,
        });
    } catch (error) {
        console.error("Share link error:", error.message);
        return res.status(500).json({ success: false, message: "Failed to create share link" });
    }
};

// (c) GET /safety/shared/:token — PUBLIC, no auth. Token-gated and
//     deliberately minimal: live position + ride status only, no phone
//     numbers, no full names, no fares.
const getSharedRide = async (req, res) => {
    try {
        const { token } = req.params;
        if (typeof token !== "string" || token.length < 32) {
            return res.status(404).json({ success: false, message: "Share link not found" });
        }

        const ride = await Ride.findOne({ shareToken: token })
            .select("passengerId driverId status vehicleType pickup destination startedAt completedAt shareTokenExpiresAt")
            .lean();

        if (!ride || !ride.shareTokenExpiresAt || new Date(ride.shareTokenExpiresAt) < new Date()) {
            return res.status(404).json({ success: false, message: "Share link expired or not found" });
        }

        let driverLocation = null;
        let driverName = null;
        if (ride.driverId) {
            const driver = await Driver.findById(ride.driverId)
                .select("userId currentLocation lastLocationUpdate")
                .lean();
            const fresh =
                driver?.lastLocationUpdate &&
                Date.now() - new Date(driver.lastLocationUpdate).getTime() < 120000;
            const coords = driver?.currentLocation?.coordinates;
            if (fresh && Array.isArray(coords) && coords.length === 2 && coords.every(Number.isFinite)) {
                driverLocation = {
                    latitude: coords[1],
                    longitude: coords[0],
                    updatedAt: driver.lastLocationUpdate,
                };
            }
            if (driver?.userId) {
                const driverUser = await User.findById(driver.userId).select("firstName").lean();
                driverName = driverUser?.firstName || null;
            }
        }

        return res.json({
            success: true,
            ride: {
                status: ride.status,
                vehicleType: ride.vehicleType,
                driverName,
                pickup: ride.pickup,
                destination: ride.destination,
                startedAt: ride.startedAt || null,
                completedAt: ride.completedAt || null,
                expiresAt: ride.shareTokenExpiresAt,
            },
            driverLocation,
        });
    } catch (error) {
        console.error("Shared ride error:", error.message);
        return res.status(500).json({ success: false, message: "Failed to load shared ride" });
    }
};

// --- Admin side (mounted under /api/v1/admin/safety) ---

// GET /admin/safety/sos-alerts?status=OPEN&page=1
const listSosAlerts = async (req, res) => {
    try {
        const page = Math.max(1, Number(req.query.page) || 1);
        const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
        const filter = {};
        if (["OPEN", "ACKNOWLEDGED", "RESOLVED"].includes(String(req.query.status))) {
            filter.status = req.query.status;
        }

        const [alerts, total] = await Promise.all([
            SosAlert.find(filter)
                .sort({ createdAt: -1 })
                .skip((page - 1) * limit)
                .limit(limit)
                .populate("reporter", "firstName lastName phone")
                .populate("ride", "status vehicleType requestedPrice finalPrice passengerId driverId")
                .lean(),
            SosAlert.countDocuments(filter),
        ]);

        // Attach the OTHER party of each ride so admin sees both sides.
        const enriched = await Promise.all(
            alerts.map(async (alert) => {
                let passenger = null;
                let driver = null;
                const ride = alert.ride || {};
                if (ride.passengerId) {
                    const user = await User.findById(ride.passengerId)
                        .select("firstName lastName phone")
                        .lean();
                    if (user) passenger = { name: personName(user), phone: user.phone || null };
                }
                if (ride.driverId) {
                    const driverDoc = await Driver.findById(ride.driverId).select("userId").lean();
                    if (driverDoc?.userId) {
                        const user = await User.findById(driverDoc.userId)
                            .select("firstName lastName phone")
                            .lean();
                        if (user) driver = { name: personName(user), phone: user.phone || null };
                    }
                }
                return { ...alert, passenger, driver };
            })
        );

        return res.json({
            success: true,
            alerts: enriched,
            total,
            page,
            totalPages: Math.max(1, Math.ceil(total / limit)),
        });
    } catch (error) {
        console.error("List SOS alerts error:", error.message);
        return res.status(500).json({ success: false, message: "Failed to load SOS alerts" });
    }
};

// PATCH /admin/safety/sos-alerts/:id { status, adminNote }
const updateSosAlert = async (req, res) => {
    try {
        const { id } = req.params;
        if (!mongoose.isValidObjectId(id)) {
            return res.status(400).json({ success: false, message: "Invalid alert ID" });
        }
        const { status, adminNote } = req.body || {};
        if (!["OPEN", "ACKNOWLEDGED", "RESOLVED"].includes(status)) {
            return res.status(400).json({ success: false, message: "Invalid status" });
        }

        const update = { status };
        if (typeof adminNote === "string") update.adminNote = adminNote.slice(0, 1000);
        if (status === "ACKNOWLEDGED") {
            update.acknowledgedBy = req.user._id;
            update.acknowledgedAt = new Date();
        }

        const alert = await SosAlert.findByIdAndUpdate(id, { $set: update }, { returnDocument: "after" });
        if (!alert) {
            return res.status(404).json({ success: false, message: "SOS alert not found" });
        }

        return res.json({ success: true, alert });
    } catch (error) {
        console.error("Update SOS alert error:", error.message);
        return res.status(500).json({ success: false, message: "Failed to update SOS alert" });
    }
};

// (d) GET /admin/safety/rides/:rideId/trail — the FIR pack.
const getRideTrail = async (req, res) => {
    try {
        const { rideId } = req.params;
        if (!mongoose.isValidObjectId(rideId)) {
            return res.status(400).json({ success: false, message: "Invalid ride ID" });
        }

        const ride = await Ride.findById(rideId).lean();
        if (!ride) {
            return res.status(404).json({ success: false, message: "Ride not found" });
        }

        const [passengerUser, driverDoc, trail] = await Promise.all([
            ride.passengerId
                ? User.findById(ride.passengerId).select("firstName lastName email phone profileImage rating ratingCount createdAt").lean()
                : null,
            ride.driverId ? Driver.findById(ride.driverId).lean() : null,
            RideLocationTrail.find({ ride: ride._id })
                .sort({ recordedAt: 1 })
                .limit(5000)
                .select("location recordedAt")
                .lean(),
        ]);

        let driverUser = null;
        let vehicle = null;
        if (driverDoc) {
            [driverUser, vehicle] = await Promise.all([
                User.findById(driverDoc.userId).select("firstName lastName email phone profileImage rating ratingCount createdAt").lean(),
                driverDoc.currentVehicleId
                    ? require("../models/Vehicle").findById(driverDoc.currentVehicleId).select("vehicleType make model year color registrationNumber").lean()
                    : null,
            ]);
        }

        return res.json({
            success: true,
            ride: {
                id: String(ride._id),
                status: ride.status,
                vehicleType: ride.vehicleType,
                tripType: ride.tripType,
                pickup: ride.pickup,
                destination: ride.destination,
                stops: ride.stops || [],
                requestedPrice: ride.requestedPrice,
                finalPrice: ride.finalPrice ?? null,
                requestedAt: ride.requestedAt || ride.createdAt,
                acceptedAt: ride.acceptedAt || null,
                startedAt: ride.startedAt || null,
                completedAt: ride.completedAt || null,
                cancelledAt: ride.cancelledAt || null,
                cancellationReason: ride.cancellationReason || null,
            },
            passenger: passengerUser
                ? {
                    name: personName(passengerUser),
                    email: passengerUser.email,
                    phone: passengerUser.phone || null,
                    profileImage: passengerUser.profileImage || null,
                    rating: passengerUser.rating || 0,
                    memberSince: passengerUser.createdAt || null,
                }
                : null,
            driver: driverUser
                ? {
                    name: personName(driverUser),
                    email: driverUser.email,
                    phone: driverUser.phone || null,
                    profileImage: driverUser.profileImage || null,
                    rating: driverUser.rating || 0,
                    memberSince: driverUser.createdAt || null,
                    vehicle: vehicle || null,
                }
                : null,
            trail: trail.map((point) => ({
                latitude: point.location.coordinates[1],
                longitude: point.location.coordinates[0],
                recordedAt: point.recordedAt,
            })),
            trailPoints: trail.length,
        });
    } catch (error) {
        console.error("Ride trail error:", error.message);
        return res.status(500).json({ success: false, message: "Failed to load ride trail" });
    }
};

module.exports = {
    sendSos,
    getPassengerVerification,
    buildPassengerVerification,
    createShareLink,
    getSharedRide,
    listSosAlerts,
    updateSosAlert,
    getRideTrail,
    webAppBaseUrl,
};
