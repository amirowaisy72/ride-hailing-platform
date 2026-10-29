const RentalPartner = require("../models/RentalPartner");
const RentalVehicle = require("../models/RentalVehicle");
const { publishEvent } = require("../services/socketService");
const { sendPushToUser } = require("../services/pushService");
const {
    serializeRentalVehicle,
    windowTouchesBlockedDate,
} = require("../services/rentalBookingService");
const RentalBooking = require("../models/RentalBooking");

// ---------------------------------------------------------------------------
// Phase 5 — Safar Rentals: partner-facing vehicle listing endpoints.
// Mounted under /api/v1/rentals (see routes/rentalRoutes.js), alongside
// the booking controller.
//
// A rental partner is resolved from the caller's User account — the
// Phase 2 RentalPartner record. Listings can only be created by an
// APPROVED partner; every listing then passes admin moderation before
// it becomes bookable (see adminRentalController).
// ---------------------------------------------------------------------------

// Current anti-bypass agreement version. Bump when the agreement text
// changes; partners who accepted an older version keep operating until
// an admin requires re-acceptance (Phase 7 policy hook).
const RENTAL_AGREEMENT_VERSION = "v1";

const loadMyPartner = (userId) => RentalPartner.findOne({ userId });

const validImageUrls = (urls, max = 10) =>
    Array.isArray(urls) &&
    urls.length <= max &&
    urls.every(
        (url) =>
            typeof url === "string" &&
            url.trim().length > 0 &&
            url.length <= 1000
    );

const validPoint = (p) =>
    p &&
    Number.isFinite(p.latitude) &&
    Number.isFinite(p.longitude) &&
    Math.abs(p.latitude) <= 90 &&
    Math.abs(p.longitude) <= 180;

const validMoneyOrNull = (value) =>
    value === null ||
    value === undefined ||
    (Number.isSafeInteger(value) && value >= 1);

const validMoneyOrZero = (value) =>
    value === undefined ||
    (Number.isSafeInteger(value) && value >= 0);

// Validates + normalizes a listing payload for create (partial=false)
// and update (partial=true — only supplied fields are checked). The
// exact pickup fields are accepted here and stored select:false; they
// are never echoed back except through the masked serializer.
function validateVehiclePayload(body, { partial = false } = {}) {
    const has = (field) => body[field] !== undefined;
    const out = {};

    const stringField = (field, max, required) => {
        if (partial && !has(field)) return true;

        const value = body[field];

        if (typeof value !== "string" || value.length > max || (required && !value.trim())) {
            return false;
        }

        out[field] = value.trim();
        return true;
    };

    if (!stringField("brand", 60, true)) return { ok: false, field: "brand" };
    if (!stringField("model", 60, true)) return { ok: false, field: "model" };
    if (!stringField("registrationNumber", 20, true)) return { ok: false, field: "registrationNumber" };
    if (!stringField("fuelPolicy", 300, false)) return { ok: false, field: "fuelPolicy" };
    if (!stringField("tollsNote", 300, false)) return { ok: false, field: "tollsNote" };
    if (!stringField("insuranceNote", 500, false)) return { ok: false, field: "insuranceNote" };
    if (!stringField("pickupAreaLabel", 120, false)) return { ok: false, field: "pickupAreaLabel" };
    if (!stringField("exactPickupAddress", 500, false)) return { ok: false, field: "exactPickupAddress" };
    if (!stringField("pickupContactName", 120, false)) return { ok: false, field: "pickupContactName" };
    if (!stringField("pickupContactPhone", 32, false)) return { ok: false, field: "pickupContactPhone" };

    if (!partial || has("year")) {
        if (!Number.isInteger(body.year) || body.year < 1990 || body.year > 2100) {
            return { ok: false, field: "year" };
        }
        out.year = body.year;
    }

    if (!partial || has("seats")) {
        if (!Number.isInteger(body.seats) || body.seats < 1 || body.seats > 60) {
            return { ok: false, field: "seats" };
        }
        out.seats = body.seats;
    }

    if (!partial || has("transmission")) {
        if (!["MANUAL", "AUTOMATIC"].includes(body.transmission)) {
            return { ok: false, field: "transmission" };
        }
        out.transmission = body.transmission;
    }

    if (has("hasAC")) {
        if (typeof body.hasAC !== "boolean") return { ok: false, field: "hasAC" };
        out.hasAC = body.hasAC;
    }

    if (!partial || has("rentalModes")) {
        const modes = body.rentalModes;

        if (
            !Array.isArray(modes) ||
            modes.length === 0 ||
            !modes.every((m) => ["SELF_DRIVE", "WITH_DRIVER"].includes(m))
        ) {
            return { ok: false, field: "rentalModes" };
        }

        out.rentalModes = [...new Set(modes)];
    }

    if (has("photos")) {
        const photos = body.photos || {};

        for (const group of ["exterior", "interior", "condition"]) {
            if (photos[group] !== undefined && !validImageUrls(photos[group])) {
                return { ok: false, field: `photos.${group}` };
            }
        }

        out.photos = {
            exterior: photos.exterior || [],
            interior: photos.interior || [],
            condition: photos.condition || [],
        };
    }

    if (has("pricing")) {
        const pricing = body.pricing || {};

        for (const unit of ["hourly", "daily", "weekly", "monthly"]) {
            if (!validMoneyOrNull(pricing[unit])) {
                return { ok: false, field: `pricing.${unit}` };
            }
        }

        const anyPriced = ["hourly", "daily", "weekly", "monthly"].some(
            (unit) => Number.isSafeInteger(pricing[unit]) && pricing[unit] >= 1
        );

        if (!anyPriced) return { ok: false, field: "pricing" };

        out.pricing = {
            hourly: pricing.hourly ?? null,
            daily: pricing.daily ?? null,
            weekly: pricing.weekly ?? null,
            monthly: pricing.monthly ?? null,
        };
    }

    if (has("mileageLimitKmPerDay") && !validMoneyOrNull(body.mileageLimitKmPerDay)) {
        return { ok: false, field: "mileageLimitKmPerDay" };
    }
    if (has("mileageLimitKmPerDay")) out.mileageLimitKmPerDay = body.mileageLimitKmPerDay ?? null;

    for (const field of ["extraKmFee", "overtimeFeePerHour", "securityDeposit"]) {
        if (!validMoneyOrZero(body[field])) return { ok: false, field };
        if (has(field)) out[field] = body[field];
    }

    if (has("cancellationPolicy")) {
        if (!["FLEXIBLE", "MODERATE", "STRICT"].includes(body.cancellationPolicy)) {
            return { ok: false, field: "cancellationPolicy" };
        }
        out.cancellationPolicy = body.cancellationPolicy;
    }

    if (!partial || has("pickupArea")) {
        if (!validPoint(body.pickupArea)) return { ok: false, field: "pickupArea" };

        out.pickupArea = {
            type: "Point",
            coordinates: [body.pickupArea.longitude, body.pickupArea.latitude],
            address: String(body.pickupArea.address || "").slice(0, 300),
        };
    }

    return { ok: true, values: out };
}

// ---------------------------------------------------------------------------
// Anti-bypass agreement
// ---------------------------------------------------------------------------

const acceptRentalAgreement = async (req, res) => {
    try {
        const partner = await loadMyPartner(req.user._id);

        if (!partner) {
            return res.status(404).json({
                success: false,
                message: "Rental partner profile not found",
            });
        }

        partner.agreementAcceptedAt = new Date();
        partner.agreementVersion = RENTAL_AGREEMENT_VERSION;

        await partner.save();

        return res.json({
            success: true,
            message: "Rental partner agreement accepted",
            agreementVersion: partner.agreementVersion,
            agreementAcceptedAt: partner.agreementAcceptedAt,
        });
    } catch (error) {
        console.error("Rental agreement accept error:", error.message);
        return res.status(500).json({
            success: false,
            message: "Unable to accept the agreement",
        });
    }
};

const getRentalAgreementState = async (req, res) => {
    try {
        const partner = await loadMyPartner(req.user._id);

        if (!partner) {
            return res.status(404).json({
                success: false,
                message: "Rental partner profile not found",
            });
        }

        return res.json({
            success: true,
            agreementVersion: RENTAL_AGREEMENT_VERSION,
            acceptedVersion: partner.agreementVersion,
            agreementAcceptedAt: partner.agreementAcceptedAt,
            accepted: partner.agreementAcceptedAt != null,
        });
    } catch {
        return res.status(500).json({
            success: false,
            message: "Unable to load agreement state",
        });
    }
};

// ---------------------------------------------------------------------------
// Partner: my listings CRUD
// ---------------------------------------------------------------------------

const createRentalVehicle = async (req, res) => {
    try {
        const partner = await loadMyPartner(req.user._id);

        if (!partner) {
            return res.status(404).json({
                success: false,
                message: "Rental partner profile not found",
            });
        }

        if (partner.applicationStatus !== "APPROVED") {
            return res.status(403).json({
                success: false,
                message: "Your rental partner application is not approved yet",
            });
        }

        const check = validateVehiclePayload(req.body || {});

        if (!check.ok) {
            return res.status(400).json({
                success: false,
                message: `Invalid vehicle field: ${check.field}`,
            });
        }

        const vehicle = await RentalVehicle.create({
            ...check.values,
            rentalPartnerId: partner._id,
            partnerUserId: req.user._id,
            listingStatus: "PENDING",
        });

        // The owner sees their own listing masked like everyone else —
        // exact fields are write-only through this API.
        return res.status(201).json({
            success: true,
            vehicle: serializeRentalVehicle(vehicle),
        });
    } catch (error) {
        console.error("Create rental vehicle error:", error.message);
        return res.status(500).json({
            success: false,
            message: "Unable to create vehicle listing",
        });
    }
};

const getMyRentalVehicles = async (req, res) => {
    try {
        const partner = await loadMyPartner(req.user._id);

        if (!partner) {
            return res.status(404).json({
                success: false,
                message: "Rental partner profile not found",
            });
        }

        const vehicles = await RentalVehicle.find({
            rentalPartnerId: partner._id,
        })
            .sort({ createdAt: -1 })
            .lean();

        return res.json({
            success: true,
            vehicles: vehicles.map((v) => serializeRentalVehicle(v)),
        });
    } catch {
        return res.status(500).json({
            success: false,
            message: "Unable to load your vehicles",
        });
    }
};

const loadOwnedVehicle = async (req) => {
    const partner = await loadMyPartner(req.user._id);

    if (!partner) return { partner: null, vehicle: null };

    const vehicle = await RentalVehicle.findOne({
        _id: req.params.vehicleId,
        rentalPartnerId: partner._id,
    });

    return { partner, vehicle };
};

const updateRentalVehicle = async (req, res) => {
    try {
        const { vehicle } = await loadOwnedVehicle(req);

        if (!vehicle) {
            return res.status(404).json({
                success: false,
                message: "Vehicle listing not found",
            });
        }

        const check = validateVehiclePayload(req.body || {}, { partial: true });

        if (!check.ok) {
            return res.status(400).json({
                success: false,
                message: `Invalid vehicle field: ${check.field}`,
            });
        }

        Object.assign(vehicle, check.values);

        // Material edits to a live listing return it to moderation —
        // a partner cannot quietly swap the car behind an APPROVED
        // listing. (Calendar/activation changes have their own routes
        // and do NOT re-trigger moderation.)
        if (vehicle.listingStatus === "APPROVED") {
            vehicle.listingStatus = "PENDING";
            vehicle.moderatedAt = null;
            vehicle.moderatedBy = null;
            vehicle.moderationNote = "";
        }

        await vehicle.save();

        return res.json({
            success: true,
            vehicle: serializeRentalVehicle(vehicle),
        });
    } catch (error) {
        console.error("Update rental vehicle error:", error.message);
        return res.status(500).json({
            success: false,
            message: "Unable to update vehicle listing",
        });
    }
};

const setRentalVehicleActive = async (req, res) => {
    try {
        const { vehicle } = await loadOwnedVehicle(req);

        if (!vehicle) {
            return res.status(404).json({
                success: false,
                message: "Vehicle listing not found",
            });
        }

        if (typeof req.body?.isActive !== "boolean") {
            return res.status(400).json({
                success: false,
                message: "isActive must be a boolean",
            });
        }

        vehicle.isActive = req.body.isActive;
        await vehicle.save();

        return res.json({
            success: true,
            vehicle: serializeRentalVehicle(vehicle),
        });
    } catch {
        return res.status(500).json({
            success: false,
            message: "Unable to update vehicle availability",
        });
    }
};

const deleteRentalVehicle = async (req, res) => {
    try {
        const { vehicle } = await loadOwnedVehicle(req);

        if (!vehicle) {
            return res.status(404).json({
                success: false,
                message: "Vehicle listing not found",
            });
        }

        // A listing with a live or upcoming holding booking cannot be
        // deleted out from under the passenger.
        const live = await RentalBooking.exists({
            vehicleId: vehicle._id,
            status: {
                $in: [
                    "REQUESTED",
                    "PROVIDER_ACCEPTED",
                    "PAYMENT_PENDING",
                    "CONFIRMED",
                    "PICKUP_VERIFIED",
                    "RENTAL_ACTIVE",
                    "RETURN_PENDING",
                ],
            },
        });

        if (live) {
            return res.status(409).json({
                success: false,
                message: "This vehicle has active or upcoming bookings and cannot be deleted",
            });
        }

        await RentalVehicle.deleteOne({ _id: vehicle._id });

        return res.json({ success: true, message: "Vehicle listing deleted" });
    } catch {
        return res.status(500).json({
            success: false,
            message: "Unable to delete vehicle listing",
        });
    }
};

// ---------------------------------------------------------------------------
// Partner: availability calendar (blocked dates)
// ---------------------------------------------------------------------------

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const setRentalVehicleBlockedDates = async (req, res) => {
    try {
        const { vehicle } = await loadOwnedVehicle(req);

        if (!vehicle) {
            return res.status(404).json({
                success: false,
                message: "Vehicle listing not found",
            });
        }

        const { blockedDates } = req.body || {};

        if (
            !Array.isArray(blockedDates) ||
            blockedDates.length > 366 ||
            !blockedDates.every(
                (d) => typeof d === "string" && DATE_KEY_PATTERN.test(d)
            )
        ) {
            return res.status(400).json({
                success: false,
                message: "blockedDates must be an array of YYYY-MM-DD dates",
            });
        }

        const unique = [...new Set(blockedDates)].sort();

        // Blocking a day that an existing holding booking already
        // occupies would strand that passenger — refuse and say which.
        const holding = await RentalBooking.find({
            vehicleId: vehicle._id,
            status: {
                $in: ["PROVIDER_ACCEPTED", "PAYMENT_PENDING", "CONFIRMED", "PICKUP_VERIFIED", "RENTAL_ACTIVE", "RETURN_PENDING"],
            },
        })
            .select("startAt endAt")
            .lean();

        const conflict = holding.find((booking) =>
            windowTouchesBlockedDate(unique, booking.startAt, booking.endAt)
        );

        if (conflict) {
            return res.status(409).json({
                success: false,
                message: "One of those dates overlaps an existing booking",
            });
        }

        vehicle.blockedDates = unique;
        await vehicle.save();

        return res.json({
            success: true,
            vehicle: serializeRentalVehicle(vehicle),
        });
    } catch (error) {
        console.error("Set blocked dates error:", error.message);
        return res.status(500).json({
            success: false,
            message: "Unable to update the availability calendar",
        });
    }
};

// Re-exported so the booking controller can share the notify pattern
// without a circular import.
const notifyUser = (userId, { event, room, payload, title, body, data }) => {
    if (room && event) {
        publishEvent(event, room, payload);
    }

    if (userId && title) {
        void sendPushToUser(userId, title, body, data || {});
    }
};

module.exports = {
    RENTAL_AGREEMENT_VERSION,
    loadMyPartner,
    validImageUrls,
    notifyUser,
    acceptRentalAgreement,
    getRentalAgreementState,
    createRentalVehicle,
    getMyRentalVehicles,
    updateRentalVehicle,
    setRentalVehicleActive,
    deleteRentalVehicle,
    setRentalVehicleBlockedDates,
};
