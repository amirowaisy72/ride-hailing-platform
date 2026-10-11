const DriverWallet = require("../models/DriverWallet");

async function ensureDriverWallet(driverId, session = null) {
    if (!driverId) {
        throw new Error("Driver ID is required");
    }

    try {
        await DriverWallet.updateOne(
            { driverId },
            {
                $setOnInsert: {
                    driverId,
                    balance: 0,
                    totalCommission: 0,
                    totalTopUps: 0,
                    currency: "PKR",
                },
            },
            {
                upsert: true,
                ...(session ? { session } : {}),
            }
        );
    } catch (error) {
        if (error.code !== 11000) {
            throw error;
        }
    }

    return DriverWallet.findOne({ driverId })
        .session(session)
        .lean();
}

module.exports = { ensureDriverWallet };