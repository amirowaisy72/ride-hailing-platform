const express = require("express");
const { protect } = require("../middleware/authMiddleware");

const {
    listDriverWallets,
    getDriverWalletDetails,
    topUpWallet,
} = require("../controllers/adminWalletController");

const router = express.Router();

router.use(protect);

router.use((req, res, next) => {
    if (req.user?.role !== "ADMIN") {
        return res.status(403).json({
            success: false,
            message: "Admin access required",
        });
    }

    next();
});

router.get("/", listDriverWallets);
router.get("/:driverId", getDriverWalletDetails);
router.post("/top-up", topUpWallet);

module.exports = router;