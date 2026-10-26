const express = require("express");
const { handleJazzCashCallback } = require("../controllers/jazzCashCallbackController");

const router = express.Router();

router.post(
    "/jazzcash/callback",
    express.urlencoded({ extended: false, limit: "20kb" }),
    handleJazzCashCallback
);

module.exports = router;