
const mongoose = require("mongoose");

const driverWalletSchema = new mongoose.Schema(
    {
        driverId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Driver",
            required: true,
            unique: true,
            index: true,
        },
        balance: {
            type: Number,
            default: 0,
            min: 0,
        },
        currency: {
            type: String,
            default: "PKR",
            immutable: true,
        },
        totalCommission: {
            type: Number,
            default: 0,
            min: 0,
        },
        totalTopUps: {
            type: Number,
            default: 0,
            min: 0,
        },
    },
    { timestamps: true }
);

module.exports = mongoose.model("DriverWallet", driverWalletSchema);
