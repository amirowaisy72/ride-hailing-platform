const mongoose = require("mongoose");

const PurchaseOrder = require("../models/PurchaseOrder");
const PurchaseOffer = require("../models/PurchaseOffer");
const PurchaseSettlement = require("../models/PurchaseSettlement");
const PurchaseReview = require("../models/PurchaseReview");
const OrderConversation = require("../models/OrderConversation");
const OrderMessage = require("../models/OrderMessage");
const Driver = require("../models/Driver");
const CommissionSettings = require("../models/CommissionSettings");
const { publishEvent } = require("../services/socketService");
const { sendPushToUser } = require("../services/pushService");
const {
    PURCHASE_STATUSES,
    evaluatePurchaseDisputeResolution,
} = require("../services/purchaseOrderService");
const {
    suspendDriverService,
} = require("./adminDriverServiceController");

// ---------------------------------------------------------------------------
// Phase 7 — Buy & Deliver ADMIN endpoints.
// Mounted under /api/v1/admin/purchases (see routes/adminPurchaseRoutes
// .js), behind protect + authorize("ADMIN") like every admin module.
//
// Read access is deliberately full: participants, item lists, approved
// budget vs actual spend, receipts and the complete events[] audit —
// plus the order's chat threads, INCLUDING the losing bidders' CLOSED
// threads, which Phase 6 retains server-side for exactly this dispute
// review. Writes go through the domain rules only: dispute resolution
// is evaluated by purchaseOrderService (DISPUTED is terminal in the
// operational machine; resolution is the admin-only outcome set), and
// partner restriction reuses the per-service suspension machinery —
// nothing here writes a status ad-hoc.
// ---------------------------------------------------------------------------

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

// Socket + FCM pair, same split as the purchase controller: socket for
// the open app, FCM push for a backgrounded one.
const notifyUser = (userId, { event, room, payload, title, body, data }) => {
    if (room && event) {
        publishEvent(event, room, payload);
    }

    if (userId && title) {
        void sendPushToUser(userId, title, body, data || {});
    }
};

const notifyPassenger = (order, payload, title, body, type) => {
    notifyUser(order.passengerId, {
        event: "purchase:status:updated",
        room: `passenger:${order.passengerId}`,
        payload: { orderId: String(order._id), ...payload },
        title,
        body,
        data: { type, orderId: String(order._id) },
    });
};

const notifyAssignedPartner = async (order, payload, title, body, type) => {
    if (!order.driverId) return;

    const driver = await Driver.findById(order.driverId)
        .select("userId")
        .lean();

    if (!driver?.userId) return;

    notifyUser(driver.userId, {
        event: "purchase:status:updated",
        room: `driver:${driver.userId}`,
        payload: { orderId: String(order._id), ...payload },
        title,
        body,
        data: { type, orderId: String(order._id) },
    });
};

const escapeRegExp = (value) =>
    String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const isValidId = (value) => mongoose.isValidObjectId(String(value || ""));

const PARTICIPANT_POPULATE = [
    { path: "passengerId", select: "firstName lastName email" },
    {
        path: "driverId",
        populate: { path: "userId", select: "firstName lastName email" },
    },
];

// ---------------------------------------------------------------------------
// Order search / list
// ---------------------------------------------------------------------------

const listPurchaseOrdersAdmin = async (req, res) => {
    try {
        const {
            status,
            disputed,
            passengerId,
            driverId,
            from,
            to,
            q,
        } = req.query || {};

        const filter = {};

        if (status) {
            if (!PURCHASE_STATUSES.includes(status)) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid order status filter",
                });
            }
            filter.status = status;
        } else if (disputed === "true") {
            filter.status = "DISPUTED";
        }

        for (const [field, value] of [
            ["passengerId", passengerId],
            ["driverId", driverId],
        ]) {
            if (value) {
                if (!isValidId(value)) {
                    return res.status(400).json({
                        success: false,
                        message: `Invalid ${field} filter`,
                    });
                }
                filter[field] = value;
            }
        }

        if (from || to) {
            const range = {};
            if (from) {
                const fromDate = new Date(from);
                if (!Number.isFinite(fromDate.getTime())) {
                    return res.status(400).json({
                        success: false,
                        message: "Invalid from date",
                    });
                }
                range.$gte = fromDate;
            }
            if (to) {
                const toDate = new Date(to);
                if (!Number.isFinite(toDate.getTime())) {
                    return res.status(400).json({
                        success: false,
                        message: "Invalid to date",
                    });
                }
                range.$lte = toDate;
            }
            filter.createdAt = range;
        }

        if (q && String(q).trim()) {
            filter.itemsText = {
                $regex: escapeRegExp(String(q).trim()),
                $options: "i",
            };
        }

        const limit = Math.min(
            Math.max(Number(req.query?.limit) || 100, 1),
            200
        );

        const orders = await PurchaseOrder.find(filter)
            .populate(PARTICIPANT_POPULATE)
            .sort({ createdAt: -1 })
            .limit(limit)
            .lean();

        return res.json({ success: true, orders });
    } catch (error) {
        console.error("Admin purchase list error:", error.message);
        return res.status(500).json({
            success: false,
            message: "Unable to load purchase orders",
        });
    }
};

// ---------------------------------------------------------------------------
// Order detail — participants, financial record, receipts, offers,
// settlement, review and the FULL events[] audit trail.
// (deliveryOtpHash is select:false on the model and never leaves the
// server, here included.)
// ---------------------------------------------------------------------------

const getPurchaseOrderAdmin = async (req, res) => {
    try {
        if (!isValidId(req.params.id)) {
            return res.status(400).json({
                success: false,
                message: "Invalid order ID",
            });
        }

        const order = await PurchaseOrder.findById(req.params.id)
            .populate(PARTICIPANT_POPULATE)
            .lean();

        if (!order) {
            return res.status(404).json({
                success: false,
                message: "Purchase order not found",
            });
        }

        const [offers, settlement, review] = await Promise.all([
            PurchaseOffer.find({ orderId: order._id })
                .sort({ createdAt: 1 })
                .lean(),
            PurchaseSettlement.findOne({ purchaseOrderId: order._id }).lean(),
            PurchaseReview.findOne({ purchaseOrderId: order._id }).lean(),
        ]);

        // Enrich offers with the offering partner's identity, mirroring
        // the passenger offers view (name only — admins open the driver
        // record itself for anything deeper).
        const offerDriverIds = [
            ...new Set(offers.map((o) => String(o.driverId))),
        ];
        const offerDrivers = offerDriverIds.length
            ? await Driver.find({ _id: { $in: offerDriverIds } })
                  .populate("userId", "firstName lastName email")
                  .select("userId rating ratingCount")
                  .lean()
            : [];
        const offerDriverById = new Map(
            offerDrivers.map((d) => [String(d._id), d])
        );

        return res.json({
            success: true,
            order,
            offers: offers.map((offer) => ({
                ...offer,
                driver: offerDriverById.get(String(offer.driverId)) || null,
            })),
            settlement: settlement || null,
            review: review || null,
            // The reimbursement ledger, stated plainly so it is never
            // mistaken for partner earnings (only the delivery fee is).
            reimbursement: {
                shoppingCostAdvanced: order.actualCost ?? null,
                reimbursementReceived: order.reimbursementReceived || 0,
                unpaidAmount: order.unpaidAmount || 0,
                deliveryFee: order.deliveryFee ?? null,
                customerTotalPayable: order.customerTotalPayable ?? null,
                settlementStatus: order.settlementStatus,
            },
        });
    } catch (error) {
        console.error("Admin purchase detail error:", error.message);
        return res.status(500).json({
            success: false,
            message: "Unable to load purchase order",
        });
    }
};

// ---------------------------------------------------------------------------
// Dispute evidence — the order's chat threads (read-only for admins).
// ---------------------------------------------------------------------------

const serializeAdminMessage = (doc) => {
    const m =
        doc && typeof doc.toObject === "function" ? doc.toObject() : doc;
    return {
        _id: m._id,
        conversationId: m.conversationId,
        senderId: m.senderId || null,
        senderRole: m.senderRole,
        kind: m.kind,
        body: m.body || "",
        imageUrl: m.imageUrl || "",
        eventType: m.eventType || null,
        event: m.event || null,
        readAt: m.readAt || null,
        createdAt: m.createdAt,
    };
};

const listPurchaseConversationsAdmin = async (req, res) => {
    try {
        if (!isValidId(req.params.id)) {
            return res.status(400).json({
                success: false,
                message: "Invalid order ID",
            });
        }

        const order = await PurchaseOrder.findById(req.params.id)
            .select("_id")
            .lean();

        if (!order) {
            return res.status(404).json({
                success: false,
                message: "Purchase order not found",
            });
        }

        const conversations = await OrderConversation.find({
            orderType: "PURCHASE",
            orderId: order._id,
        })
            .populate("passengerId", "firstName lastName email")
            .populate("partnerUserId", "firstName lastName email")
            .sort({ lastMessageAt: -1 })
            .lean();

        const withCounts = await Promise.all(
            conversations.map(async (conversation) => {
                const [messageCount, lastMessage] = await Promise.all([
                    OrderMessage.countDocuments({
                        conversationId: conversation._id,
                    }),
                    OrderMessage.findOne({ conversationId: conversation._id })
                        .sort({ createdAt: -1 })
                        .lean(),
                ]);

                return {
                    ...conversation,
                    messageCount,
                    lastMessage: lastMessage
                        ? serializeAdminMessage(lastMessage)
                        : null,
                };
            })
        );

        return res.json({ success: true, conversations: withCounts });
    } catch (error) {
        console.error("Admin purchase conversations error:", error.message);
        return res.status(500).json({
            success: false,
            message: "Unable to load conversations",
        });
    }
};

const listPurchaseConversationMessagesAdmin = async (req, res) => {
    try {
        if (
            !isValidId(req.params.id) ||
            !isValidId(req.params.conversationId)
        ) {
            return res.status(400).json({
                success: false,
                message: "Invalid ID",
            });
        }

        // The conversation must belong to THIS order — an admin reads a
        // thread through the order it evidences, never by bare id.
        const conversation = await OrderConversation.findOne({
            _id: req.params.conversationId,
            orderType: "PURCHASE",
            orderId: req.params.id,
        }).lean();

        if (!conversation) {
            return res.status(404).json({
                success: false,
                message: "Conversation not found for this order",
            });
        }

        const filter = { conversationId: conversation._id };

        if (req.query?.before) {
            const before = new Date(req.query.before);
            if (Number.isFinite(before.getTime())) {
                filter.createdAt = { $lt: before };
            }
        }

        const limit = Math.min(
            Math.max(Number(req.query?.limit) || 100, 1),
            200
        );

        const page = await OrderMessage.find(filter)
            .sort({ createdAt: -1 })
            .limit(limit)
            .lean();

        return res.json({
            success: true,
            conversation,
            messages: page.reverse().map(serializeAdminMessage),
        });
    } catch (error) {
        console.error("Admin purchase messages error:", error.message);
        return res.status(500).json({
            success: false,
            message: "Unable to load messages",
        });
    }
};

// ---------------------------------------------------------------------------
// Dispute resolution — the admin-only outcome set from
// purchaseOrderService, applied atomically against status DISPUTED.
// ---------------------------------------------------------------------------

const resolvePurchaseDispute = async (req, res) => {
    try {
        const { outcome, paymentAmount } = req.body || {};
        const note = String(req.body?.note || "").trim();

        if (!note || note.length > 500) {
            return res.status(400).json({
                success: false,
                message: "A resolution note is required",
            });
        }

        const order = await PurchaseOrder.findById(req.params.id);

        if (!order) {
            return res.status(404).json({
                success: false,
                message: "Purchase order not found",
            });
        }

        const decision = evaluatePurchaseDisputeResolution({
            order,
            outcome,
            paymentAmount:
                paymentAmount === undefined ? 0 : Number(paymentAmount),
        });

        if (!decision.ok) {
            const conflict = [
                "ORDER_NOT_DISPUTED",
                "ORDER_NOT_FULLY_PAID",
                "NOTHING_TO_SETTLE",
            ].includes(decision.code);

            return res.status(conflict ? 409 : 400).json({
                success: false,
                code: decision.code,
                message: decision.message,
            });
        }

        const now = new Date();
        const set = {
            status: decision.toStatus,
            disputeResolution: {
                outcome: decision.toStatus,
                note,
                resolvedBy: req.user._id,
                resolvedAt: now,
            },
        };

        if (decision.toStatus === "COMPLETED") {
            set.completedAt = now;

            if (decision.ledger) {
                set.reimbursementReceived = decision.ledger.reimbursementReceived;
                set.unpaidAmount = decision.ledger.unpaidAmount;
            }

            // The partner earned the delivery fee: if settlement was
            // never queued (dispute raised before delivery), queue it
            // now — the pending-settlement processor settles it under
            // the ordinary rules (fee only, zero in Auto Free Mode).
            if (
                order.settlementStatus === "NOT_REQUIRED" &&
                Number.isSafeInteger(order.deliveryFee) &&
                order.deliveryFee >= 1
            ) {
                set.settlementStatus = "PENDING";
            }
        } else {
            set.cancelledBy = "ADMIN";
            set.cancelledAt = now;
            set.cancelReason = note;
        }

        const updated = await PurchaseOrder.findOneAndUpdate(
            { _id: order._id, status: "DISPUTED" },
            {
                $set: set,
                $push: {
                    events: makeEvent(
                        "DISPUTE_RESOLVED",
                        "ADMIN",
                        req.user._id,
                        {
                            fromStatus: "DISPUTED",
                            toStatus: decision.toStatus,
                            amount:
                                Number(paymentAmount) > 0
                                    ? Number(paymentAmount)
                                    : null,
                            note,
                        }
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

        const message = `Your Buy & Deliver dispute was resolved as ${decision.toStatus.toLowerCase()} by the Safar team.`;

        notifyPassenger(
            updated,
            { status: decision.toStatus, message: "Dispute resolved" },
            "Dispute Resolved",
            message,
            "PURCHASE_DISPUTE_RESOLVED"
        );

        await notifyAssignedPartner(
            updated,
            { status: decision.toStatus, message: "Dispute resolved" },
            "Dispute Resolved",
            message,
            "PURCHASE_DISPUTE_RESOLVED"
        );

        return res.json({ success: true, order: updated });
    } catch (error) {
        console.error("Resolve purchase dispute error:", error.message);
        return res.status(500).json({
            success: false,
            message: "Unable to resolve dispute",
        });
    }
};

// ---------------------------------------------------------------------------
// Fraud restriction — suspends the order partner's BUY_DELIVER service
// through the shared per-service machinery (an isolated suspension: the
// partner's other approved services are untouched).
// ---------------------------------------------------------------------------

const restrictPurchasePartner = async (req, res) => {
    try {
        const reason = String(req.body?.reason || "").trim();

        if (!reason || reason.length > 500) {
            return res.status(400).json({
                success: false,
                message: "A restriction reason is required",
            });
        }

        const order = await PurchaseOrder.findById(req.params.id);

        if (!order) {
            return res.status(404).json({
                success: false,
                message: "Purchase order not found",
            });
        }

        if (!order.driverId) {
            return res.status(409).json({
                success: false,
                message: "No partner is assigned to this order",
            });
        }

        const driver = await suspendDriverService(
            order.driverId,
            "BUY_DELIVER",
            reason
        );

        if (!driver) {
            return res.status(404).json({
                success: false,
                message: "Partner not found",
            });
        }

        await PurchaseOrder.findByIdAndUpdate(order._id, {
            $push: {
                events: makeEvent("PARTNER_RESTRICTED", "ADMIN", req.user._id, {
                    note: reason,
                }),
            },
        });

        await notifyAssignedPartner(
            order,
            { status: order.status, message: "Buy & Deliver service suspended" },
            "Service Suspended",
            "Your Buy & Deliver service has been suspended by the Safar team. Your other services are unaffected.",
            "PURCHASE_PARTNER_RESTRICTED"
        );

        return res.json({
            success: true,
            driverId: String(order.driverId),
            service: "BUY_DELIVER",
            status: "SUSPENDED",
        });
    } catch (error) {
        console.error("Restrict purchase partner error:", error.message);
        return res.status(500).json({
            success: false,
            message: "Unable to restrict partner",
        });
    }
};

// ---------------------------------------------------------------------------
// Platform settings — the Buy & Deliver fields of the GLOBAL singleton.
// (Deliberately separate from the commission settings update, whose
// full-payload contract must not be disturbed; same pattern as the
// rental settings endpoints in adminRentalController.)
// ---------------------------------------------------------------------------

const getGlobalSettingsDoc = () => CommissionSettings.findOne({ key: "GLOBAL" });

const buyDeliverSettingsView = (settings) => ({
    buyDeliverEnabled: settings?.buyDeliverEnabled !== false,
    buyDeliverMaxOrderValue: settings?.buyDeliverMaxOrderValue ?? null,
    buyDeliverRadiusKm: settings?.buyDeliverRadiusKm ?? 15,
    buyDeliverBlockedTerms: Array.isArray(settings?.buyDeliverBlockedTerms)
        ? settings.buyDeliverBlockedTerms
        : [],
});

const getBuyDeliverSettings = async (req, res) => {
    try {
        const settings = await getGlobalSettingsDoc();

        return res.json({
            success: true,
            settings: buyDeliverSettingsView(settings),
        });
    } catch {
        return res.status(500).json({
            success: false,
            message: "Unable to load Buy & Deliver settings",
        });
    }
};

const updateBuyDeliverSettings = async (req, res) => {
    try {
        const {
            buyDeliverEnabled,
            buyDeliverMaxOrderValue,
            buyDeliverRadiusKm,
            buyDeliverBlockedTerms,
        } = req.body || {};

        if (
            buyDeliverEnabled !== undefined &&
            typeof buyDeliverEnabled !== "boolean"
        ) {
            return res.status(400).json({
                success: false,
                message: "Invalid buyDeliverEnabled",
            });
        }

        if (
            buyDeliverMaxOrderValue !== undefined &&
            buyDeliverMaxOrderValue !== null &&
            (!Number.isSafeInteger(buyDeliverMaxOrderValue) ||
                buyDeliverMaxOrderValue < 1)
        ) {
            return res.status(400).json({
                success: false,
                message:
                    "buyDeliverMaxOrderValue must be a positive whole number of PKR, or null for no platform cap",
            });
        }

        if (
            buyDeliverRadiusKm !== undefined &&
            (!Number.isInteger(buyDeliverRadiusKm) ||
                buyDeliverRadiusKm < 1 ||
                buyDeliverRadiusKm > 100)
        ) {
            return res.status(400).json({
                success: false,
                message: "Invalid buyDeliverRadiusKm",
            });
        }

        let blockedTerms;

        if (buyDeliverBlockedTerms !== undefined) {
            if (
                !Array.isArray(buyDeliverBlockedTerms) ||
                buyDeliverBlockedTerms.length > 50 ||
                buyDeliverBlockedTerms.some(
                    (term) =>
                        typeof term !== "string" ||
                        !term.trim() ||
                        term.trim().length > 60
                )
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "buyDeliverBlockedTerms must be an array of up to 50 short terms (an empty list restores the built-in defaults)",
                });
            }

            blockedTerms = buyDeliverBlockedTerms.map((term) => term.trim());
        }

        let settings = await getGlobalSettingsDoc();

        if (!settings) {
            settings = new CommissionSettings({
                key: "GLOBAL",
                percentage: 0,
            });
        }

        if (buyDeliverEnabled !== undefined) {
            settings.buyDeliverEnabled = buyDeliverEnabled;
        }
        if (buyDeliverMaxOrderValue !== undefined) {
            settings.buyDeliverMaxOrderValue = buyDeliverMaxOrderValue;
        }
        if (buyDeliverRadiusKm !== undefined) {
            settings.buyDeliverRadiusKm = buyDeliverRadiusKm;
        }
        if (blockedTerms !== undefined) {
            settings.buyDeliverBlockedTerms = blockedTerms;
        }
        settings.updatedBy = req.user._id;

        await settings.save();

        return res.json({
            success: true,
            settings: buyDeliverSettingsView(settings),
        });
    } catch (error) {
        console.error("Update Buy & Deliver settings error:", error.message);
        return res.status(500).json({
            success: false,
            message: "Unable to update Buy & Deliver settings",
        });
    }
};

module.exports = {
    listPurchaseOrdersAdmin,
    getPurchaseOrderAdmin,
    listPurchaseConversationsAdmin,
    listPurchaseConversationMessagesAdmin,
    resolvePurchaseDispute,
    restrictPurchasePartner,
    getBuyDeliverSettings,
    updateBuyDeliverSettings,
};
