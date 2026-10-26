const express = require("express");
const { handleJazzCashCallback } = require("../controllers/jazzCashCallbackController");
const { easyPaisaCallback } = require("../controllers/easyPaisaCallbackController");
const { ublCallback } = require("../controllers/ublCallbackController");

const router = express.Router();

router.post(
    "/jazzcash/callback",
    express.urlencoded({ extended: false, limit: "20kb" }),
    handleJazzCashCallback
);

router.post(
    "/easypaisa/callback",
    express.urlencoded({ extended: false, limit: "20kb" }),
    easyPaisaCallback
);

router.post(
    "/ubl/callback",
    express.urlencoded({ extended: false, limit: "20kb" }),
    ublCallback
);

module.exports = router;
