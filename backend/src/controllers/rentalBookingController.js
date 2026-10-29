const crypto = require("node:crypto");

const RentalPartner = require("../models/RentalPartner");
const RentalVehicle = require("../models/RentalVehicle");
const RentalBooking = require("../models/RentalBooking");
const RentalReview = require("../models/RentalReview");
const CommissionSettings = require("../models/CommissionSettings");
const { loadMyPartner, notifyUser } = require("./rentalVehicleController");
const {
    canTransition,
    canDispute,
    resolveCancelOutcome,
    computeRentalCharges,
    computeBookingAmounts,
    resolveFeeRefund,
    findBlockingBooking,
    windowTouchesBlockedDate,
    isHoldExpired,
    evaluateModeEligibility,
    evaluateChauffeurEligibility,
    computeRemainingDues,
    serializeRentalVehicle,
    isContactUnlocked,
} = require("../services/rentalBookingService");

// ---------------------------------------------------------------------------
// Phase 5 — Safar Rentals booking controller (passenger + partner).
// Mounted under /api/v1/rentals (see routes/rentalRoutes.js). Admin
// endpoints live in controllers/adminRentalController.js.
//
// Patterns mirror controllers/purchaseController.js: every handler
// re-checks ownership server-side, status moves happen ONLY through
// atomic status-guarded updates, the OTP is the parcel SHA-256 hash
// pattern with a 5-attempt atomic cap, and notifications pair a
// Socket.IO room event (foreground) with an FCM push (background).
//
// The anti-bypass rules are enforced HERE, not in a UI:
//  - listings/bookings are only ever serialized through
//    serializeRentalVehicle / serializeBooking, which withhold the
//    exact pickup address + contact until a booking is CONFIRMED;
//  - no transition to CONFIRMED exists without an admin-VERIFIED
//    manual fee payment (see adminRentalController.verifyRentalFeePayment).
// ---------------------------------------------------------------------------

const hashRentalOtp = (otp) =>
    crypto.createHash("sha256").update(String(otp)).digest("hex");

const createRentalOtp = () => String(crypto.randomInt(100000, 1000000));

const createBookingRef = () =>
    `SRB-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;

const getGlobalSettings = () =>
    CommissionSettings.findOne({ key: "GLOBAL" }).lean();

const makeEvent = (type, actorRole, actorId, fields = {}) => ({
    type,
    actorRole,
    actorId: actorId || null,
    fromStatus: fields.fromStatus || null,
    toStatus: fields.toStatus || null,
    amount: Number.isSafeInteger(fields.amount) ? fields.amount : null,
    note: typeof fields.note === "string" ? fields.note.slice(0, 500) : "",
    createdAt: new Date(),
});

// Atomic, status-guarded transition + audit event. Returns the updated
// booking, or null when the booking is no longer in `fromStatus` —
// callers map null to 409. `flags` are forwarded to canTransition so
// the OTP / fee-verification gates live in exactly one place.
const transitionBooking = async ({ filter, fromStatus, toStatus, set = {}, event, flags = {} }) => {
    if (!canTransition(fromStatus, toStatus, flags)) {
        return null;
    }

    return RentalBooking.findOneAndUpdate(
        { ...filter, status: fromStatus },
        {
            $set: { ...set, status: toStatus },
            ...(event ? { $push: { events: event.entry } } : {}),
        },
        { new: true, runValidators: true }
    );
};

// Lazy hold expiry: a PROVIDER_ACCEPTED / PAYMENT_PENDING booking past
// its payment deadline is cancelled by the system the next time anyone
// touches it, releasing the vehicle. Returns the (possibly updated)
// booking.
const expireHoldIfNeeded = async (booking) => {
    if (!booking || !isHoldExpired(booking)) return booking;

    const updated = await transitionBooking({
        filter: { _id: booking._id },
        fromStatus: booking.status,
        toStatus: "CANCELLED",
        set: {
            cancelledBy: null,
            cancelReason: "Booking fee was not paid before the deadline",
            cancelledAt: new Date(),
        },
        event: {
            entry: makeEvent("HOLD_EXPIRED", "SYSTEM", null, {
                fromStatus: booking.status,
                toStatus: "CANCELLED",
            }),
        },
    });

    if (updated) {
        notifyUser(updated.passengerId, {
            event: "rental:booking:updated",
            room: `passenger:${updated.passengerId}`,
            payload: {
                bookingId: String(updated._id),
                bookingRef: updated.bookingRef,
                status: "CANCELLED",
                message: "The booking expired because the fee was not paid in time",
            },
            title: "Booking Expired",
            body: "The booking fee was not paid before the deadline, so the vehicle was released.",
            data: { type: "RENTAL_BOOKING_EXPIRED", bookingId: String(updated._id) },
        });

        notifyUser(updated.partnerUserId, {
            event: "rental:booking:updated",
            room: `user:${updated.partnerUserId}`,
            payload: {
                bookingId: String(updated._id),
                bookingRef: updated.bookingRef,
                status: "CANCELLED",
                message: "A booking hold expired unpaid",
            },
            title: "Booking Hold Expired",
            body: "A booking hold expired without fee payment. The vehicle is available again.",
            data: { type: "RENTAL_BOOKING_EXPIRED", bookingId: String(updated._id) },
        });
    }

    return updated || booking;
};

const notifyPassenger = (booking, payload, title, body, type) => {
    notifyUser(booking.passengerId, {
        event: "rental:booking:updated",
        room: `passenger:${booking.passengerId}`,
        payload: {
            bookingId: String(booking._id),
            bookingRef: booking.bookingRef,
            ...payload,
        },
        title,
        body,
        data: { type, bookingId: String(booking._id) },
    });
};

const notifyPartner = (booking, event, payload, title, body, type) => {
    notifyUser(booking.partnerUserId, {
        event,
        room: `user:${booking.partnerUserId}`,
        payload: {
            bookingId: String(booking._id),
            bookingRef: booking.bookingRef,
            ...payload,
        },
        title,
        body,
        data: { type, bookingId: String(booking._id) },
    });
};

// Booking serializer: embeds the vehicle through the masking
// serializer. The exact pickup details unlock ONLY for this booking's
// own parties once the booking is CONFIRMED or later — a passenger
// browsing someone else's booking can never exist (ownership filters),
// and admins use their own endpoints.
const serializeBooking = (booking, vehicle) => {
    const b =
        typeof booking.toObject === "function" ? booking.toObject() : booking;

    return {
        ...b,
        pickupOtpHash: undefined,
        vehicle: vehicle
            ? serializeRentalVehicle(vehicle, {
                unlocked: isContactUnlocked(booking),
            })
            : undefined,
    };
};

const loadBookingWithVehicle = async (filter) => {
    const booking = await RentalBooking.findOne(filter);

    if (!booking) return { booking: null, vehicle: null };

    const vehicle = await RentalVehicle.findById(booking.vehicleId)
        .select("+exactPickupAddress +pickupContactName +pickupContactPhone")
        .lean();

    return { booking, vehicle };
};

// Vehicles currently holding the requested window for `vehicleId`,
// shaped for the pure overlap guard.
const loadHoldingBookings = async (vehicleId) => {
    return RentalBooking.find({
        vehicleId,
        status: {
            $in: [
                "PROVIDER_ACCEPTED",
                "PAYMENT_PENDING",
                "CONFIRMED",
                "PICKUP_VERIFIED",
                "RENTAL_ACTIVE",
                "RETURN_PENDING",
            ],
        },
    })
        .select("status startAt endAt paymentDeadlineAt")
        .lean();
};

// ---------------------------------------------------------------------------
// Passenger: search + vehicle detail (masked, always)
// ---------------------------------------------------------------------------

const searchRentalVehicles = async (req, res) => {
    try {
        const settings = await getGlobalSettings();

        if (settings?.rentalsEnabled === false) {
            return res.status(403).json({
                success: false,
                message: "Safar Rentals is currently disabled",
            });
        }

        const {
            mode,
            startAt,
            endAt,
            latitude,
            longitude,
            radiusKm,
            transmission,
            minSeats,
            maxDailyPrice,
        } = req.query || {};

        const filter = { listingStatus: "APPROVED", isActive: true };

        if (mode) {
            if (!["SELF_DRIVE", "WITH_DRIVER"].includes(mode)) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid rental mode",
                });
            }

            // Launch gate: while Self-Drive is disabled platform-wide,
            // searching for it returns nothing rather than teasing
            // listings nobody may book.
            if (mode === "SELF_DRIVE" && settings?.rentalsSelfDriveEnabled !== true) {
                return res.json({ success: true, vehicles: [] });
            }

            filter.rentalModes = mode;
        }

        if (transmission) {
            if (!["MANUAL", "AUTOMATIC"].includes(transmission)) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid transmission",
                });
            }
            filter.transmission = transmission;
        }

        if (minSeats !== undefined) {
            const seats = Number(minSeats);
            if (!Number.isInteger(seats) || seats < 1) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid minSeats",
                });
            }
            filter.seats = { $gte: seats };
        }

        if (maxDailyPrice !== undefined) {
            const price = Number(maxDailyPrice);
            if (!Number.isSafeInteger(price) || price < 1) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid maxDailyPrice",
                });
            }
            filter["pricing.daily"] = { $lte: price, $gte: 1 };
        }

        const lat = Number(latitude);
        const lng = Number(longitude);

        if (Number.isFinite(lat) && Number.isFinite(lng)) {
            const radius = Number.isFinite(Number(radiusKm))
                ? Math.min(Math.max(Number(radiusKm), 1), 200)
                : 50;

            filter.pickupArea = {
                $near: {
                    $geometry: { type: "Point", coordinates: [lng, lat] },
                    $maxDistance: radius * 1000,
                },
            };
        }

        let vehicles = await RentalVehicle.find(filter).limit(100).lean();

        // Date-window availability: drop vehicles blocked by the
        // partner or held by another booking for the window.
        const start = startAt ? new Date(startAt) : null;
        const end = endAt ? new Date(endAt) : null;

        if (
            start && end &&
            Number.isFinite(start.getTime()) &&
            Number.isFinite(end.getTime()) &&
            end > start
        ) {
            const available = [];

            for (const vehicle of vehicles) {
                if (windowTouchesBlockedDate(vehicle.blockedDates, start, end)) {
                    continue;
                }

                const holding = await loadHoldingBookings(vehicle._id);
                const blocker = findBlockingBooking(holding, {
                    startAt: start,
                    endAt: end,
                });

                if (!blocker) available.push(vehicle);
            }

            vehicles = available;
        }

        return res.json({
            success: true,
            vehicles: vehicles.map((v) => serializeRentalVehicle(v)),
        });
    } catch (error) {
        console.error("Rental search error:", error.message);
        return res.status(500).json({
            success: false,
            message: "Unable to search rental vehicles",
        });
    }
};

const getRentalVehicleDetails = async (req, res) => {
    try {
        const vehicle = await RentalVehicle.findOne({
            _id: req.params.vehicleId,
            listingStatus: "APPROVED",
            isActive: true,
        }).lean();

        if (!vehicle) {
            return res.status(404).json({
                success: false,
                message: "Vehicle not found",
            });
        }

        // Browsing is NEVER unlocked — exact details only ever travel
        // inside a confirmed booking's serializer.
        return res.json({
            success: true,
            vehicle: serializeRentalVehicle(vehicle),
        });
    } catch {
        return res.status(400).json({
            success: false,
            message: "Invalid vehicle ID",
        });
    }
};

// ---------------------------------------------------------------------------
// Passenger: create booking request
// ---------------------------------------------------------------------------

const createRentalBooking = async (req, res) => {
    try {
        const settings = await getGlobalSettings();

        if (settings?.rentalsEnabled === false) {
            return res.status(403).json({
                success: false,
                message: "Safar Rentals is currently disabled",
            });
        }

        const { vehicleId, mode, startAt, endAt, billingUnit } = req.body || {};
        const start = new Date(startAt);
        const end = new Date(endAt);

        if (
            !vehicleId ||
            !["SELF_DRIVE", "WITH_DRIVER"].includes(mode) ||
            !Number.isFinite(start.getTime()) ||
            !Number.isFinite(end.getTime()) ||
            end <= start ||
            start < new Date(Date.now() - 60 * 1000)
        ) {
            return res.status(400).json({
                success: false,
                message: "Invalid booking request details",
            });
        }

        const vehicle = await RentalVehicle.findOne({
            _id: vehicleId,
            listingStatus: "APPROVED",
            isActive: true,
        });

        if (!vehicle) {
            return res.status(404).json({
                success: false,
                message: "Vehicle not available for booking",
            });
        }

        const partner = await RentalPartner.findById(vehicle.rentalPartnerId)
            .select("applicationStatus providesChauffeur chauffeurVerificationStatus")
            .lean();

        if (!partner || partner.applicationStatus !== "APPROVED") {
            return res.status(409).json({
                success: false,
                message: "This rental partner is not currently bookable",
            });
        }

        const renterLicence =
            mode === "SELF_DRIVE"
                ? {
                    number: String(req.body?.renterLicence?.number || ""),
                    expiryDate: req.body?.renterLicence?.expiryDate || null,
                }
                : null;

        const modeCheck = evaluateModeEligibility({
            vehicle,
            mode,
            selfDriveEnabled: settings?.rentalsSelfDriveEnabled === true,
            renterLicence,
        });

        if (!modeCheck.ok) {
            return res.status(400).json({
                success: false,
                code: modeCheck.code,
                message: modeCheck.message,
            });
        }

        const chauffeurCheck = evaluateChauffeurEligibility({ partner, mode });

        if (!chauffeurCheck.ok) {
            return res.status(409).json({
                success: false,
                code: chauffeurCheck.code,
                message: chauffeurCheck.message,
            });
        }

        if (windowTouchesBlockedDate(vehicle.blockedDates, start, end)) {
            return res.status(409).json({
                success: false,
                message: "The vehicle is not available on those dates",
            });
        }

        const holding = await loadHoldingBookings(vehicle._id);
        const blocker = findBlockingBooking(holding, { startAt: start, endAt: end });

        if (blocker) {
            return res.status(409).json({
                success: false,
                message: "The vehicle is already booked for part of that window",
            });
        }

        const charges = computeRentalCharges({
            pricing: vehicle.pricing,
            startAt: start,
            endAt: end,
            billingUnit: billingUnit || null,
        });

        if (!charges.ok) {
            return res.status(400).json({
                success: false,
                code: charges.code,
                message: charges.message,
            });
        }

        const amounts = computeBookingAmounts({
            rentalCharges: charges.rentalCharges,
            securityDeposit: vehicle.securityDeposit ?? 0,
            feePercent: settings?.rentalBookingFeePercent ?? 5,
        });

        if (!amounts.ok) {
            return res.status(500).json({
                success: false,
                message: "Unable to price this booking",
            });
        }

        const booking = await RentalBooking.create({
            bookingRef: createBookingRef(),
            passengerId: req.user._id,
            rentalPartnerId: vehicle.rentalPartnerId,
            partnerUserId: vehicle.partnerUserId,
            vehicleId: vehicle._id,
            status: "REQUESTED",
            mode,
            startAt: start,
            endAt: end,
            billingUnit: charges.billingUnit,
            units: charges.units,
            ratePerUnit: charges.ratePerUnit,
            rentalCharges: amounts.rentalCharges,
            bookingFee: amounts.bookingFee,
            bookingFeePercent: amounts.bookingFeePercent,
            securityDeposit: amounts.securityDeposit,
            renterLicence: renterLicence
                ? {
                    number: renterLicence.number.trim(),
                    expiryDate: renterLicence.expiryDate
                        ? new Date(renterLicence.expiryDate)
                        : null,
                }
                : { number: null, expiryDate: null },
            events: [
                makeEvent("BOOKING_REQUESTED", "PASSENGER", req.user._id, {
                    toStatus: "REQUESTED",
                    amount: amounts.rentalCharges,
                }),
            ],
        });

        notifyPartner(
            booking,
            "rental:request:new",
            {
                status: "REQUESTED",
                mode,
                rentalCharges: amounts.rentalCharges,
                message: "New rental booking request",
            },
            "New Rental Request",
            "A passenger requested one of your vehicles.",
            "RENTAL_REQUEST_NEW"
        );

        const fullVehicle = await RentalVehicle.findById(vehicle._id)
            .select("+exactPickupAddress +pickupContactName +pickupContactPhone")
            .lean();

        return res.status(201).json({
            success: true,
            booking: serializeBooking(booking, fullVehicle),
        });
    } catch (error) {
        console.error("Create rental booking error:", error.message);
        return res.status(500).json({
            success: false,
            message: "Unable to create booking request",
        });
    }
};

const getMyRentalBookings = async (req, res) => {
    try {
        const bookings = await RentalBooking.find({
            passengerId: req.user._id,
        })
            .sort({ createdAt: -1 })
            .limit(50)
            .lean();

        const vehicleIds = [...new Set(bookings.map((b) => String(b.vehicleId)))];
        const vehicles = vehicleIds.length
            ? await RentalVehicle.find({ _id: { $in: vehicleIds } })
                .select("+exactPickupAddress +pickupContactName +pickupContactPhone")
                .lean()
            : [];
        const byId = new Map(vehicles.map((v) => [String(v._id), v]));

        // Touching the list lazily releases any expired holds.
        const serialized = [];

        for (const raw of bookings) {
            let booking = raw;

            if (isHoldExpired(booking)) {
                const doc = await RentalBooking.findById(booking._id);
                const updated = await expireHoldIfNeeded(doc);
                booking = updated ? updated.toObject() : booking;
            }

            serialized.push(
                serializeBooking(booking, byId.get(String(booking.vehicleId)))
            );
        }

        return res.json({ success: true, bookings: serialized });
    } catch {
        return res.status(500).json({
            success: false,
            message: "Unable to load bookings",
        });
    }
};

const getRentalBookingDetails = async (req, res) => {
    try {
        const { booking, vehicle } = await loadBookingWithVehicle({
            _id: req.params.id,
            passengerId: req.user._id,
        });

        if (!booking) {
            return res.status(404).json({
                success: false,
                message: "Booking not found",
            });
        }

        const fresh = await expireHoldIfNeeded(booking);

        return res.json({
            success: true,
            booking: serializeBooking(fresh, vehicle),
        });
    } catch {
        return res.status(400).json({
            success: false,
            message: "Invalid booking ID",
        });
    }
};

// ---------------------------------------------------------------------------
// Partner: booking requests + accept / reject
// ---------------------------------------------------------------------------

const loadPartnerBooking = async (req) => {
    const partner = await loadMyPartner(req.user._id);

    if (!partner) return { partner: null, booking: null, vehicle: null };

    const { booking, vehicle } = await loadBookingWithVehicle({
        _id: req.params.id,
        rentalPartnerId: partner._id,
    });

    return { partner, booking, vehicle };
};

const getPartnerRentalBookings = async (req, res) => {
    try {
        const partner = await loadMyPartner(req.user._id);

        if (!partner) {
            return res.status(404).json({
                success: false,
                message: "Rental partner profile not found",
            });
        }

        const { status } = req.query || {};
        const filter = { rentalPartnerId: partner._id };

        if (status) {
            if (![
                "REQUESTED", "PROVIDER_ACCEPTED", "PAYMENT_PENDING", "CONFIRMED",
                "PICKUP_VERIFIED", "RENTAL_ACTIVE", "RETURN_PENDING", "COMPLETED",
                "CANCELLED", "NO_SHOW", "DISPUTED",
            ].includes(status)) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid booking status filter",
                });
            }
            filter.status = status;
        }

        const bookings = await RentalBooking.find(filter)
            .sort({ createdAt: -1 })
            .limit(100)
            .lean();

        const vehicleIds = [...new Set(bookings.map((b) => String(b.vehicleId)))];
        const vehicles = vehicleIds.length
            ? await RentalVehicle.find({ _id: { $in: vehicleIds } })
                .select("+exactPickupAddress +pickupContactName +pickupContactPhone")
                .lean()
            : [];
        const byId = new Map(vehicles.map((v) => [String(v._id), v]));

        return res.json({
            success: true,
            bookings: bookings.map((b) =>
                serializeBooking(b, byId.get(String(b.vehicleId)))
            ),
        });
    } catch {
        return res.status(500).json({
            success: false,
            message: "Unable to load bookings",
        });
    }
};

const getPartnerRentalBookingDetails = async (req, res) => {
    try {
        const { booking, vehicle } = await loadPartnerBooking(req);

        if (!booking) {
            return res.status(404).json({
                success: false,
                message: "Booking not found",
            });
        }

        const fresh = await expireHoldIfNeeded(booking);

        return res.json({
            success: true,
            booking: serializeBooking(fresh, vehicle),
        });
    } catch {
        return res.status(400).json({
            success: false,
            message: "Invalid booking ID",
        });
    }
};

const acceptRentalBooking = async (req, res) => {
    try {
        const { partner, booking } = await loadPartnerBooking(req);

        if (!partner || !booking) {
            return res.status(404).json({
                success: false,
                message: "Booking not found",
            });
        }

        if (booking.status !== "REQUESTED") {
            return res.status(409).json({
                success: false,
                message: "This request is no longer awaiting a response",
            });
        }

        // Re-run the guards at accept time: the calendar may have
        // changed since the request was created (another booking was
        // accepted first, or the partner blocked the dates).
        const vehicle = await RentalVehicle.findById(booking.vehicleId);

        if (!vehicle || vehicle.listingStatus !== "APPROVED" || !vehicle.isActive) {
            return res.status(409).json({
                success: false,
                message: "This vehicle listing is not currently bookable",
            });
        }

        if (windowTouchesBlockedDate(vehicle.blockedDates, booking.startAt, booking.endAt)) {
            return res.status(409).json({
                success: false,
                message: "Those dates are now blocked on your calendar",
            });
        }

        const holding = await loadHoldingBookings(vehicle._id);
        const blocker = findBlockingBooking(
            holding,
            { startAt: booking.startAt, endAt: booking.endAt },
            { excludeBookingId: booking._id }
        );

        if (blocker) {
            return res.status(409).json({
                success: false,
                message: "The vehicle is already promised for part of that window",
            });
        }

        const settings = await getGlobalSettings();
        const deadlineHours = settings?.rentalPaymentDeadlineHours ?? 24;
        const paymentDeadlineAt = new Date(
            Date.now() + deadlineHours * 60 * 60 * 1000
        );
        const pickupOtp = createRentalOtp();

        // The hold itself is placed by this atomic, status-guarded
        // transition: only the first accept can win. The pickup OTP
        // hash is planted now and revealed to the passenger (their own
        // endpoint) so they can present it at handover.
        const updated = await transitionBooking({
            filter: { _id: booking._id, rentalPartnerId: partner._id },
            fromStatus: "REQUESTED",
            toStatus: "PROVIDER_ACCEPTED",
            set: {
                acceptedAt: new Date(),
                paymentDeadlineAt,
                pickupOtpHash: hashRentalOtp(pickupOtp),
                pickupOtpAttempts: 0,
            },
            event: {
                entry: makeEvent("BOOKING_ACCEPTED", "PARTNER", req.user._id, {
                    fromStatus: "REQUESTED",
                    toStatus: "PROVIDER_ACCEPTED",
                }),
            },
        });

        if (!updated) {
            return res.status(409).json({
                success: false,
                message: "Booking status changed. Please refresh.",
            });
        }

        notifyPassenger(
            updated,
            { status: "PROVIDER_ACCEPTED", message: "Your booking request was accepted" },
            "Booking Accepted",
            "The rental partner accepted your request. Please pay the booking fee to confirm.",
            "RENTAL_BOOKING_ACCEPTED"
        );

        return res.json({ success: true, booking: serializeBooking(updated, vehicle) });
    } catch (error) {
        console.error("Accept rental booking error:", error.message);
        return res.status(500).json({
            success: false,
            message: "Unable to accept booking",
        });
    }
};

const rejectRentalBooking = async (req, res) => {
    try {
        const { partner, booking } = await loadPartnerBooking(req);

        if (!partner || !booking) {
            return res.status(404).json({
                success: false,
                message: "Booking not found",
            });
        }

        if (booking.status !== "REQUESTED") {
            return res.status(409).json({
                success: false,
                message: "This request is no longer awaiting a response",
            });
        }

        const reason = String(req.body?.reason || "").slice(0, 500);

        // A provider decline ends the request. It is recorded as a
        // PARTNER cancellation with the reason preserved, so the
        // cancellation-monitoring aggregation can tell a genuine
        // decline apart from post-fee games.
        const updated = await transitionBooking({
            filter: { _id: booking._id, rentalPartnerId: partner._id },
            fromStatus: "REQUESTED",
            toStatus: "CANCELLED",
            set: {
                cancelledBy: "PARTNER",
                cancelReason: reason || "Provider declined the request",
                cancelledAt: new Date(),
            },
            event: {
                entry: makeEvent("BOOKING_DECLINED", "PARTNER", req.user._id, {
                    fromStatus: "REQUESTED",
                    toStatus: "CANCELLED",
                    note: reason,
                }),
            },
        });

        if (!updated) {
            return res.status(409).json({
                success: false,
                message: "Booking status changed. Please refresh.",
            });
        }

        notifyPassenger(
            updated,
            { status: "CANCELLED", message: "The rental partner declined your request" },
            "Request Declined",
            "The rental partner could not accept your booking request.",
            "RENTAL_BOOKING_DECLINED"
        );

        return res.json({ success: true, booking: serializeBooking(updated, null) });
    } catch {
        return res.status(400).json({
            success: false,
            message: "Unable to decline booking",
        });
    }
};

// ---------------------------------------------------------------------------
// Passenger: booking-fee manual payment
// ---------------------------------------------------------------------------

// The platform's receiving bank details + the fee due, disclosed to
// the passenger BEFORE they pay (Amir's plan: the fee is a separate,
// disclosed line — never hidden inside the rental price).
const getRentalFeeInstructions = async (req, res) => {
    try {
        const { booking } = await loadBookingWithVehicle({
            _id: req.params.id,
            passengerId: req.user._id,
        });

        if (!booking) {
            return res.status(404).json({
                success: false,
                message: "Booking not found",
            });
        }

        const fresh = await expireHoldIfNeeded(booking);

        if (!["PROVIDER_ACCEPTED", "PAYMENT_PENDING"].includes(fresh.status)) {
            return res.status(409).json({
                success: false,
                message: "Fee payment is not due at this stage",
            });
        }

        const settings = await getGlobalSettings();

        return res.json({
            success: true,
            bookingRef: fresh.bookingRef,
            bookingFee: fresh.bookingFee,
            bookingFeePercent: fresh.bookingFeePercent,
            rentalCharges: fresh.rentalCharges,
            securityDeposit: fresh.securityDeposit,
            paymentDeadlineAt: fresh.paymentDeadlineAt,
            bank: {
                bankName: settings?.bankName || "",
                bankAccountTitle: settings?.bankAccountTitle || "",
                bankAccountNumber: settings?.bankAccountNumber || "",
                note: settings?.bankTransferNote || "",
            },
            feePaymentStatus: fresh.feePayment?.status || "NOT_SUBMITTED",
        });
    } catch {
        return res.status(400).json({
            success: false,
            message: "Unable to load payment instructions",
        });
    }
};

const submitRentalFeePayment = async (req, res) => {
    try {
        const { booking } = await loadBookingWithVehicle({
            _id: req.params.id,
            passengerId: req.user._id,
        });

        if (!booking) {
            return res.status(404).json({
                success: false,
                message: "Booking not found",
            });
        }

        const fresh = await expireHoldIfNeeded(booking);

        if (fresh.status === "CANCELLED") {
            return res.status(409).json({
                success: false,
                message: "This booking has expired or been cancelled",
            });
        }

        if (!["PROVIDER_ACCEPTED", "PAYMENT_PENDING"].includes(fresh.status)) {
            return res.status(409).json({
                success: false,
                message: "Fee payment is not due at this stage",
            });
        }

        if (fresh.feePayment?.status === "VERIFIED") {
            return res.status(409).json({
                success: false,
                message: "The booking fee is already verified",
            });
        }

        const reference = String(req.body?.reference || "").trim();
        const proofImageUrl = String(req.body?.proofImageUrl || "").trim();
        const senderAccountTitle = String(req.body?.senderAccountTitle || "").trim();

        if (
            !reference || reference.length > 120 ||
            !proofImageUrl || proofImageUrl.length > 1000 ||
            senderAccountTitle.length > 120
        ) {
            return res.status(400).json({
                success: false,
                message: "A payment reference and a proof image are required",
            });
        }

        const paymentSet = {
            "feePayment.status": "SUBMITTED",
            "feePayment.method": "BANK_TRANSFER",
            "feePayment.reference": reference,
            "feePayment.proofImageUrl": proofImageUrl,
            "feePayment.senderAccountTitle": senderAccountTitle,
            "feePayment.submittedAt": new Date(),
            "feePayment.rejectionReason": "",
        };

        let updated;

        if (fresh.status === "PROVIDER_ACCEPTED") {
            // Submitting the proof advances the booking into
            // PAYMENT_PENDING atomically with the payment record.
            updated = await transitionBooking({
                filter: { _id: fresh._id, passengerId: req.user._id },
                fromStatus: "PROVIDER_ACCEPTED",
                toStatus: "PAYMENT_PENDING",
                set: paymentSet,
                event: {
                    entry: makeEvent("FEE_PAYMENT_SUBMITTED", "PASSENGER", req.user._id, {
                        fromStatus: "PROVIDER_ACCEPTED",
                        toStatus: "PAYMENT_PENDING",
                        amount: fresh.bookingFee,
                        note: reference,
                    }),
                },
            });
        } else {
            // Resubmission after an admin rejection: the booking stays
            // PAYMENT_PENDING; only the payment record changes.
            updated = await RentalBooking.findOneAndUpdate(
                {
                    _id: fresh._id,
                    passengerId: req.user._id,
                    status: "PAYMENT_PENDING",
                    "feePayment.status": { $in: ["NOT_SUBMITTED", "REJECTED"] },
                },
                {
                    $set: paymentSet,
                    $push: {
                        events: makeEvent("FEE_PAYMENT_SUBMITTED", "PASSENGER", req.user._id, {
                            amount: fresh.bookingFee,
                            note: reference,
                        }),
                    },
                },
                { new: true, runValidators: true }
            );
        }

        if (!updated) {
            return res.status(409).json({
                success: false,
                message: "Payment submission failed. Please refresh.",
            });
        }

        notifyPartner(
            updated,
            "rental:payment:submitted",
            { status: updated.status, message: "The passenger submitted the booking-fee payment" },
            "Fee Payment Submitted",
            "The passenger submitted the booking-fee payment. It confirms once Safar verifies it.",
            "RENTAL_FEE_SUBMITTED"
        );

        return res.json({ success: true, booking: serializeBooking(updated, null) });
    } catch (error) {
        console.error("Submit rental fee payment error:", error.message);
        return res.status(500).json({
            success: false,
            message: "Unable to submit payment proof",
        });
    }
};

// ---------------------------------------------------------------------------
// Pickup OTP + handover / start / return / confirm
// ---------------------------------------------------------------------------

// Passenger-side pickup OTP reveal — parcel pattern: storage holds
// only the hash; the plaintext is returned to the passenger, who reads
// it to the partner at handover. Regenerating replaces the hash.
const getRentalPickupOtp = async (req, res) => {
    try {
        const otp = createRentalOtp();

        const booking = await RentalBooking.findOneAndUpdate(
            {
                _id: req.params.id,
                passengerId: req.user._id,
                status: "CONFIRMED",
            },
            {
                $set: {
                    pickupOtpHash: hashRentalOtp(otp),
                    pickupOtpAttempts: 0,
                },
            },
            { new: true }
        ).select("_id status bookingRef");

        if (!booking) {
            return res.status(409).json({
                success: false,
                message: "Pickup OTP is available once the booking is confirmed",
            });
        }

        return res.json({ success: true, bookingRef: booking.bookingRef, otp });
    } catch {
        return res.status(400).json({
            success: false,
            message: "Unable to generate pickup OTP",
        });
    }
};

// Parcel OTP verification pattern verbatim (see purchaseController):
// the attempt counter increments atomically and is capped at 5.
const verifyPickupOtpAtomically = async (booking, otp) => {
    const result = await RentalBooking.findOneAndUpdate(
        {
            _id: booking._id,
            rentalPartnerId: booking.rentalPartnerId,
            status: "CONFIRMED",
            pickupOtpAttempts: { $not: { $gte: 5 } },
            pickupOtpHash: { $type: "string" },
        },
        { $inc: { pickupOtpAttempts: 1 } },
        { new: true }
    ).select("+pickupOtpHash");

    if (!result) return false;

    return (
        typeof otp === "string" &&
        /^\d{6}$/.test(otp) &&
        result.pickupOtpHash === hashRentalOtp(otp)
    );
};

const validInspection = (body) => {
    if (!body || typeof body !== "object") return false;

    const fuel = body.fuelLevelPercent;
    const odo = body.odometerKm;
    const photos = body.photoUrls;

    if (
        typeof fuel !== "number" || !Number.isFinite(fuel) || fuel < 0 || fuel > 100
    ) {
        return false;
    }

    if (typeof odo !== "number" || !Number.isFinite(odo) || odo < 0) {
        return false;
    }

    if (
        !Array.isArray(photos) || photos.length === 0 || photos.length > 12 ||
        !photos.every((u) => typeof u === "string" && u.length > 0 && u.length <= 1000)
    ) {
        return false;
    }

    return true;
};

const inspectionValues = (body, userId) => ({
    recordedAt: new Date(),
    recordedBy: userId,
    fuelLevelPercent: body.fuelLevelPercent,
    odometerKm: body.odometerKm,
    photoUrls: body.photoUrls,
    notes: String(body.notes || "").slice(0, 500),
});

// Partner verifies the pickup OTP and records the handover evidence
// (photos, fuel, odometer) in one atomic step — no OTP, no handover.
const verifyRentalPickup = async (req, res) => {
    try {
        const { partner, booking } = await loadPartnerBooking(req);

        if (!partner || !booking) {
            return res.status(404).json({
                success: false,
                message: "Booking not found",
            });
        }

        if (booking.status !== "CONFIRMED") {
            return res.status(409).json({
                success: false,
                message: "This booking is not awaiting pickup",
            });
        }

        if (!validInspection(req.body?.handover)) {
            return res.status(400).json({
                success: false,
                message: "Handover requires a fuel level, an odometer reading and at least one photo",
            });
        }

        const otpVerified = await verifyPickupOtpAtomically(
            booking,
            req.body?.otp
        );

        if (!otpVerified) {
            return res.status(400).json({
                success: false,
                code: "INVALID_OTP",
                message: "Invalid or expired pickup OTP",
            });
        }

        const updated = await transitionBooking({
            filter: { _id: booking._id, rentalPartnerId: partner._id },
            fromStatus: "CONFIRMED",
            toStatus: "PICKUP_VERIFIED",
            set: {
                pickupOtpVerifiedAt: new Date(),
                pickedUpAt: new Date(),
                handover: inspectionValues(req.body.handover, req.user._id),
            },
            event: {
                entry: makeEvent("PICKUP_VERIFIED", "PARTNER", req.user._id, {
                    fromStatus: "CONFIRMED",
                    toStatus: "PICKUP_VERIFIED",
                }),
            },
            flags: { otpVerified: true },
        });

        if (!updated) {
            return res.status(409).json({
                success: false,
                message: "Booking status changed. Please refresh.",
            });
        }

        notifyPassenger(
            updated,
            { status: "PICKUP_VERIFIED", message: "Pickup verified" },
            "Pickup Verified",
            "Your rental pickup was verified. Have a safe trip.",
            "RENTAL_PICKUP_VERIFIED"
        );

        return res.json({ success: true, booking: serializeBooking(updated, null) });
    } catch (error) {
        console.error("Verify rental pickup error:", error.message);
        return res.status(500).json({
            success: false,
            message: "Unable to verify pickup",
        });
    }
};

const startRental = async (req, res) => {
    try {
        const { partner, booking } = await loadPartnerBooking(req);

        if (!partner || !booking) {
            return res.status(404).json({
                success: false,
                message: "Booking not found",
            });
        }

        const updated = await transitionBooking({
            filter: { _id: booking._id, rentalPartnerId: partner._id },
            fromStatus: "PICKUP_VERIFIED",
            toStatus: "RENTAL_ACTIVE",
            set: { rentalStartedAt: new Date() },
            event: {
                entry: makeEvent("RENTAL_STARTED", "PARTNER", req.user._id, {
                    fromStatus: "PICKUP_VERIFIED",
                    toStatus: "RENTAL_ACTIVE",
                }),
            },
        });

        if (!updated) {
            return res.status(409).json({
                success: false,
                message: "This rental cannot be started at this stage",
            });
        }

        notifyPassenger(
            updated,
            { status: "RENTAL_ACTIVE", message: "Your rental has started" },
            "Rental Started",
            "Your rental is now active.",
            "RENTAL_STARTED"
        );

        return res.json({ success: true, booking: serializeBooking(updated, null) });
    } catch {
        return res.status(400).json({
            success: false,
            message: "Unable to start rental",
        });
    }
};

// Partner records the return inspection; remaining dues are COMPUTED
// from the two odometer readings + the listing's own extra-km /
// overtime rates — never typed in as an opaque figure.
const submitRentalReturn = async (req, res) => {
    try {
        const { partner, booking, vehicle } = await loadPartnerBooking(req);

        if (!partner || !booking) {
            return res.status(404).json({
                success: false,
                message: "Booking not found",
            });
        }

        if (booking.status !== "RENTAL_ACTIVE") {
            return res.status(409).json({
                success: false,
                message: "This rental is not active",
            });
        }

        if (!validInspection(req.body?.inspection)) {
            return res.status(400).json({
                success: false,
                message: "Return inspection requires a fuel level, an odometer reading and at least one photo",
            });
        }

        const inspection = inspectionValues(req.body.inspection, req.user._id);
        const rentalDays = Math.max(
            1,
            Math.ceil((booking.endAt - booking.startAt) / (1000 * 60 * 60 * 24))
        );
        const overtimeHours = Math.max(
            0,
            (Date.now() - new Date(booking.endAt).getTime()) / (1000 * 60 * 60)
        );

        const dues = computeRemainingDues({
            startOdometerKm: booking.handover?.odometerKm,
            returnOdometerKm: inspection.odometerKm,
            rentalDays,
            mileageLimitKmPerDay: vehicle?.mileageLimitKmPerDay ?? null,
            extraKmFee: vehicle?.extraKmFee ?? 0,
            overtimeHours,
            overtimeFeePerHour: vehicle?.overtimeFeePerHour ?? 0,
            otherDues: Number.isSafeInteger(req.body?.otherDues) && req.body.otherDues >= 0
                ? req.body.otherDues
                : 0,
        });

        const updated = await transitionBooking({
            filter: { _id: booking._id, rentalPartnerId: partner._id },
            fromStatus: "RENTAL_ACTIVE",
            toStatus: "RETURN_PENDING",
            set: {
                returnStartedAt: new Date(),
                returnInspection: inspection,
                returnDues: {
                    drivenKm: dues.drivenKm,
                    extraKm: dues.extraKm,
                    extraKmCharges: dues.extraKmCharges,
                    overtimeHours: dues.overtimeHours,
                    overtimeCharges: dues.overtimeCharges,
                    otherDues: dues.otherDues,
                    remainingDues: dues.remainingDues,
                    settledAt: null,
                },
            },
            event: {
                entry: makeEvent("RETURN_RECORDED", "PARTNER", req.user._id, {
                    fromStatus: "RENTAL_ACTIVE",
                    toStatus: "RETURN_PENDING",
                    amount: dues.remainingDues,
                }),
            },
        });

        if (!updated) {
            return res.status(409).json({
                success: false,
                message: "Booking status changed. Please refresh.",
            });
        }

        notifyPassenger(
            updated,
            {
                status: "RETURN_PENDING",
                remainingDues: dues.remainingDues,
                message: "The vehicle return was recorded",
            },
            "Return Recorded",
            dues.remainingDues > 0
                ? `The return inspection is done. Remaining dues: PKR ${dues.remainingDues}.`
                : "The return inspection is done. No remaining dues.",
            "RENTAL_RETURN_RECORDED"
        );

        return res.json({ success: true, booking: serializeBooking(updated, vehicle) });
    } catch (error) {
        console.error("Submit rental return error:", error.message);
        return res.status(500).json({
            success: false,
            message: "Unable to record the return",
        });
    }
};

// Passenger confirms the return + dues settlement → COMPLETED. If the
// dues are wrong, the passenger disputes instead (see below).
const confirmRentalReturn = async (req, res) => {
    try {
        const { booking } = await loadBookingWithVehicle({
            _id: req.params.id,
            passengerId: req.user._id,
        });

        if (!booking) {
            return res.status(404).json({
                success: false,
                message: "Booking not found",
            });
        }

        const updated = await transitionBooking({
            filter: { _id: booking._id, passengerId: req.user._id },
            fromStatus: "RETURN_PENDING",
            toStatus: "COMPLETED",
            set: {
                completedAt: new Date(),
                "returnDues.settledAt": new Date(),
            },
            event: {
                entry: makeEvent("RETURN_CONFIRMED", "PASSENGER", req.user._id, {
                    fromStatus: "RETURN_PENDING",
                    toStatus: "COMPLETED",
                    amount: booking.returnDues?.remainingDues ?? null,
                }),
            },
        });

        if (!updated) {
            return res.status(409).json({
                success: false,
                message: "This booking is not awaiting return confirmation",
            });
        }

        notifyPartner(
            updated,
            "rental:booking:updated",
            { status: "COMPLETED", message: "The passenger confirmed the return" },
            "Rental Completed",
            "The passenger confirmed the return. This rental is complete.",
            "RENTAL_COMPLETED"
        );

        return res.json({ success: true, booking: serializeBooking(updated, null) });
    } catch {
        return res.status(400).json({
            success: false,
            message: "Unable to confirm the return",
        });
    }
};

// ---------------------------------------------------------------------------
// Cancel / no-show / dispute / rate — either party where sensible; the
// actor is always resolved server-side.
// ---------------------------------------------------------------------------

const resolveActor = async (req, booking) => {
    if (String(booking.passengerId) === String(req.user._id)) {
        return "PASSENGER";
    }

    const partner = await loadMyPartner(req.user._id);

    if (partner && String(booking.rentalPartnerId) === String(partner._id)) {
        return "PARTNER";
    }

    return null;
};

const cancelRentalBooking = async (req, res) => {
    try {
        const raw = await RentalBooking.findById(req.params.id);

        if (!raw) {
            return res.status(404).json({
                success: false,
                message: "Booking not found",
            });
        }

        const actor = await resolveActor(req, raw);

        if (!actor) {
            return res.status(403).json({
                success: false,
                message: "You are not a party to this booking",
            });
        }

        const booking = await expireHoldIfNeeded(raw);

        if (booking.status === "CANCELLED" && booking.cancelReason?.includes("not paid before the deadline")) {
            return res.json({ success: true, booking: serializeBooking(booking, null), expired: true });
        }

        const outcome = resolveCancelOutcome(booking.status);

        if (!outcome) {
            return res.status(409).json({
                success: false,
                message: "This booking cannot be cancelled at this stage — raise a dispute instead",
            });
        }

        const reason = String(req.body?.reason || "").slice(0, 500);
        const providerFailure = req.body?.providerFailure === true && actor === "PASSENGER";
        const hoursBeforePickup = Math.max(
            0,
            (new Date(booking.startAt).getTime() - Date.now()) / (1000 * 60 * 60)
        );

        const vehicle = await RentalVehicle.findById(booking.vehicleId)
            .select("cancellationPolicy")
            .lean();

        const refund = resolveFeeRefund({
            policy: vehicle?.cancellationPolicy || "MODERATE",
            cancelledBy: actor,
            hoursBeforePickup,
            providerFailure,
            bookingFee: booking.bookingFee,
            feeVerified: booking.feePayment?.status === "VERIFIED",
        });

        const updated = await transitionBooking({
            filter: { _id: booking._id },
            fromStatus: booking.status,
            toStatus: "CANCELLED",
            set: {
                cancelledBy: actor,
                cancelReason: reason,
                cancelledAt: new Date(),
                feeRefund: {
                    status: refund.status,
                    percent: refund.percent,
                    amount: refund.amount,
                    refundedAt: null,
                    refundedBy: null,
                },
            },
            event: {
                entry: makeEvent("BOOKING_CANCELLED", actor, req.user._id, {
                    fromStatus: booking.status,
                    toStatus: "CANCELLED",
                    amount: refund.amount,
                    note: reason,
                }),
            },
        });

        if (!updated) {
            return res.status(409).json({
                success: false,
                message: "Booking status changed. Please refresh.",
            });
        }

        if (actor === "PASSENGER") {
            notifyPartner(
                updated,
                "rental:booking:updated",
                { status: "CANCELLED", message: "The passenger cancelled the booking" },
                "Booking Cancelled",
                "The passenger cancelled this rental booking.",
                "RENTAL_CANCELLED"
            );
        } else {
            notifyPassenger(
                updated,
                { status: "CANCELLED", message: "The rental partner cancelled the booking" },
                "Booking Cancelled",
                refund.amount > 0
                    ? `The rental partner cancelled. Your booking fee of PKR ${refund.amount} will be refunded.`
                    : "The rental partner cancelled this booking.",
                "RENTAL_CANCELLED"
            );
        }

        return res.json({ success: true, booking: serializeBooking(updated, null) });
    } catch (error) {
        console.error("Cancel rental booking error:", error.message);
        return res.status(500).json({
            success: false,
            message: "Unable to cancel booking",
        });
    }
};

const markRentalNoShow = async (req, res) => {
    try {
        const raw = await RentalBooking.findById(req.params.id);

        if (!raw) {
            return res.status(404).json({
                success: false,
                message: "Booking not found",
            });
        }

        const actor = await resolveActor(req, raw);

        if (!actor) {
            return res.status(403).json({
                success: false,
                message: "You are not a party to this booking",
            });
        }

        if (raw.status !== "CONFIRMED" || new Date(raw.startAt) > new Date()) {
            return res.status(409).json({
                success: false,
                message: "A no-show can only be marked on a confirmed booking after its start time",
            });
        }

        const updated = await transitionBooking({
            filter: { _id: raw._id },
            fromStatus: "CONFIRMED",
            toStatus: "NO_SHOW",
            set: { noShowAt: new Date(), noShowBy: actor },
            event: {
                entry: makeEvent("NO_SHOW_MARKED", actor, req.user._id, {
                    fromStatus: "CONFIRMED",
                    toStatus: "NO_SHOW",
                }),
            },
        });

        if (!updated) {
            return res.status(409).json({
                success: false,
                message: "Booking status changed. Please refresh.",
            });
        }

        if (actor === "PARTNER") {
            notifyPassenger(
                updated,
                { status: "NO_SHOW", message: "You were marked as a no-show" },
                "Marked As No-Show",
                "The rental partner marked you as a no-show for this booking.",
                "RENTAL_NO_SHOW"
            );
        } else {
            notifyPartner(
                updated,
                "rental:booking:updated",
                { status: "NO_SHOW", message: "The passenger reported a provider no-show" },
                "Provider No-Show Reported",
                "The passenger reported that the vehicle was not provided.",
                "RENTAL_NO_SHOW"
            );
        }

        return res.json({ success: true, booking: serializeBooking(updated, null) });
    } catch {
        return res.status(400).json({
            success: false,
            message: "Unable to mark no-show",
        });
    }
};

const raiseRentalDispute = async (req, res) => {
    try {
        const reason = String(req.body?.reason || "").trim();

        if (!reason || reason.length > 500) {
            return res.status(400).json({
                success: false,
                message: "A dispute reason is required",
            });
        }

        const booking = await RentalBooking.findById(req.params.id);

        if (!booking) {
            return res.status(404).json({
                success: false,
                message: "Booking not found",
            });
        }

        const actor = await resolveActor(req, booking);

        if (!actor) {
            return res.status(403).json({
                success: false,
                message: "You are not a party to this booking",
            });
        }

        if (!canDispute(booking.status)) {
            return res.status(409).json({
                success: false,
                message: "A dispute cannot be raised at this stage",
            });
        }

        const fromStatus = booking.status;

        const updated = await transitionBooking({
            filter: { _id: booking._id },
            fromStatus,
            toStatus: "DISPUTED",
            set: {
                disputedBy: actor,
                disputeReason: reason,
                disputedAt: new Date(),
            },
            event: {
                entry: makeEvent("DISPUTE_RAISED", actor, req.user._id, {
                    fromStatus,
                    toStatus: "DISPUTED",
                    note: reason,
                }),
            },
        });

        if (!updated) {
            return res.status(409).json({
                success: false,
                message: "Booking status changed. Please refresh.",
            });
        }

        if (actor === "PASSENGER") {
            notifyPartner(
                updated,
                "rental:disputed",
                { status: "DISPUTED", message: "The passenger raised a dispute" },
                "Dispute Raised",
                "The passenger raised a dispute on this rental booking.",
                "RENTAL_DISPUTED"
            );
        } else {
            notifyPassenger(
                updated,
                { status: "DISPUTED", message: "The rental partner raised a dispute" },
                "Dispute Raised",
                "The rental partner raised a dispute on this booking.",
                "RENTAL_DISPUTED"
            );
        }

        return res.json({ success: true, booking: serializeBooking(updated, null) });
    } catch {
        return res.status(400).json({
            success: false,
            message: "Unable to raise dispute",
        });
    }
};

const rateRentalPartner = async (req, res) => {
    try {
        const { rating, comment = "" } = req.body || {};

        if (
            !Number.isInteger(rating) ||
            rating < 1 ||
            rating > 5 ||
            typeof comment !== "string" ||
            comment.length > 1000
        ) {
            return res.status(400).json({
                success: false,
                message: "Invalid rating",
            });
        }

        const booking = await RentalBooking.findOne({
            _id: req.params.id,
            passengerId: req.user._id,
            status: "COMPLETED",
            ratedAt: null,
        });

        if (!booking) {
            return res.status(409).json({
                success: false,
                message: "This booking cannot be rated",
            });
        }

        await RentalReview.create({
            rentalBookingId: booking._id,
            passengerId: req.user._id,
            rentalPartnerId: booking.rentalPartnerId,
            vehicleId: booking.vehicleId,
            rating,
            comment: comment.trim(),
        });

        await RentalBooking.updateOne(
            { _id: booking._id },
            {
                $set: { ratedAt: new Date() },
                $push: {
                    events: makeEvent("PARTNER_RATED", "PASSENGER", req.user._id, {
                        amount: rating,
                    }),
                },
            }
        );

        // Maintain the partner + vehicle aggregates from the review
        // collection (same pattern as purchase ratings → Driver).
        const [partnerStats, vehicleStats] = await Promise.all([
            RentalReview.aggregate([
                { $match: { rentalPartnerId: booking.rentalPartnerId, isHidden: false } },
                { $group: { _id: "$rentalPartnerId", total: { $sum: "$rating" }, count: { $sum: 1 } } },
            ]),
            RentalReview.aggregate([
                { $match: { vehicleId: booking.vehicleId, isHidden: false } },
                { $group: { _id: "$vehicleId", total: { $sum: "$rating" }, count: { $sum: 1 } } },
            ]),
        ]);

        await Promise.all([
            RentalPartner.updateOne(
                { _id: booking.rentalPartnerId },
                {
                    $set: {
                        rating: partnerStats[0]?.count
                            ? partnerStats[0].total / partnerStats[0].count
                            : 0,
                        ratingCount: partnerStats[0]?.count || 0,
                    },
                }
            ),
            RentalVehicle.updateOne(
                { _id: booking.vehicleId },
                {
                    $set: {
                        rating: vehicleStats[0]?.count
                            ? vehicleStats[0].total / vehicleStats[0].count
                            : 0,
                        ratingCount: vehicleStats[0]?.count || 0,
                    },
                }
            ),
        ]);

        return res.status(201).json({
            success: true,
            message: "Review submitted successfully",
        });
    } catch (error) {
        if (error.code === 11000) {
            return res.status(409).json({
                success: false,
                message: "This booking has already been rated",
            });
        }

        return res.status(500).json({
            success: false,
            message: "Unable to submit review",
        });
    }
};

module.exports = {
    // Shared with adminRentalController
    makeEvent,
    transitionBooking,
    expireHoldIfNeeded,
    serializeBooking,
    loadBookingWithVehicle,
    notifyPassenger,
    notifyPartner,
    // Passenger
    searchRentalVehicles,
    getRentalVehicleDetails,
    createRentalBooking,
    getMyRentalBookings,
    getRentalBookingDetails,
    getRentalFeeInstructions,
    submitRentalFeePayment,
    getRentalPickupOtp,
    confirmRentalReturn,
    // Partner
    getPartnerRentalBookings,
    getPartnerRentalBookingDetails,
    acceptRentalBooking,
    rejectRentalBooking,
    verifyRentalPickup,
    startRental,
    submitRentalReturn,
    // Either party
    cancelRentalBooking,
    markRentalNoShow,
    raiseRentalDispute,
    rateRentalPartner,
};
