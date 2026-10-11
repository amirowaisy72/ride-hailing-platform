const express = require("express");
const { protect } = require("../middleware/authMiddleware");
const {
    getAccount,
    updateAccount,
} = require("../controllers/accountController");

const router = express.Router();

router.get("/me", protect, getAccount);
router.patch("/me", protect, updateAccount);

module.exports = router;