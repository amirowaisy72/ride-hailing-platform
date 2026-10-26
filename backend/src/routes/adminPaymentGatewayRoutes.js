const express = require("express");
const { protect } = require("../middleware/authMiddleware");
const { authorize } = require("../middleware/roleMiddleware");

const {
    listPaymentGateways,
    savePaymentGateway,
    enablePaymentGateway,
    disablePaymentGateway,
} = require("../controllers/adminPaymentGatewayController");

const router = express.Router();

const {
    listPendingBankTransfers,
    verifyBankTransfer,
    refundPaymentOrder,
} = require("../controllers/adminPaymentOrderController");

router.use(protect, authorize("ADMIN"));

router.get("/", listPaymentGateways);
router.get("/bank-transfers/pending", listPendingBankTransfers);
router.post("/bank-transfers/:orderId/verify", verifyBankTransfer);
router.post("/orders/:orderId/refund", refundPaymentOrder);
router.put("/:provider", (req, res, next) => {
    req.body = { ...req.body, provider: req.params.provider };
    next();
}, savePaymentGateway);
router.post("/:provider/:environment/enable", enablePaymentGateway);
router.post("/:provider/:environment/disable", disablePaymentGateway);

module.exports = router;