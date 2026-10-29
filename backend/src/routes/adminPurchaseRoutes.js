const express = require("express");
const { protect } = require("../middleware/authMiddleware");
const { authorize } = require("../middleware/roleMiddleware");
const {
    listPurchaseOrdersAdmin,
    getPurchaseOrderAdmin,
    listPurchaseConversationsAdmin,
    listPurchaseConversationMessagesAdmin,
    resolvePurchaseDispute,
    restrictPurchasePartner,
    getBuyDeliverSettings,
    updateBuyDeliverSettings,
} = require("../controllers/adminPurchaseController");

const router = express.Router();

router.use(protect, authorize("ADMIN"));

// Phase 7 — Buy & Deliver admin (orders, disputes, settings).
// Per-service partner approvals/suspensions stay under
// /api/v1/admin/drivers (Phase 2); the fraud restriction here is the
// order-scoped shortcut onto that same machinery.

// Platform configuration (feature switch, spending caps, blocked terms)
router.get("/settings", getBuyDeliverSettings);
router.patch("/settings", updateBuyDeliverSettings);

// Order search + detail (participants, budgets vs actuals, receipts,
// full events[] audit)
router.get("/orders", listPurchaseOrdersAdmin);
router.get("/orders/:id", getPurchaseOrderAdmin);

// Dispute evidence: the order's chat threads, losing bidders included
router.get("/orders/:id/conversations", listPurchaseConversationsAdmin);
router.get(
    "/orders/:id/conversations/:conversationId/messages",
    listPurchaseConversationMessagesAdmin
);

// Dispute resolution + fraud restriction
router.post("/orders/:id/resolve-dispute", resolvePurchaseDispute);
router.post("/orders/:id/restrict-partner", restrictPurchasePartner);

module.exports = router;
