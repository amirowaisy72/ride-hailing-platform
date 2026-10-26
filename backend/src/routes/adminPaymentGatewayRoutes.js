const express = require("express");
const { protect } = require("../middleware/authMiddleware");
const { authorize } = require("../middleware/roleMiddleware");

const {
    listPaymentGateways,
    savePaymentGateway,
} = require("../controllers/adminPaymentGatewayController");

const router = express.Router();

const {
    listPendingBankTransfers,
    verifyBankTransfer,
} = require("../controllers/adminPaymentOrderController");

router.use(protect, authorize("ADMIN"));

router.get("/", listPaymentGateways);
router.get("/bank-transfers/pending", listPendingBankTransfers);
router.post("/bank-transfers/:orderId/verify", verifyBankTransfer);
router.put("/:provider", (req, res, next) => {
    req.body = { ...req.body, provider: req.params.provider };
    next();
}, savePaymentGateway);

module.exports = router;