
const mongoose = require("mongoose");
const Driver = require("../models/Driver");
const DriverWallet = require("../models/DriverWallet");
const WalletTransaction = require("../models/WalletTransaction");
const {
    topUpDriverWallet,
} = require("../services/adminWalletTopUpService");

async function listDriverWallets(req, res) {
    try {
        const page = Number(req.query.page || 1);
        const limit = 10;
        const search = String(req.query.search || "").trim();

        if (
            !Number.isSafeInteger(page) ||
            page < 1 ||
            page > 100000 ||
            search.length > 100
        ) {
            return res.status(400).json({
                success: false,
                message: "Invalid search or page",
            });
        }

        const filter = {};

        if (search) {
            const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

            const User = require("../models/User");

            const users = await User.find({
                $or: [
                    { firstName: { $regex: escaped, $options: "i" } },
                    { lastName: { $regex: escaped, $options: "i" } },
                    { name: { $regex: escaped, $options: "i" } },
                    { email: { $regex: escaped, $options: "i" } },
                ],
            })
                .select("_id")
                .limit(100)
                .lean();

            filter.userId = { $in: users.map((u) => u._id) };
        }

        const [drivers, total] = await Promise.all([
            Driver.find(filter)
                .populate("userId", "firstName lastName name email")
                .sort({ createdAt: -1 })
                .skip((page - 1) * limit)
                .limit(limit)
                .select("userId verificationStatus isOnline rating ratingCount")
                .lean(),
            Driver.countDocuments(filter),
        ]);

        const wallets = await DriverWallet.find({
            driverId: { $in: drivers.map((d) => d._id) },
        })
            .select("driverId balance currency totalCommission totalTopUps")
            .lean();

        const walletByDriver = new Map(
            wallets.map((w) => [String(w.driverId), w])
        );

        const records = drivers.map((driver) => {
            const wallet = walletByDriver.get(String(driver._id));

            return {
                driverId: driver._id,
                name:
                    [
                        driver.userId?.firstName,
                        driver.userId?.lastName,
                    ].filter(Boolean).join(" ") ||
                    driver.userId?.name ||
                    "Driver",
                email: driver.userId?.email || "",
                verificationStatus: driver.verificationStatus,
                isOnline: driver.isOnline,
                wallet: {
                    balance: wallet?.balance ?? 0,
                    currency: "PKR",
                    totalCommission: wallet?.totalCommission ?? 0,
                    totalTopUps: wallet?.totalTopUps ?? 0,
                },
            };
        });

        return res.json({
            success: true,
            drivers: records,
            pagination: {
                page,
                total,
                pages: Math.ceil(total / limit),
            },
        });
    } catch (error) {
        console.error("Admin wallet list:", error.message);

        return res.status(500).json({
            success: false,
            message: "Unable to load driver wallets",
        });
    }
}

async function getDriverWalletDetails(req, res) {
    try {
        const { driverId } = req.params;

        if (!mongoose.isValidObjectId(driverId)) {
            return res.status(400).json({
                success: false,
                message: "Invalid driver ID",
            });
        }

        const driver = await Driver.findById(driverId)
            .populate("userId", "firstName lastName name email")
            .select("userId verificationStatus")
            .lean();

        if (!driver) {
            return res.status(404).json({
                success: false,
                message: "Driver not found",
            });
        }

        const [wallet, transactions] = await Promise.all([
            DriverWallet.findOne({ driverId }).lean(),
            WalletTransaction.find({ driverId })
                .sort({ createdAt: -1 })
                .limit(30)
                .select(
                    "type amount balanceBefore balanceAfter description rideId createdBy createdAt"
                )
                .lean(),
        ]);

        return res.json({
            success: true,
            driver: {
                driverId: driver._id,
                name:
                    [
                        driver.userId?.firstName,
                        driver.userId?.lastName,
                    ].filter(Boolean).join(" ") ||
                    driver.userId?.name ||
                    "Driver",
                email: driver.userId?.email || "",
                verificationStatus: driver.verificationStatus,
            },
            wallet: {
                balance: wallet?.balance ?? 0,
                totalTopUps: wallet?.totalTopUps ?? 0,
                totalCommission: wallet?.totalCommission ?? 0,
                currency: "PKR",
            },
            transactions,
        });
    } catch (error) {
        console.error("Admin wallet details:", error.message);

        return res.status(500).json({
            success: false,
            message: "Unable to load wallet details",
        });
    }
}

async function topUpWallet(req, res) {
    const {
        driverId,
        amount,
        idempotencyKey,
        description,
    } = req.body || {};

    if (!mongoose.isValidObjectId(driverId)) {
        return res.status(400).json({
            success: false,
            message: "Invalid driver",
        });
    }

    if (!Number.isSafeInteger(amount) || amount < 1) {
        return res.status(400).json({
            success: false,
            message: "Invalid amount",
        });
    }

    try {
        const result = await topUpDriverWallet({
            driverId,
            amount,
            idempotencyKey,
            description,
            adminUserId: req.user._id,
        });

        return res.status(result.alreadyProcessed ? 200 : 201).json({
            success: true,
            ...result,
        });
    } catch (error) {
        if (
            error.code === 11000 ||
            error.message === "Idempotency key already used"
        ) {
            return res.status(409).json({
                success: false,
                message: "Duplicate or conflicting top-up request",
            });
        }

        console.error("Admin wallet top-up:", error.message);

        return res.status(400).json({
            success: false,
            message: error.message,
        });
    }
}

module.exports = {
    listDriverWallets,
    getDriverWalletDetails,
    topUpWallet,
};
