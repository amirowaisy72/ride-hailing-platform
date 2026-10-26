
const Driver = require("../models/Driver");
const DriverWallet = require("../models/DriverWallet");
const WalletTransaction = require("../models/WalletTransaction");
const CommissionSettings = require("../models/CommissionSettings");
const { ensureDriverWallet } = require("../services/driverWalletService");

async function getMyWallet(req, res) {
    try {
        const driver = await Driver.findOne({
            userId: req.user._id,
        }).select("_id");

        if (!driver) {
            return res.status(404).json({
                success: false,
                message: "Driver profile not found",
            });
        }

        const wallet = await ensureDriverWallet(driver._id);

        const settings = await CommissionSettings.findOne({
            key: "GLOBAL",
        }).lean();

        const topUpRequired = settings?.topUpRequired === true;

        const transactions = await WalletTransaction.find({
            driverId: driver._id,
        })
            .sort({ createdAt: -1 })
            .limit(20)
            .select(
                "type amount balanceBefore balanceAfter description rideId createdAt"
            )
            .lean();

        return res.json({
            success: true,
            topUpRequired,
            minimumWalletBalance: settings?.minimumWalletBalance ?? 0,
            walletMessage: topUpRequired
                ? "Wallet top-up is required to submit ride offers."
                : "Safar is currently free for drivers. No top-up or ride commission is required. These charges may apply in the future.",
            wallet: wallet
                ? {
                    balance: wallet.balance,
                    currency: wallet.currency,
                    totalCommission: wallet.totalCommission,
                    totalTopUps: wallet.totalTopUps,
                }
                : {
                    balance: 0,
                    currency: "PKR",
                    totalCommission: 0,
                    totalTopUps: 0,
                },
            transactions,
        });
    } catch (error) {
        console.error("Wallet retrieval error:", error.message);

        return res.status(500).json({
            success: false,
            message: "Unable to load wallet",
        });
    }
}

module.exports = { getMyWallet };
