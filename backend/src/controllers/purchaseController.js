const crypto = require("node:crypto");

const PurchaseOrder = require("../models/PurchaseOrder");
const PurchaseOffer = require("../models/PurchaseOffer");
const PurchaseReview = require("../models/PurchaseReview");
const DriverReview = require("../models/DriverReview");
const Driver = require("../models/Driver");
const Vehicle = require("../models/Vehicle");
const User = require("../models/User");
const SavedPlace = require("../models/SavedPlace");
const CommissionSettings = require("../models/CommissionSettings");
const DriverWallet = require("../models/DriverWallet");
const { publishEvent } = require("../services/socketService");
const { sendPushToUser } = require("../services/pushService");
const { paymentsConfigured } = require("../services/paymentsConfigService");
const { isLocationSupported } = require("../services/serviceAreaService");
const eligibilityService = require("../services/eligibilityService");
const {
    canTransition,
    resolveCancelOutcome,
    canDispute,
    isValidAmount,
    checkAmountWithinCaps,
    checkPurchaseWithinApproval,
    computeTotals,
    applyPayment,
    evaluateOfferAcceptance,
    findBlockedTerm,
    DEFAULT_BLOCKED_TERMS,
} = require("../services/purchaseOrderService");

// ---------------------------------------------------------------------------
// Phase 4 — Buy & Deliver (PurchaseOrder) REST controller.
//
// Patterns are copied from controllers/parcelController.js (offers,
// atomic status-guarded updates, SHA-256 OTP with a 5-attempt atomic
// cap, Auto Free Mode wallet gate, socket + FCM fan-out). The domain
// rules themselves live in services/purchaseOrderService.js.
//
// Authorization model: EVERY handler re-checks ownership server-side —
// passenger handlers filter on passengerId = req.user._id, partner
// handlers resolve the caller's Driver profile and filter on
// driverId = driver._id. Status moves only happen through atomic
// findOneAndUpdate calls guarded by the expected current status.
// ---------------------------------------------------------------------------

const OFFER_TTL_MS = 5 * 60 * 1000;

const hashPurchaseOtp = (otp) =>
    crypto.createHash("sha256").update(String(otp)).digest("hex");

const createPurchaseOtp = () => String(crypto.randomInt(100000, 1000000));

// Parcel OTP pattern verbatim, single-stage (delivery only — a purchase
// order has no fixed pickup point to verify at).
const verifyDeliveryOtp = async (order, otp) => {
    const result = await PurchaseOrder.findOneAndUpdate(
        {
            _id: order._id,
            driverId: order.driverId,
            status: "ARRIVED",
            deliveryOtpAttempts: { $not: { $gte: 5 } },
            deliveryOtpHash: { $type: "string" },
        },
        { $inc: { deliveryOtpAttempts: 1 } },
        { new: true }
    ).select("+deliveryOtpHash");

    if (!result) return false;

    return (
        typeof otp === "string" &&
        /^\d{6}$/.test(otp) &&
        result.deliveryOtpHash === hashPurchaseOtp(otp)
    );
};

const validPoint = (p) =>
    p &&
    Number.isFinite(p.latitude) &&
    Number.isFinite(p.longitude) &&
    Math.abs(p.latitude) <= 90 &&
    Math.abs(p.longitude) <= 180;

const validImageUrls = (urls, max = 6) =>
    Array.isArray(urls) &&
    urls.length <= max &&
    urls.every(
        (url) =>
            typeof url === "string" &&
            url.trim().length > 0 &&
            url.length <= 1000
    );

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

const getGlobalSettings = () =>
    CommissionSettings.findOne({ key: "GLOBAL" }).lean();

const blockedTermsFor = (settings) =>
    Array.isArray(settings?.buyDeliverBlockedTerms) &&
    settings.buyDeliverBlockedTerms.length
        ? settings.buyDeliverBlockedTerms
        : DEFAULT_BLOCKED_TERMS;

const radiusKmFor = (settings) =>
    Number.isFinite(settings?.buyDeliverRadiusKm) &&
    settings.buyDeliverRadiusKm >= 1
        ? settings.buyDeliverRadiusKm
        : 15;

// Socket + FCM together, following the codebase's notification split:
// Socket.IO updates the open app instantly; the FCM push is what
// reaches a backgrounded / closed app (pushService + the ride_alerts_v2
// channel handle delivery; sendPushToUser no-ops gracefully with no
// registered device).
const notifyUser = (userId, { event, room, payload, title, body, data }) => {
    if (room && event) {
        publishEvent(event, room, payload);
    }

    if (userId && title) {
        void sendPushToUser(userId, title, body, data || {});
    }
};

const notifyPassenger = (order, socketEvent, payload, title, body, type) => {
    notifyUser(order.passengerId, {
        event: socketEvent,
        room: `passenger:${order.passengerId}`,
        payload: { orderId: String(order._id), ...payload },
        title,
        body,
        data: { type, orderId: String(order._id) },
    });
};

const notifyAssignedPartner = async (order, socketEvent, payload, title, body, type) => {
    if (!order.driverId) return;

    const driver = await Driver.findById(order.driverId)
        .select("userId")
        .lean();

    if (!driver?.userId) return;

    notifyUser(driver.userId, {
        event: socketEvent,
        room: `driver:${driver.userId}`,
        payload: { orderId: String(order._id), ...payload },
        title,
        body,
        data: { type, orderId: String(order._id) },
    });
};

const loadDriverForUser = async (userId) =>
    Driver.findOne({ userId }).select("_id userId");

// Atomic, status-guarded transition + audit event. Returns the updated
// order, or null when the order is no longer in `fromStatus` (a racing
// request already moved it) — callers map null to 409.
const transitionOrder = async ({ filter, fromStatus, toStatus, set = {}, event }) => {
    if (!canTransition(fromStatus, toStatus, event?.flags || {})) {
        return null;
    }

    return PurchaseOrder.findOneAndUpdate(
        { ...filter, status: fromStatus },
        {
            $set: { ...set, status: toStatus },
            ...(event ? { $push: { events: event.entry } } : {}),
        },
        { new: true, runValidators: true }
    );
};

// ---------------------------------------------------------------------------
// Passenger: create + read
// ---------------------------------------------------------------------------

const createPurchaseOrder = async (req, res) => {
    try {
        const body = req.body || {};
        const {
            itemsText,
            imageUrls = [],
            preferences = {},
            deliveryNotes = "",
            estimatedBudget,
        } = body;

        if (
            typeof itemsText !== "string" ||
            !itemsText.trim() ||
            itemsText.length > 2000 ||
            !validImageUrls(imageUrls) ||
            !isValidAmount(Number(estimatedBudget)) ||
            typeof deliveryNotes !== "string" ||
            deliveryNotes.length > 500
        ) {
            return res.status(400).json({
                success: false,
                message: "Invalid purchase request details",
            });
        }

        const settings = await getGlobalSettings();

        if (settings?.buyDeliverEnabled === false) {
            return res.status(403).json({
                success: false,
                message: "Buy & Deliver is currently disabled",
            });
        }

        // Prohibited / restricted goods — checked at creation against
        // the admin-configurable list (defaults in purchaseOrderService).
        const blockedTerm = findBlockedTerm(
            [
                itemsText,
                deliveryNotes,
                preferences?.alternativesNote || "",
            ].join("\n"),
            blockedTermsFor(settings)
        );

        if (blockedTerm) {
            return res.status(400).json({
                success: false,
                code: "RESTRICTED_ITEM",
                message: `"${blockedTerm}" is a restricted item and cannot be ordered through Buy & Deliver`,
            });
        }

        const budgetCheck = checkAmountWithinCaps(Number(estimatedBudget), {
            globalCap: settings?.buyDeliverMaxOrderValue ?? null,
        });

        if (!budgetCheck.ok) {
            return res.status(400).json({
                success: false,
                code: budgetCheck.code,
                message: budgetCheck.message,
            });
        }

        // Delivery address: explicit in the request, else the saved
        // HOME place (the flow pre-fills it — spec Part 4.1). No store
        // or pickup point is asked for, ever.
        let delivery = body.delivery || null;
        let deliveryLabel = body.deliveryLabel || "";

        if (!validPoint(delivery)) {
            const home = await SavedPlace.findOne({
                userId: req.user._id,
                type: "HOME",
            }).lean();

            if (!home) {
                return res.status(400).json({
                    success: false,
                    message: "A delivery address is required",
                });
            }

            delivery = {
                latitude: home.latitude,
                longitude: home.longitude,
                address: home.address || home.name || "",
            };
            deliveryLabel = deliveryLabel || home.name || "Home";
        }

        const area = await isLocationSupported(
            delivery.latitude,
            delivery.longitude
        );

        if (!area.supported) {
            return res.status(400).json({
                success: false,
                message: "Delivery location is outside the service area",
            });
        }

        const order = await PurchaseOrder.create({
            passengerId: req.user._id,
            status: "REQUESTED",
            itemsText: itemsText.trim(),
            imageUrls,
            preferences: {
                preferredShop: String(preferences?.preferredShop || "").slice(0, 120),
                preferredBrand: String(preferences?.preferredBrand || "").slice(0, 120),
                alternativesAllowed: preferences?.alternativesAllowed === true,
                alternativesNote: String(preferences?.alternativesNote || "").slice(0, 300),
            },
            deliveryNotes,
            deliveryAddress: {
                type: "Point",
                coordinates: [delivery.longitude, delivery.latitude],
                address: delivery.address || "",
            },
            deliveryLabel: String(deliveryLabel || "").slice(0, 60),
            estimatedBudget: Number(estimatedBudget),
            events: [
                makeEvent("ORDER_CREATED", "PASSENGER", req.user._id, {
                    toStatus: "REQUESTED",
                    amount: Number(estimatedBudget),
                }),
            ],
        });

        // REQUESTED -> BIDDING: the request is now open for offers and
        // is fanned out to eligible partners near the DELIVERY location.
        const opened = await transitionOrder({
            filter: { _id: order._id },
            fromStatus: "REQUESTED",
            toStatus: "BIDDING",
            event: {
                entry: makeEvent("REQUEST_OPENED", "SYSTEM", null, {
                    fromStatus: "REQUESTED",
                    toStatus: "BIDDING",
                }),
            },
        });

        const liveOrder = opened || order;

        void (async () => {
            try {
                const radiusKm = radiusKmFor(settings);

                const drivers = await Driver.find({
                    isOnline: true,
                    isAvailable: true,
                    currentLocation: {
                        $near: {
                            $geometry: {
                                type: "Point",
                                coordinates: [
                                    delivery.longitude,
                                    delivery.latitude,
                                ],
                            },
                            $maxDistance: radiusKm * 1000,
                        },
                    },
                })
                    .select("userId currentVehicleId services")
                    .limit(100)
                    .lean();

                for (const driver of drivers) {
                    const context =
                        await eligibilityService.loadEligibilityContext(driver);

                    const eligible =
                        await eligibilityService.canReceiveBuyDeliverRequests(
                            driver,
                            context
                        );

                    if (!eligible) continue;

                    const record = eligibilityService.getServiceRecord(
                        driver,
                        "BUY_DELIVER"
                    );

                    const capCheck = checkAmountWithinCaps(
                        liveOrder.estimatedBudget,
                        {
                            partnerLimit: record.purchaseLimit,
                            globalCap: settings?.buyDeliverMaxOrderValue ?? null,
                        }
                    );

                    if (!capCheck.ok) continue;

                    notifyUser(driver.userId, {
                        event: "purchase:request:new",
                        room: `driver:${driver.userId}`,
                        payload: {
                            orderId: String(liveOrder._id),
                            estimatedBudget: liveOrder.estimatedBudget,
                            message: "New Buy & Deliver request nearby",
                        },
                        title: "New Buy & Deliver Request",
                        body: "A shopping request is available near your delivery area.",
                        data: {
                            type: "PURCHASE_REQUEST",
                            orderId: String(liveOrder._id),
                        },
                    });
                }
            } catch (error) {
                console.error("Purchase fan-out error:", error.message);
            }
        })();

        return res.status(201).json({ success: true, order: liveOrder });
    } catch (error) {
        console.error("Create purchase order error:", error.message);
        return res.status(500).json({
            success: false,
            message: "Unable to create purchase request",
        });
    }
};

const getMyPurchaseOrders = async (req, res) => {
    try {
        const orders = await PurchaseOrder.find({
            passengerId: req.user._id,
        })
            .sort({ createdAt: -1 })
            .limit(50)
            .lean();

        return res.json({ success: true, orders });
    } catch {
        return res.status(500).json({
            success: false,
            message: "Unable to load purchase orders",
        });
    }
};

const getPurchaseOrderDetails = async (req, res) => {
    try {
        const order = await PurchaseOrder.findOne({
            _id: req.params.id,
            passengerId: req.user._id,
        }).lean();

        if (!order) {
            return res.status(404).json({
                success: false,
                message: "Purchase order not found",
            });
        }

        return res.json({ success: true, order });
    } catch {
        return res.status(400).json({
            success: false,
            message: "Invalid purchase order ID",
        });
    }
};

// ---------------------------------------------------------------------------
// Passenger: offers
// ---------------------------------------------------------------------------

const getPurchaseOffers = async (req, res) => {
    try {
        const order = await PurchaseOrder.findOne({
            _id: req.params.id,
            passengerId: req.user._id,
        })
            .select("_id status")
            .lean();

        if (!order) {
            return res.status(404).json({
                success: false,
                message: "Purchase order not found",
            });
        }

        const offers = await PurchaseOffer.find({
            orderId: order._id,
            status: "PENDING",
            expiresAt: { $gt: new Date() },
        })
            .select("driverId deliveryFee status expiresAt createdAt")
            .sort({ deliveryFee: 1 })
            .lean();

        // Same driver-summary enrichment as the parcel offers list, so
        // the passenger sees WHO is offering (name, rating, vehicle).
        const driverIds = [...new Set(offers.map((o) => String(o.driverId)))];
        const drivers = driverIds.length
            ? await Driver.find({ _id: { $in: driverIds } })
                .select("rating ratingCount currentVehicleId userId")
                .lean()
            : [];
        const driverById = new Map(drivers.map((d) => [String(d._id), d]));

        const userIds = drivers.map((d) => d.userId).filter(Boolean);
        const users = userIds.length
            ? await User.find({ _id: { $in: userIds } })
                .select("firstName lastName")
                .lean()
            : [];
        const userById = new Map(users.map((u) => [String(u._id), u]));

        const vehicleIds = drivers.map((d) => d.currentVehicleId).filter(Boolean);
        const vehicles = vehicleIds.length
            ? await Vehicle.find({ _id: { $in: vehicleIds } })
                .select("make model color vehicleType")
                .lean()
            : [];
        const vehicleById = new Map(vehicles.map((v) => [String(v._id), v]));

        const enrichedOffers = offers.map((offer) => {
            const driver = driverById.get(String(offer.driverId));
            if (!driver) return offer;

            const user = driver.userId ? userById.get(String(driver.userId)) : null;
            const vehicle = driver.currentVehicleId
                ? vehicleById.get(String(driver.currentVehicleId))
                : null;

            return {
                ...offer,
                driver: {
                    name: user
                        ? [user.firstName, user.lastName].filter(Boolean).join(" ") || null
                        : null,
                    rating: driver.ratingCount > 0 ? driver.rating : null,
                    ratingCount: driver.ratingCount ?? 0,
                    vehicle: vehicle
                        ? {
                            make: vehicle.make || null,
                            model: vehicle.model || null,
                            color: vehicle.color || null,
                            type: vehicle.vehicleType || null,
                            vehicleType: vehicle.vehicleType || null,
                        }
                        : null,
                },
            };
        });

        return res.json({ success: true, offers: enrichedOffers });
    } catch {
        return res.status(400).json({
            success: false,
            message: "Unable to load offers",
        });
    }
};

const acceptPurchaseOffer = async (req, res) => {
    try {
        const order = await PurchaseOrder.findOne({
            _id: req.params.id,
            passengerId: req.user._id,
        });

        if (!order) {
            return res.status(404).json({
                success: false,
                message: "Purchase order not found",
            });
        }

        const offer = await PurchaseOffer.findOne({
            _id: req.params.offerId,
            orderId: order._id,
        });

        const guard = evaluateOfferAcceptance({ order, offer });

        if (!guard.ok) {
            return res.status(409).json({
                success: false,
                message: guard.message,
            });
        }

        // Competing offers, captured before they are rejected so the
        // losing partners can be told their offer was not selected.
        const competing = await PurchaseOffer.find({
            orderId: order._id,
            _id: { $ne: offer._id },
            status: "PENDING",
        })
            .select("driverId")
            .lean();

        const deliveryOtp = createPurchaseOtp();

        // The assignment itself is atomic and status-guarded: exactly
        // one acceptance can ever win, however many requests race.
        const updated = await transitionOrder({
            filter: {
                _id: order._id,
                passengerId: req.user._id,
                driverId: null,
            },
            fromStatus: "BIDDING",
            toStatus: "DRIVER_SELECTED",
            set: {
                driverId: offer.driverId,
                acceptedOfferId: offer._id,
                deliveryFee: offer.deliveryFee,
                assignedAt: new Date(),
                deliveryOtpHash: hashPurchaseOtp(deliveryOtp),
                deliveryOtpAttempts: 0,
            },
            event: {
                entry: makeEvent("OFFER_ACCEPTED", "PASSENGER", req.user._id, {
                    fromStatus: "BIDDING",
                    toStatus: "DRIVER_SELECTED",
                    amount: offer.deliveryFee,
                }),
            },
        });

        if (!updated) {
            return res.status(409).json({
                success: false,
                message: "This request already has a selected partner",
            });
        }

        await PurchaseOffer.updateOne(
            { _id: offer._id },
            { $set: { status: "ACCEPTED" } }
        );

        if (competing.length) {
            await PurchaseOffer.updateMany(
                { _id: { $in: competing.map((o) => o._id) } },
                { $set: { status: "REJECTED" } }
            );

            const loserDrivers = await Driver.find({
                _id: { $in: competing.map((o) => o.driverId) },
            })
                .select("userId")
                .lean();

            for (const loser of loserDrivers) {
                if (!loser.userId) continue;

                notifyUser(loser.userId, {
                    event: "purchase:offer:rejected",
                    room: `driver:${loser.userId}`,
                    payload: {
                        orderId: String(order._id),
                        message: "The passenger selected another partner",
                    },
                    title: "Offer Not Selected",
                    body: "The passenger selected another partner for this request.",
                    data: {
                        type: "PURCHASE_OFFER_REJECTED",
                        orderId: String(order._id),
                    },
                });
            }
        }

        await notifyAssignedPartner(
            updated,
            "purchase:offer:accepted",
            { status: "DRIVER_SELECTED", message: "Your offer was accepted" },
            "Offer Accepted",
            "A passenger selected you for a Buy & Deliver request.",
            "PURCHASE_OFFER_ACCEPTED"
        );

        notifyPassenger(
            updated,
            "purchase:status:updated",
            { status: "DRIVER_SELECTED", message: "Partner selected" },
            "Partner Selected",
            "Your shopping partner has been selected.",
            "PURCHASE_DRIVER_SELECTED"
        );

        return res.json({ success: true, order: updated });
    } catch {
        return res.status(400).json({
            success: false,
            message: "Unable to accept offer",
        });
    }
};

// ---------------------------------------------------------------------------
// Passenger: purchase-amount approval (the financial heart of the flow)
// ---------------------------------------------------------------------------

const approvePurchaseAmount = async (req, res) => {
    try {
        const amount = Number(req.body?.amount);

        const order = await PurchaseOrder.findOne({
            _id: req.params.id,
            passengerId: req.user._id,
            status: "AWAITING_APPROVAL",
        });

        if (!order) {
            return res.status(409).json({
                success: false,
                message: "No purchase amount is awaiting your approval",
            });
        }

        const settings = await getGlobalSettings();
        const assignedDriver = order.driverId
            ? await Driver.findById(order.driverId).select("services").lean()
            : null;
        const partnerLimit = assignedDriver
            ? eligibilityService.getServiceRecord(assignedDriver, "BUY_DELIVER")
                .purchaseLimit
            : null;

        const capCheck = checkAmountWithinCaps(amount, {
            partnerLimit,
            globalCap: settings?.buyDeliverMaxOrderValue ?? null,
        });

        if (!capCheck.ok) {
            return res.status(400).json({
                success: false,
                code: capCheck.code,
                message: capCheck.message,
            });
        }

        const updated = await transitionOrder({
            filter: { _id: order._id, passengerId: req.user._id },
            fromStatus: "AWAITING_APPROVAL",
            toStatus: "PURCHASE_APPROVED",
            set: {
                approvedMaxAmount: amount,
                // Approving the amount IS the COD acknowledgment: the
                // passenger accepts they will pay actuals (up to this
                // cap) + the delivery fee in cash at the door.
                codAcknowledgedAt: new Date(),
            },
            event: {
                entry: makeEvent("AMOUNT_APPROVED", "PASSENGER", req.user._id, {
                    fromStatus: "AWAITING_APPROVAL",
                    toStatus: "PURCHASE_APPROVED",
                    amount,
                }),
            },
        });

        if (!updated) {
            return res.status(409).json({
                success: false,
                message: "Order status changed. Please refresh.",
            });
        }

        await notifyAssignedPartner(
            updated,
            "purchase:approval:decision",
            {
                status: "PURCHASE_APPROVED",
                approved: true,
                approvedMaxAmount: amount,
                message: "Purchase amount approved",
            },
            "Purchase Approved",
            `The passenger approved shopping up to PKR ${amount}.`,
            "PURCHASE_APPROVAL_APPROVED"
        );

        return res.json({ success: true, order: updated });
    } catch {
        return res.status(400).json({
            success: false,
            message: "Unable to approve purchase amount",
        });
    }
};

const rejectPurchaseEstimate = async (req, res) => {
    try {
        const order = await PurchaseOrder.findOne({
            _id: req.params.id,
            passengerId: req.user._id,
            status: "AWAITING_APPROVAL",
        });

        if (!order) {
            return res.status(409).json({
                success: false,
                message: "No purchase estimate is awaiting your decision",
            });
        }

        const note = String(req.body?.note || "").slice(0, 500);

        const updated = await transitionOrder({
            filter: { _id: order._id, passengerId: req.user._id },
            fromStatus: "AWAITING_APPROVAL",
            toStatus: "SHOPPING",
            event: {
                entry: makeEvent("ESTIMATE_REJECTED", "PASSENGER", req.user._id, {
                    fromStatus: "AWAITING_APPROVAL",
                    toStatus: "SHOPPING",
                    amount: order.estimatedCost,
                    note,
                }),
            },
        });

        if (!updated) {
            return res.status(409).json({
                success: false,
                message: "Order status changed. Please refresh.",
            });
        }

        await notifyAssignedPartner(
            updated,
            "purchase:approval:decision",
            {
                status: "SHOPPING",
                approved: false,
                message: "The passenger did not approve the estimate",
            },
            "Estimate Not Approved",
            "The passenger asked you to revise the shopping estimate.",
            "PURCHASE_APPROVAL_REJECTED"
        );

        return res.json({ success: true, order: updated });
    } catch {
        return res.status(400).json({
            success: false,
            message: "Unable to reject estimate",
        });
    }
};

// Passenger-facing delivery OTP (re)generation — parcel pattern: the
// stored value is only ever a hash; the plaintext is returned to the
// passenger, who reads it to the partner at the door.
const regeneratePurchaseOtp = async (req, res) => {
    try {
        const stage = req.body?.stage || "DELIVERY";

        if (stage !== "DELIVERY") {
            return res.status(400).json({
                success: false,
                message: "Invalid verification stage",
            });
        }

        const otp = createPurchaseOtp();

        const order = await PurchaseOrder.findOneAndUpdate(
            {
                _id: req.params.id,
                passengerId: req.user._id,
                status: { $in: ["PURCHASED", "OUT_FOR_DELIVERY", "ARRIVED"] },
            },
            {
                $set: {
                    deliveryOtpHash: hashPurchaseOtp(otp),
                    deliveryOtpAttempts: 0,
                },
            },
            { new: true }
        ).select("_id status");

        if (!order) {
            return res.status(409).json({
                success: false,
                message: "OTP unavailable at this stage",
            });
        }

        return res.json({ success: true, stage: "DELIVERY", otp });
    } catch {
        return res.status(400).json({
            success: false,
            message: "Unable to generate OTP",
        });
    }
};

// ---------------------------------------------------------------------------
// Passenger: cancel / dispute / payment confirmation / rating
// ---------------------------------------------------------------------------

const cancelPurchaseOrder = async (req, res) => {
    try {
        const order = await PurchaseOrder.findOne({
            _id: req.params.id,
            passengerId: req.user._id,
        });

        if (!order) {
            return res.status(404).json({
                success: false,
                message: "Purchase order not found",
            });
        }

        const outcome = resolveCancelOutcome(order.status);

        if (!outcome) {
            return res.status(409).json({
                success: false,
                message: "This order cannot be cancelled at this stage",
            });
        }

        const reason = String(req.body?.reason || "").slice(0, 500);
        const fromStatus = order.status;

        if (outcome === "DISPUTED") {
            // The partner has already spent their own money: this is no
            // longer a cancellation, it is a reimbursement dispute.
            const updated = await transitionOrder({
                filter: { _id: order._id, passengerId: req.user._id },
                fromStatus,
                toStatus: "DISPUTED",
                set: {
                    disputedBy: "PASSENGER",
                    disputeReason:
                        reason || "Passenger cancelled after purchase",
                    disputedAt: new Date(),
                },
                event: {
                    entry: makeEvent(
                        "CANCEL_AFTER_PURCHASE_DISPUTED",
                        "PASSENGER",
                        req.user._id,
                        { fromStatus, toStatus: "DISPUTED", note: reason }
                    ),
                },
            });

            if (!updated) {
                return res.status(409).json({
                    success: false,
                    message: "Order status changed. Please refresh.",
                });
            }

            await notifyAssignedPartner(
                updated,
                "purchase:disputed",
                { status: "DISPUTED", message: "Order moved to dispute" },
                "Order Disputed",
                "The passenger cancelled after purchase. This is now a reimbursement dispute for admin review.",
                "PURCHASE_DISPUTED"
            );

            return res.json({
                success: true,
                order: updated,
                routedToDispute: true,
            });
        }

        const updated = await transitionOrder({
            filter: { _id: order._id, passengerId: req.user._id },
            fromStatus,
            toStatus: "CANCELLED",
            set: {
                cancelledBy: "PASSENGER",
                cancelReason: reason,
                cancelledAt: new Date(),
            },
            event: {
                entry: makeEvent("ORDER_CANCELLED", "PASSENGER", req.user._id, {
                    fromStatus,
                    toStatus: "CANCELLED",
                    note: reason,
                }),
            },
        });

        if (!updated) {
            return res.status(409).json({
                success: false,
                message: "Order status changed. Please refresh.",
            });
        }

        if (fromStatus === "BIDDING") {
            await PurchaseOffer.updateMany(
                { orderId: order._id, status: "PENDING" },
                { $set: { status: "EXPIRED" } }
            );
        }

        if (updated.driverId) {
            await notifyAssignedPartner(
                updated,
                "purchase:status:updated",
                { status: "CANCELLED", message: "Passenger cancelled the request" },
                "Request Cancelled",
                "The passenger cancelled this Buy & Deliver request.",
                "PURCHASE_CANCELLED"
            );
        }

        return res.json({ success: true, order: updated });
    } catch {
        return res.status(400).json({
            success: false,
            message: "Unable to cancel purchase order",
        });
    }
};

const raisePurchaseDispute = async (req, res) => {
    try {
        const reason = String(req.body?.reason || "").trim();

        if (!reason || reason.length > 500) {
            return res.status(400).json({
                success: false,
                message: "A dispute reason is required",
            });
        }

        const order = await PurchaseOrder.findById(req.params.id);

        if (!order) {
            return res.status(404).json({
                success: false,
                message: "Purchase order not found",
            });
        }

        // Resolve the actor server-side: owning passenger OR the
        // assigned partner. Anyone else is rejected outright.
        let actorRole = null;

        if (String(order.passengerId) === String(req.user._id)) {
            actorRole = "PASSENGER";
        } else {
            const driver = await loadDriverForUser(req.user._id);

            if (driver && String(order.driverId) === String(driver._id)) {
                actorRole = "DRIVER";
            }
        }

        if (!actorRole) {
            return res.status(403).json({
                success: false,
                message: "You are not a party to this order",
            });
        }

        if (!canDispute(order.status)) {
            return res.status(409).json({
                success: false,
                message: "A dispute cannot be raised at this stage",
            });
        }

        const fromStatus = order.status;

        const updated = await transitionOrder({
            filter: { _id: order._id },
            fromStatus,
            toStatus: "DISPUTED",
            set: {
                disputedBy: actorRole,
                disputeReason: reason,
                disputedAt: new Date(),
            },
            event: {
                entry: makeEvent("DISPUTE_RAISED", actorRole, req.user._id, {
                    fromStatus,
                    toStatus: "DISPUTED",
                    note: reason,
                }),
            },
        });

        if (!updated) {
            return res.status(409).json({
                success: false,
                message: "Order status changed. Please refresh.",
            });
        }

        if (actorRole === "PASSENGER") {
            await notifyAssignedPartner(
                updated,
                "purchase:disputed",
                { status: "DISPUTED", message: "Passenger raised a dispute" },
                "Dispute Raised",
                "The passenger raised a dispute on this order.",
                "PURCHASE_DISPUTED"
            );
        } else {
            notifyPassenger(
                updated,
                "purchase:disputed",
                { status: "DISPUTED", message: "Partner raised a dispute" },
                "Dispute Raised",
                "Your shopping partner raised a dispute on this order.",
                "PURCHASE_DISPUTED"
            );
        }

        return res.json({ success: true, order: updated });
    } catch {
        return res.status(400).json({
            success: false,
            message: "Unable to raise dispute",
        });
    }
};

// Passenger confirms an additional COD payment after a partially-paid
// delivery (partner recorded less than the total at the door).
const confirmPurchasePayment = async (req, res) => {
    try {
        const amount = Number(req.body?.amount);

        if (!isValidAmount(amount)) {
            return res.status(400).json({
                success: false,
                message: "Invalid payment amount",
            });
        }

        const order = await PurchaseOrder.findOne({
            _id: req.params.id,
            passengerId: req.user._id,
            status: "DELIVERED",
        });

        if (!order) {
            return res.status(409).json({
                success: false,
                message: "No delivered order is awaiting payment confirmation",
            });
        }

        const ledger = applyPayment({
            customerTotalPayable: order.customerTotalPayable || 0,
            reimbursementReceived: order.reimbursementReceived || 0,
            amount,
        });

        const set = {
            reimbursementReceived: ledger.reimbursementReceived,
            unpaidAmount: ledger.unpaidAmount,
        };

        let updated;

        if (ledger.fullyPaid && order.customerTotalPayable > 0) {
            set.completedAt = new Date();

            updated = await transitionOrder({
                filter: { _id: order._id, passengerId: req.user._id },
                fromStatus: "DELIVERED",
                toStatus: "COMPLETED",
                set,
                event: {
                    entry: makeEvent(
                        "PAYMENT_CONFIRMED",
                        "PASSENGER",
                        req.user._id,
                        {
                            fromStatus: "DELIVERED",
                            toStatus: "COMPLETED",
                            amount,
                        }
                    ),
                },
            });
        } else {
            updated = await PurchaseOrder.findOneAndUpdate(
                {
                    _id: order._id,
                    passengerId: req.user._id,
                    status: "DELIVERED",
                },
                {
                    $set: set,
                    $push: {
                        events: makeEvent(
                            "PAYMENT_CONFIRMED",
                            "PASSENGER",
                            req.user._id,
                            { amount }
                        ),
                    },
                },
                { new: true, runValidators: true }
            );
        }

        if (!updated) {
            return res.status(409).json({
                success: false,
                message: "Order status changed. Please refresh.",
            });
        }

        if (updated.status === "COMPLETED") {
            await notifyAssignedPartner(
                updated,
                "purchase:status:updated",
                { status: "COMPLETED", message: "Order completed" },
                "Order Completed",
                "Full payment confirmed. This Buy & Deliver order is complete.",
                "PURCHASE_COMPLETED"
            );
        }

        return res.json({ success: true, order: updated });
    } catch {
        return res.status(400).json({
            success: false,
            message: "Unable to confirm payment",
        });
    }
};

const ratePurchasePartner = async (req, res) => {
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

        const order = await PurchaseOrder.findOne({
            _id: req.params.id,
            passengerId: req.user._id,
            status: { $in: ["DELIVERED", "COMPLETED"] },
            ratedAt: null,
        });

        if (!order?.driverId) {
            return res.status(409).json({
                success: false,
                message: "This order cannot be rated",
            });
        }

        await PurchaseReview.create({
            purchaseOrderId: order._id,
            passengerId: req.user._id,
            driverId: order.driverId,
            rating,
            comment: comment.trim(),
        });

        await PurchaseOrder.updateOne(
            { _id: order._id },
            {
                $set: { ratedAt: new Date() },
                $push: {
                    events: makeEvent("PARTNER_RATED", "PASSENGER", req.user._id, {
                        amount: rating,
                    }),
                },
            }
        );

        // Driver.rating is a COMBINED aggregate: maintain it from both
        // review collections so purchase ratings never erase ride
        // ratings or vice versa.
        const [rideStats, purchaseStats] = await Promise.all([
            DriverReview.aggregate([
                { $match: { driverId: order.driverId, isHidden: false } },
                {
                    $group: {
                        _id: "$driverId",
                        total: { $sum: "$rating" },
                        count: { $sum: 1 },
                    },
                },
            ]),
            PurchaseReview.aggregate([
                { $match: { driverId: order.driverId, isHidden: false } },
                {
                    $group: {
                        _id: "$driverId",
                        total: { $sum: "$rating" },
                        count: { $sum: 1 },
                    },
                },
            ]),
        ]);

        const total =
            (rideStats[0]?.total || 0) + (purchaseStats[0]?.total || 0);
        const count =
            (rideStats[0]?.count || 0) + (purchaseStats[0]?.count || 0);

        await Driver.updateOne(
            { _id: order.driverId },
            {
                $set: {
                    rating: count ? total / count : 0,
                    ratingCount: count,
                },
            }
        );

        return res.status(201).json({
            success: true,
            message: "Review submitted successfully",
        });
    } catch (error) {
        if (error.code === 11000) {
            return res.status(409).json({
                success: false,
                message: "This order has already been rated",
            });
        }

        return res.status(500).json({
            success: false,
            message: "Unable to submit review",
        });
    }
};

// Passenger decides on a partner's substitution request (Phase 4 hook;
// the realtime chat UX over this arrives in Phase 6).
const decideSubstitution = async (req, res) => {
    try {
        const { substitutionId, approved } = req.body || {};

        if (typeof approved !== "boolean" || !substitutionId) {
            return res.status(400).json({
                success: false,
                message: "Invalid substitution decision",
            });
        }

        const updated = await PurchaseOrder.findOneAndUpdate(
            {
                _id: req.params.id,
                passengerId: req.user._id,
                status: { $in: ["SHOPPING", "AWAITING_APPROVAL", "PURCHASE_APPROVED"] },
                substitutions: {
                    $elemMatch: { _id: substitutionId, status: "PENDING" },
                },
            },
            {
                $set: {
                    "substitutions.$.status": approved ? "APPROVED" : "REJECTED",
                    "substitutions.$.decidedAt": new Date(),
                },
                $push: {
                    events: makeEvent(
                        approved ? "SUBSTITUTION_APPROVED" : "SUBSTITUTION_REJECTED",
                        "PASSENGER",
                        req.user._id,
                        {}
                    ),
                },
            },
            { new: true, runValidators: true }
        );

        if (!updated) {
            return res.status(409).json({
                success: false,
                message: "Substitution request not found or already decided",
            });
        }

        await notifyAssignedPartner(
            updated,
            "purchase:status:updated",
            {
                status: updated.status,
                message: approved
                    ? "Substitution approved"
                    : "Substitution rejected",
            },
            approved ? "Substitution Approved" : "Substitution Rejected",
            approved
                ? "The passenger approved your suggested substitution."
                : "The passenger did not approve your suggested substitution.",
            approved ? "PURCHASE_SUBSTITUTION_APPROVED" : "PURCHASE_SUBSTITUTION_REJECTED"
        );

        return res.json({ success: true, order: updated });
    } catch {
        return res.status(400).json({
            success: false,
            message: "Unable to decide substitution",
        });
    }
};

// ---------------------------------------------------------------------------
// Partner: request feed + offers
// (purchaseDriverEligibility middleware has already verified the caller
// is an eligible, online, GPS-fresh Buy & Deliver partner.)
// ---------------------------------------------------------------------------

const getAvailablePurchaseRequests = async (req, res) => {
    try {
        const driver = req.purchaseDriver;
        const settings = req.purchaseSettings;
        const record = eligibilityService.getServiceRecord(driver, "BUY_DELIVER");

        const orders = await PurchaseOrder.find({
            status: "BIDDING",
            driverId: null,
            deliveryAddress: {
                $near: {
                    $geometry: driver.currentLocation,
                    $maxDistance: req.purchaseRadiusKm * 1000,
                },
            },
        })
            .select(
                "status itemsText imageUrls preferences deliveryAddress deliveryLabel estimatedBudget createdAt"
            )
            .limit(50)
            .lean();

        // Only requests this partner may actually take: the estimated
        // budget must fit their purchaseLimit and the platform cap.
        const visible = orders.filter(
            (order) =>
                checkAmountWithinCaps(order.estimatedBudget, {
                    partnerLimit: record.purchaseLimit,
                    globalCap: settings?.buyDeliverMaxOrderValue ?? null,
                }).ok
        );

        // Embed the caller's OWN live offer on each request (Phase 7
        // fix): the driver feed kept its offer state only in memory,
        // so after an app restart a request the partner had already
        // bid on looked un-bid and the withdraw action vanished. An
        // expired PENDING offer is not embedded — mirroring the
        // passenger offers view, it no longer counts as a live bid.
        const visibleIds = visible.map((order) => order._id);
        const myOffers = visibleIds.length
            ? await PurchaseOffer.find({
                  orderId: { $in: visibleIds },
                  driverId: driver._id,
                  status: "PENDING",
                  expiresAt: { $gt: new Date() },
              })
                  .select("orderId deliveryFee status expiresAt createdAt")
                  .lean()
            : [];
        const myOfferByOrderId = new Map(
            myOffers.map((offer) => [String(offer.orderId), offer])
        );

        return res.json({
            success: true,
            orders: visible.map((order) => ({
                ...order,
                myOffer: myOfferByOrderId.get(String(order._id)) || null,
            })),
        });
    } catch (error) {
        console.error("Available purchase requests error:", error.message);
        return res.status(500).json({
            success: false,
            message: "Unable to load purchase requests",
        });
    }
};

const submitPurchaseOffer = async (req, res) => {
    try {
        const driver = req.purchaseDriver;

        // Wallet gate — Auto Free Mode expression copied from parcels:
        // no top-up enforcement until a payment method is configured.
        const commissionSettings = await CommissionSettings.findOne({
            key: "GLOBAL",
        })
            .select("topUpRequired minimumWalletBalance")
            .lean();

        const topUpEnforced =
            commissionSettings?.topUpRequired === true &&
            (await paymentsConfigured());

        if (topUpEnforced) {
            const wallet = await DriverWallet.findOne({
                driverId: driver._id,
            })
                .select("balance")
                .lean();

            const requiredBalance = Math.max(
                1,
                commissionSettings.minimumWalletBalance || 0
            );

            if (!wallet || wallet.balance < requiredBalance) {
                return res.status(402).json({
                    success: false,
                    code: "DRIVER_WALLET_TOP_UP_REQUIRED",
                    message: "Please top up your wallet to submit offers. Platform commission will be deducted from your wallet after each completed service.",
                });
            }
        }

        const deliveryFee = Number(req.body?.deliveryFee);

        if (!isValidAmount(deliveryFee)) {
            return res.status(400).json({
                success: false,
                message: "Invalid delivery fee",
            });
        }

        // The middleware already confirmed this order is open, nearby
        // and within this partner's limits; re-check state here because
        // the assignment update below must race safely.
        const order = await PurchaseOrder.findOne({
            _id: req.params.id,
            status: "BIDDING",
            driverId: null,
        });

        if (!order) {
            return res.status(409).json({
                success: false,
                message: "Purchase request unavailable",
            });
        }

        const expiresAt = new Date(Date.now() + OFFER_TTL_MS);

        const updated = await PurchaseOffer.findOneAndUpdate(
            {
                orderId: order._id,
                driverId: driver._id,
                status: "PENDING",
            },
            { $set: { deliveryFee, expiresAt } },
            { new: true, upsert: false }
        );

        if (!updated) {
            const created = await PurchaseOffer.create({
                orderId: order._id,
                driverId: driver._id,
                deliveryFee,
                expiresAt,
            });

            notifyPassenger(
                order,
                "purchase:offer:new",
                {
                    offerId: String(created._id),
                    deliveryFee: created.deliveryFee,
                    message: "New partner offer received",
                },
                "New Buy & Deliver Offer",
                `A partner offered a delivery fee of PKR ${created.deliveryFee}.`,
                "PURCHASE_OFFER"
            );

            return res.status(201).json({ success: true, offer: created });
        }

        notifyPassenger(
            order,
            "purchase:offer:new",
            {
                offerId: String(updated._id),
                deliveryFee: updated.deliveryFee,
                message: "Partner updated their offer",
            },
            "Offer Updated",
            `A partner updated their delivery fee to PKR ${updated.deliveryFee}.`,
            "PURCHASE_OFFER"
        );

        return res.json({ success: true, offer: updated });
    } catch (error) {
        console.error("Submit purchase offer error:", error.message);
        return res.status(500).json({
            success: false,
            message: "Unable to submit offer",
        });
    }
};

const withdrawPurchaseOffer = async (req, res) => {
    try {
        const driver = req.purchaseDriver;

        const offer = await PurchaseOffer.findOneAndUpdate(
            {
                orderId: req.params.id,
                driverId: driver._id,
                status: "PENDING",
            },
            { $set: { status: "WITHDRAWN" } },
            { new: true }
        );

        if (!offer) {
            return res.status(409).json({
                success: false,
                message: "No active offer to withdraw",
            });
        }

        return res.json({ success: true, offer });
    } catch {
        return res.status(400).json({
            success: false,
            message: "Unable to withdraw offer",
        });
    }
};

// ---------------------------------------------------------------------------
// Partner: my tasks + execution workflow
// ---------------------------------------------------------------------------

const ACTIVE_TASK_STATUSES = [
    "DRIVER_SELECTED",
    "SHOPPING",
    "AWAITING_APPROVAL",
    "PURCHASE_APPROVED",
    "PURCHASED",
    "OUT_FOR_DELIVERY",
    "ARRIVED",
    "DELIVERED",
];

const getDriverPurchaseTasks = async (req, res) => {
    try {
        const driver = await loadDriverForUser(req.user._id);

        if (!driver) {
            return res.status(403).json({
                success: false,
                message: "Driver profile not found",
            });
        }

        const orders = await PurchaseOrder.find({
            driverId: driver._id,
            status: { $in: ACTIVE_TASK_STATUSES },
        })
            .sort({ assignedAt: -1 })
            .limit(20)
            .lean();

        return res.json({ success: true, orders });
    } catch {
        return res.status(500).json({
            success: false,
            message: "Unable to load purchase tasks",
        });
    }
};

// Partner's per-order view, with the financial block shaped explicitly:
// service earnings (delivery fee) are reported apart from the shopping
// money (advanced / reimbursed / unpaid) — they are different kinds of
// money and the UI must never merge them.
const getDriverPurchaseDetails = async (req, res) => {
    try {
        const driver = await loadDriverForUser(req.user._id);

        if (!driver) {
            return res.status(403).json({
                success: false,
                message: "Driver profile not found",
            });
        }

        const order = await PurchaseOrder.findOne({
            _id: req.params.id,
            driverId: driver._id,
        }).lean();

        if (!order) {
            return res.status(404).json({
                success: false,
                message: "Assigned purchase order not found",
            });
        }

        const financials = {
            estimatedBudget: order.estimatedBudget,
            estimatedCost: order.estimatedCost,
            approvedMaxAmount: order.approvedMaxAmount,
            // Shopping money (reimbursement side — NOT earnings):
            shoppingAdvanced: order.actualCost,
            reimbursementReceived: order.reimbursementReceived,
            unpaidAmount: order.unpaidAmount,
            // Service side (the partner's actual charge):
            deliveryFee: order.deliveryFee,
            customerTotalPayable: order.customerTotalPayable,
            settlementStatus: order.settlementStatus,
        };

        return res.json({ success: true, order, financials });
    } catch {
        return res.status(400).json({
            success: false,
            message: "Unable to load purchase details",
        });
    }
};

// Shared loader for partner execution actions: resolves the caller's
// driver profile and their assigned order, or writes the error.
const loadAssignedOrder = async (req, res) => {
    const driver = await loadDriverForUser(req.user._id);

    if (!driver) {
        res.status(403).json({
            success: false,
            message: "Driver profile not found",
        });
        return null;
    }

    const order = await PurchaseOrder.findOne({
        _id: req.params.id,
        driverId: driver._id,
    });

    if (!order) {
        res.status(404).json({
            success: false,
            message: "Assigned purchase order not found",
        });
        return null;
    }

    return { driver, order };
};

const startShopping = async (req, res) => {
    try {
        const loaded = await loadAssignedOrder(req, res);
        if (!loaded) return;
        const { order } = loaded;

        const updated = await transitionOrder({
            filter: { _id: order._id, driverId: order.driverId },
            fromStatus: "DRIVER_SELECTED",
            toStatus: "SHOPPING",
            set: { shoppingStartedAt: new Date() },
            event: {
                entry: makeEvent("SHOPPING_STARTED", "DRIVER", req.user._id, {
                    fromStatus: "DRIVER_SELECTED",
                    toStatus: "SHOPPING",
                }),
            },
        });

        if (!updated) {
            return res.status(409).json({
                success: false,
                message: "Shopping cannot be started at this stage",
            });
        }

        notifyPassenger(
            updated,
            "purchase:status:updated",
            { status: "SHOPPING", message: "Partner started shopping" },
            "Shopping Started",
            "Your partner has started shopping for your items.",
            "PURCHASE_SHOPPING_STARTED"
        );

        return res.json({ success: true, order: updated });
    } catch {
        return res.status(400).json({
            success: false,
            message: "Unable to start shopping",
        });
    }
};

// The partner chooses/updates where they are shopping AFTER assignment
// (matching never assumed a store location — spec Part 6.1).
const updateShoppingLocation = async (req, res) => {
    try {
        const loaded = await loadAssignedOrder(req, res);
        if (!loaded) return;
        const { order } = loaded;

        const { latitude, longitude, address = "", name = "" } = req.body || {};

        if (
            !validPoint({ latitude, longitude }) ||
            typeof name !== "string" ||
            name.length > 120
        ) {
            return res.status(400).json({
                success: false,
                message: "Invalid shopping location",
            });
        }

        if (
            !["DRIVER_SELECTED", "SHOPPING", "AWAITING_APPROVAL", "PURCHASE_APPROVED", "PURCHASED"].includes(order.status)
        ) {
            return res.status(409).json({
                success: false,
                message: "Shopping location cannot be set at this stage",
            });
        }

        const updated = await PurchaseOrder.findOneAndUpdate(
            { _id: order._id, driverId: order.driverId, status: order.status },
            {
                $set: {
                    shoppingLocation: {
                        point: {
                            type: "Point",
                            coordinates: [longitude, latitude],
                            address: String(address || "").slice(0, 300),
                        },
                        name: name.slice(0, 120),
                    },
                },
            },
            { new: true, runValidators: true }
        );

        if (!updated) {
            return res.status(409).json({
                success: false,
                message: "Order status changed. Please refresh.",
            });
        }

        return res.json({ success: true, order: updated });
    } catch {
        return res.status(400).json({
            success: false,
            message: "Unable to update shopping location",
        });
    }
};

// Partner submits (or revises) the shopping-cost estimate. From
// SHOPPING this asks the passenger to approve a purchase amount; from
// PURCHASE_APPROVED an amount ABOVE the approved maximum is a cost-
// increase request and goes back through approval — an amount at or
// below the approved maximum is just an estimate refinement.
const submitCostEstimate = async (req, res) => {
    try {
        const loaded = await loadAssignedOrder(req, res);
        if (!loaded) return;
        const { driver, order } = loaded;

        if (!["SHOPPING", "PURCHASE_APPROVED"].includes(order.status)) {
            return res.status(409).json({
                success: false,
                message: "A cost estimate cannot be submitted at this stage",
            });
        }

        const amount = Number(req.body?.amount);
        const note = String(req.body?.note || "").slice(0, 500);

        const settings = await getGlobalSettings();
        const record = eligibilityService.getServiceRecord(driver, "BUY_DELIVER");

        const capCheck = checkAmountWithinCaps(amount, {
            partnerLimit: record.purchaseLimit,
            globalCap: settings?.buyDeliverMaxOrderValue ?? null,
        });

        if (!capCheck.ok) {
            return res.status(400).json({
                success: false,
                code: capCheck.code,
                message: capCheck.message,
            });
        }

        const isIncreaseRequest =
            order.status === "PURCHASE_APPROVED" &&
            amount > (order.approvedMaxAmount || 0);

        if (order.status === "PURCHASE_APPROVED" && !isIncreaseRequest) {
            const updated = await PurchaseOrder.findOneAndUpdate(
                { _id: order._id, driverId: driver._id, status: "PURCHASE_APPROVED" },
                {
                    $set: { estimatedCost: amount },
                    $push: {
                        events: makeEvent(
                            "ESTIMATE_UPDATED",
                            "DRIVER",
                            req.user._id,
                            { amount, note }
                        ),
                    },
                },
                { new: true, runValidators: true }
            );

            if (!updated) {
                return res.status(409).json({
                    success: false,
                    message: "Order status changed. Please refresh.",
                });
            }

            return res.json({ success: true, order: updated });
        }

        const fromStatus = order.status;

        const updated = await transitionOrder({
            filter: { _id: order._id, driverId: driver._id },
            fromStatus,
            toStatus: "AWAITING_APPROVAL",
            set: { estimatedCost: amount },
            event: {
                entry: makeEvent(
                    isIncreaseRequest
                        ? "COST_INCREASE_REQUESTED"
                        : "COST_ESTIMATE_SUBMITTED",
                    "DRIVER",
                    req.user._id,
                    { fromStatus, toStatus: "AWAITING_APPROVAL", amount, note }
                ),
            },
        });

        if (!updated) {
            return res.status(409).json({
                success: false,
                message: "Order status changed. Please refresh.",
            });
        }

        notifyPassenger(
            updated,
            "purchase:approval:requested",
            {
                status: "AWAITING_APPROVAL",
                estimatedCost: amount,
                message: isIncreaseRequest
                    ? "Partner requested a cost increase approval"
                    : "Partner submitted a shopping estimate for approval",
            },
            "Approval Needed",
            `Your partner's shopping estimate is PKR ${amount}. Please approve the purchase amount to continue.`,
            "PURCHASE_APPROVAL_REQUESTED"
        );

        return res.json({ success: true, order: updated });
    } catch {
        return res.status(400).json({
            success: false,
            message: "Unable to submit cost estimate",
        });
    }
};

// Partner asks the passenger to confirm an item substitution (hook for
// the Phase 6 chat UX; the passenger decides via decideSubstitution).
const requestSubstitution = async (req, res) => {
    try {
        const loaded = await loadAssignedOrder(req, res);
        if (!loaded) return;
        const { order } = loaded;

        const description = String(req.body?.description || "").trim();

        if (!description || description.length > 300) {
            return res.status(400).json({
                success: false,
                message: "Describe the substitution you are suggesting",
            });
        }

        if (order.status !== "SHOPPING") {
            return res.status(409).json({
                success: false,
                message: "Substitutions can only be requested while shopping",
            });
        }

        const blockedTerm = findBlockedTerm(
            description,
            blockedTermsFor(await getGlobalSettings())
        );

        if (blockedTerm) {
            return res.status(400).json({
                success: false,
                code: "RESTRICTED_ITEM",
                message: `"${blockedTerm}" is a restricted item and cannot be ordered through Buy & Deliver`,
            });
        }

        const updated = await PurchaseOrder.findOneAndUpdate(
            { _id: order._id, driverId: order.driverId, status: "SHOPPING" },
            {
                $push: {
                    substitutions: { description, status: "PENDING" },
                    events: makeEvent(
                        "SUBSTITUTION_REQUESTED",
                        "DRIVER",
                        req.user._id,
                        { note: description }
                    ),
                },
            },
            { new: true, runValidators: true }
        );

        if (!updated) {
            return res.status(409).json({
                success: false,
                message: "Order status changed. Please refresh.",
            });
        }

        notifyPassenger(
            updated,
            "purchase:status:updated",
            {
                status: updated.status,
                message: "Partner suggested an item substitution",
            },
            "Substitution Suggested",
            "Your partner suggested an item substitution. Please review it.",
            "PURCHASE_SUBSTITUTION_REQUESTED"
        );

        return res.json({ success: true, order: updated });
    } catch {
        return res.status(400).json({
            success: false,
            message: "Unable to request substitution",
        });
    }
};

// Partner records the completed purchase: actual spend + receipt
// evidence. The spend may NEVER exceed the passenger-approved maximum.
const markPurchased = async (req, res) => {
    try {
        const loaded = await loadAssignedOrder(req, res);
        if (!loaded) return;
        const { order } = loaded;

        if (order.status !== "PURCHASE_APPROVED") {
            return res.status(409).json({
                success: false,
                message: "The purchase amount has not been approved yet",
            });
        }

        const actualCost = Number(req.body?.actualCost);
        const receiptImageUrls = req.body?.receiptImageUrls || [];

        if (!validImageUrls(receiptImageUrls, 6) || receiptImageUrls.length < 1) {
            return res.status(400).json({
                success: false,
                message: "At least one receipt photo is required",
            });
        }

        const approvalCheck = checkPurchaseWithinApproval(
            actualCost,
            order.approvedMaxAmount
        );

        if (!approvalCheck.ok) {
            return res.status(409).json({
                success: false,
                code: approvalCheck.code,
                message: approvalCheck.message,
            });
        }

        const totals = computeTotals({
            actualCost,
            deliveryFee: order.deliveryFee,
        });

        const updated = await transitionOrder({
            filter: { _id: order._id, driverId: order.driverId },
            fromStatus: "PURCHASE_APPROVED",
            toStatus: "PURCHASED",
            set: {
                actualCost,
                receiptImageUrls,
                customerTotalPayable: totals.customerTotalPayable,
                unpaidAmount: Math.max(
                    0,
                    totals.customerTotalPayable - (order.reimbursementReceived || 0)
                ),
                purchasedAt: new Date(),
            },
            event: {
                entry: makeEvent("ITEMS_PURCHASED", "DRIVER", req.user._id, {
                    fromStatus: "PURCHASE_APPROVED",
                    toStatus: "PURCHASED",
                    amount: actualCost,
                }),
            },
        });

        if (!updated) {
            return res.status(409).json({
                success: false,
                message: "Order status changed. Please refresh.",
            });
        }

        notifyPassenger(
            updated,
            "purchase:status:updated",
            {
                status: "PURCHASED",
                actualCost,
                customerTotalPayable: totals.customerTotalPayable,
                message: "Partner purchased your items",
            },
            "Items Purchased",
            `Your partner purchased your items for PKR ${actualCost}. Receipt attached to the order.`,
            "PURCHASE_PURCHASED"
        );

        return res.json({ success: true, order: updated });
    } catch {
        return res.status(400).json({
            success: false,
            message: "Unable to record purchase",
        });
    }
};

const markOutForDelivery = async (req, res) => {
    try {
        const loaded = await loadAssignedOrder(req, res);
        if (!loaded) return;
        const { order } = loaded;

        const updated = await transitionOrder({
            filter: { _id: order._id, driverId: order.driverId },
            fromStatus: "PURCHASED",
            toStatus: "OUT_FOR_DELIVERY",
            set: { outForDeliveryAt: new Date() },
            event: {
                entry: makeEvent("OUT_FOR_DELIVERY", "DRIVER", req.user._id, {
                    fromStatus: "PURCHASED",
                    toStatus: "OUT_FOR_DELIVERY",
                }),
            },
        });

        if (!updated) {
            return res.status(409).json({
                success: false,
                message: "Order cannot head out for delivery at this stage",
            });
        }

        notifyPassenger(
            updated,
            "purchase:status:updated",
            { status: "OUT_FOR_DELIVERY", message: "Partner is on the way" },
            "On The Way",
            "Your partner is on the way with your items.",
            "PURCHASE_OUT_FOR_DELIVERY"
        );

        return res.json({ success: true, order: updated });
    } catch {
        return res.status(400).json({
            success: false,
            message: "Unable to update order",
        });
    }
};

const markArrived = async (req, res) => {
    try {
        const loaded = await loadAssignedOrder(req, res);
        if (!loaded) return;
        const { order } = loaded;

        const updated = await transitionOrder({
            filter: { _id: order._id, driverId: order.driverId },
            fromStatus: "OUT_FOR_DELIVERY",
            toStatus: "ARRIVED",
            set: { arrivedAt: new Date() },
            event: {
                entry: makeEvent("ARRIVED", "DRIVER", req.user._id, {
                    fromStatus: "OUT_FOR_DELIVERY",
                    toStatus: "ARRIVED",
                }),
            },
        });

        if (!updated) {
            return res.status(409).json({
                success: false,
                message: "Order cannot be marked arrived at this stage",
            });
        }

        notifyPassenger(
            updated,
            "purchase:status:updated",
            { status: "ARRIVED", message: "Partner has arrived" },
            "Partner Arrived",
            "Your partner has arrived. Please share your delivery code to receive your items.",
            "PURCHASE_ARRIVED"
        );

        return res.json({ success: true, order: updated });
    } catch {
        return res.status(400).json({
            success: false,
            message: "Unable to update order",
        });
    }
};

// Delivery completion: OTP-verified, exactly once. The OTP attempt is
// consumed atomically (parcel pattern), the status guard makes a second
// delivery call a 409, and the payment recorded at the door settles the
// reimbursement ledger — full payment completes the order immediately.
const deliverPurchaseOrder = async (req, res) => {
    try {
        const loaded = await loadAssignedOrder(req, res);
        if (!loaded) return;
        const { order } = loaded;

        if (order.status !== "ARRIVED") {
            return res.status(409).json({
                success: false,
                message: "Order must be at the delivery location before it can be delivered",
            });
        }

        const otp = req.body?.otp;

        if (!/^\d{6}$/.test(String(otp || ""))) {
            return res.status(400).json({
                success: false,
                message: "Enter the 6-digit confirmation code",
            });
        }

        const verified = await verifyDeliveryOtp(order, String(otp));

        if (!verified) {
            return res.status(403).json({
                success: false,
                message: "Invalid OTP or maximum 5 attempts reached. Ask the passenger for a new code.",
            });
        }

        // COD collected at the door. Defaults to the full amount owed;
        // a smaller recorded amount leaves the order DELIVERED with an
        // unpaid balance (the passenger can confirm the rest later).
        const amountReceived =
            req.body?.amountReceived === undefined
                ? order.customerTotalPayable || 0
                : Number(req.body.amountReceived);

        if (
            !Number.isSafeInteger(amountReceived) ||
            amountReceived < 0
        ) {
            return res.status(400).json({
                success: false,
                message: "Invalid received amount",
            });
        }

        const ledger = applyPayment({
            customerTotalPayable: order.customerTotalPayable || 0,
            reimbursementReceived: order.reimbursementReceived || 0,
            amount: amountReceived,
        });

        const delivered = await transitionOrder({
            filter: { _id: order._id, driverId: order.driverId },
            fromStatus: "ARRIVED",
            toStatus: "DELIVERED",
            set: {
                deliveredAt: new Date(),
                deliveryOtpVerifiedAt: new Date(),
                deliveryOtpHash: null,
                reimbursementReceived: ledger.reimbursementReceived,
                unpaidAmount: ledger.unpaidAmount,
                // Commission on the delivery fee becomes due now
                // (settled asynchronously by purchaseSettlementService;
                // zero while Auto Free Mode applies).
                settlementStatus: "PENDING",
            },
            event: {
                flags: { otpVerified: true },
                entry: makeEvent("DELIVERED", "DRIVER", req.user._id, {
                    fromStatus: "ARRIVED",
                    toStatus: "DELIVERED",
                    amount: amountReceived,
                }),
            },
        });

        if (!delivered) {
            return res.status(409).json({
                success: false,
                message: "Order status changed. Please refresh.",
            });
        }

        notifyPassenger(
            delivered,
            "purchase:status:updated",
            {
                status: "DELIVERED",
                unpaidAmount: ledger.unpaidAmount,
                message: "Items delivered",
            },
            "Delivered",
            "Your items have been delivered.",
            "PURCHASE_DELIVERED"
        );

        let finalOrder = delivered;

        if (ledger.fullyPaid && (order.customerTotalPayable || 0) > 0) {
            const completed = await transitionOrder({
                filter: { _id: order._id, driverId: order.driverId },
                fromStatus: "DELIVERED",
                toStatus: "COMPLETED",
                set: { completedAt: new Date() },
                event: {
                    entry: makeEvent("ORDER_COMPLETED", "SYSTEM", null, {
                        fromStatus: "DELIVERED",
                        toStatus: "COMPLETED",
                    }),
                },
            });

            if (completed) {
                finalOrder = completed;

                notifyPassenger(
                    completed,
                    "purchase:status:updated",
                    { status: "COMPLETED", message: "Order completed" },
                    "Order Completed",
                    "Payment settled. Thank you for using Buy & Deliver.",
                    "PURCHASE_COMPLETED"
                );
            }
        }

        return res.json({ success: true, order: finalOrder });
    } catch {
        return res.status(400).json({
            success: false,
            message: "Unable to complete delivery",
        });
    }
};

module.exports = {
    // Passenger
    createPurchaseOrder,
    getMyPurchaseOrders,
    getPurchaseOrderDetails,
    getPurchaseOffers,
    acceptPurchaseOffer,
    approvePurchaseAmount,
    rejectPurchaseEstimate,
    regeneratePurchaseOtp,
    cancelPurchaseOrder,
    raisePurchaseDispute,
    confirmPurchasePayment,
    ratePurchasePartner,
    decideSubstitution,
    // Partner
    getAvailablePurchaseRequests,
    submitPurchaseOffer,
    withdrawPurchaseOffer,
    getDriverPurchaseTasks,
    getDriverPurchaseDetails,
    startShopping,
    updateShoppingLocation,
    submitCostEstimate,
    requestSubstitution,
    markPurchased,
    markOutForDelivery,
    markArrived,
    deliverPurchaseOrder,
};
