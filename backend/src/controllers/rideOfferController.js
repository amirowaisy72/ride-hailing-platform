
const mongoose = require("mongoose");
const Ride = require("../models/Ride");
const Driver = require("../models/Driver");
const RideOffer = require("../models/RideOffer");
const Vehicle = require("../models/Vehicle");
const CommissionSettings = require("../models/CommissionSettings");
const DriverWallet = require("../models/DriverWallet");
const { publishEvent } = require("../services/socketService");
const { sendPushToUser } = require("../services/pushService");
const { paymentsConfigured } = require("../services/paymentsConfigService");

const OPEN = ["REQUESTED", "SEARCHING", "BIDDING"];
const OFFER_DURATION_MS = 5 * 60 * 1000;
const MIN_REBID_INTERVAL_MS = 15000;

function distanceKm(aLat, aLng, bLat, bLng) {
    const r = Math.PI / 180;
    const dLat = (bLat - aLat) * r;
    const dLng = (bLng - aLng) * r;

    const h =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(aLat * r) * Math.cos(bLat * r) *
        Math.sin(dLng / 2) ** 2;

    return 6371 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
}

async function submitOffer(req, res) {
    try {
        const { rideId } = req.params;
        const { price } = req.body || {};

        if (
            !mongoose.isValidObjectId(rideId) ||
            !Number.isSafeInteger(price) ||
            price < 1 ||
            price > 1000000
        ) {
            return res.status(400).json({
                success: false,
                message: "Invalid ride or offer price",
            });
        }

        const driver = await Driver.findOne({
            userId: req.user._id,
            verificationStatus: "APPROVED",
            isOnline: true,
            isAvailable: true,
            lastLocationUpdate: {
                $gte: new Date(Date.now() - 120000),
            },
        });

        if (!driver) {
            return res.status(403).json({
                success: false,
                message: "Approved online driver with fresh GPS required",
            });
        }

        const commissionSettings = await CommissionSettings.findOne({
            key: "GLOBAL",
        }).select("topUpRequired minimumWalletBalance").lean();

        // Auto Free Mode: no top-up enforcement until a payment
        // method is configured in the dashboard.
        const topUpEnforced =
            commissionSettings?.topUpRequired === true &&
            (await paymentsConfigured());

        if (topUpEnforced) {
            const wallet = await DriverWallet.findOne({
                driverId: driver._id,
            }).select("balance").lean();

            const requiredBalance = Math.max(
                1,
                commissionSettings.minimumWalletBalance || 0
            );

            if (!wallet || wallet.balance < requiredBalance) {
                return res.status(402).json({
                    success: false,
                    code: "DRIVER_WALLET_TOP_UP_REQUIRED",
                    message: "Please top up your wallet to use Safar. Platform commission will be deducted from your wallet after each completed ride.",
                });
            }
        }

        const ride = await Ride.findOne({
            _id: rideId,
            status: { $in: OPEN },
            driverId: null,
        });

        if (!ride) {
            return res.status(409).json({
                success: false,
                message: "Ride is no longer accepting offers",
            });
        }

        const vehicle = await Vehicle.exists({
            _id: driver.currentVehicleId,
            driverId: driver._id,
            vehicleType: ride.vehicleType,
            verificationStatus: "APPROVED",
            isActive: true,
        });

        if (!vehicle) {
            return res.status(403).json({
                success: false,
                message: "Approved matching vehicle required",
            });
        }

        const settings = await CommissionSettings.findOne({
            key: "GLOBAL",
        }).lean();

        if (
            settings?.topUpRequired === true &&
            (await paymentsConfigured(settings))
        ) {
            if (settings.isActive !== true) {
                return res.status(503).json({
                    success: false,
                    message: "Wallet configuration is unavailable",
                });
            }

            const wallet = await DriverWallet.findOne({
                driverId: driver._id,
            }).lean();

            const estimatedCommission = Math.round(
                (price * Math.round(settings.percentage * 100)) / 10000
            );

            const minimumBalance = Math.max(
                1,
                settings.minimumWalletBalance || 0,
                estimatedCommission
            );

            if (!wallet || wallet.balance < minimumBalance) {
                return res.status(403).json({
                    success: false,
                    message: `Insufficient wallet balance. Minimum PKR ${minimumBalance} required. Please top up your wallet.`,
                });
            }
        }

        const location = driver.currentLocation?.coordinates;
        const pickup = ride.pickup?.coordinates;

        if (
            !Array.isArray(location) ||
            !Array.isArray(pickup) ||
            location.length !== 2 ||
            pickup.length !== 2 ||
            !location.every(Number.isFinite) ||
            !pickup.every(Number.isFinite) ||
            (location[0] === 0 && location[1] === 0) ||
            distanceKm(
                location[1], location[0],
                pickup[1], pickup[0]
            ) > 15
        ) {
            return res.status(403).json({
                success: false,
                message: "Driver is outside matching radius",
            });
        }

        const now = new Date();
        const existing = await RideOffer.findOne({
            rideId: ride._id,
            driverId: driver._id,
        });

        let offer;
        let event = "ride:offer:new";

        if (existing) {
            if (existing.status === "ACCEPTED") {
                return res.status(409).json({
                    success: false,
                    message: "Offer was already accepted",
                });
            }

            const elapsed =
                now.getTime() -
                new Date(existing.updatedAt).getTime();

            if (elapsed < MIN_REBID_INTERVAL_MS) {
                return res.status(429).json({
                    success: false,
                    message: "Wait 15 seconds before updating your offer",
                });
            }

            offer = await RideOffer.findOneAndUpdate(
                {
                    _id: existing._id,
                    status: existing.status,
                    updatedAt: existing.updatedAt,
                },
                {
                    $set: {
                        price,
                        status: "PENDING",
                        expiresAt: new Date(
                            now.getTime() + OFFER_DURATION_MS
                        ),
                    },
                },
                {
                    returnDocument: "after",
                    runValidators: true,
                }
            );

            if (!offer) {
                return res.status(409).json({
                    success: false,
                    message: "Offer changed. Please retry.",
                });
            }

            event = "ride:offer:updated";
        } else {
            try {
                offer = await RideOffer.create({
                    rideId: ride._id,
                    driverId: driver._id,
                    price,
                    status: "PENDING",
                    expiresAt: new Date(
                        now.getTime() + OFFER_DURATION_MS
                    ),
                });
            } catch (error) {
                if (error.code === 11000) {
                    return res.status(409).json({
                        success: false,
                        message: "Offer already exists. Please retry.",
                    });
                }
                throw error;
            }
        }

        const populated = await RideOffer.findById(offer._id)
            .populate({
                path: "driverId",
                select: "rating ratingCount currentVehicleId userId",
                populate: {
                    path: "userId",
                    select: "firstName lastName",
                },
            });

        const payload = {
            rideId: String(ride._id),
            offerId: String(offer._id),
            driverId: populated.driverId,
            price: offer.price,
            status: offer.status,
            expiresAt: offer.expiresAt,
        };

        publishEvent(
            event,
            `passenger:${ride.passengerId}`,
            payload
        );

        void sendPushToUser(
            ride.passengerId,
            "New Driver Offer",
            `A driver offered PKR ${offer.price} for your ride.`,
            { type: "RIDE_OFFER", rideId: String(ride._id) }
        );

        // Keep existing listeners compatible with rebids.
        if (event === "ride:offer:updated") {
            publishEvent(
                "ride:offer:new",
                `passenger:${ride.passengerId}`,
                payload
            );
        }

        return res.status(existing ? 200 : 201).json({
            success: true,
            message: existing
                ? "Offer updated successfully"
                : "Offer submitted successfully",
            offer: populated,
        });
    } catch (error) {
        console.error("Submit offer:", error.message);

        return res.status(500).json({
            success: false,
            message: "Unable to submit offer",
        });
    }
}

async function getRideOffers(req, res) {
    try {
        const { rideId } = req.params;

        if (!mongoose.isValidObjectId(rideId)) {
            return res.status(400).json({
                success: false,
                message: "Invalid ride ID",
            });
        }

        const ride = await Ride.findOne({
            _id: rideId,
            passengerId: req.user._id,
        });

        if (!ride) {
            return res.status(404).json({
                success: false,
                message: "Ride not found",
            });
        }

        const offers = await RideOffer.find({
            rideId,
            status: "PENDING",
            expiresAt: { $gt: new Date() },
        })
            .populate({
                path: "driverId",
                select: "rating ratingCount currentVehicleId userId",
                populate: {
                    path: "userId",
                    select: "firstName lastName",
                },
            })
            .sort({ price: 1 });

        return res.json({
            success: true,
            count: offers.length,
            offers,
        });
    } catch (error) {
        console.error("Get ride offers:", error.message);

        return res.status(500).json({
            success: false,
            message: "Failed to fetch ride offers",
        });
    }
}

async function rejectOffer(req, res) {
    try {
        const { rideId, offerId } = req.params;

        if (
            !mongoose.isValidObjectId(rideId) ||
            !mongoose.isValidObjectId(offerId)
        ) {
            return res.status(400).json({
                success: false,
                message: "Invalid ride or offer",
            });
        }

        const ride = await Ride.findOne({
            _id: rideId,
            passengerId: req.user._id,
            status: { $in: OPEN },
            driverId: null,
        });

        if (!ride) {
            return res.status(409).json({
                success: false,
                message: "Ride is not accepting offer decisions",
            });
        }

        const offer = await RideOffer.findOneAndUpdate(
            {
                _id: offerId,
                rideId,
                status: "PENDING",
                expiresAt: { $gt: new Date() },
            },
            {
                $set: { status: "REJECTED" },
            },
            {
                returnDocument: "after",
            }
        );

        if (!offer) {
            return res.status(409).json({
                success: false,
                message: "Offer is unavailable or expired",
            });
        }

        const driver = await Driver.findById(
            offer.driverId
        ).select("userId");

        if (driver) {
            publishEvent(
                "ride:offer:rejected",
                `driver:${driver.userId}`,
                {
                    rideId: String(ride._id),
                    offerId: String(offer._id),
                }
            );
        }

        return res.json({
            success: true,
            message: "Offer rejected",
        });
    } catch (error) {
        console.error("Reject offer:", error.message);

        return res.status(500).json({
            success: false,
            message: "Failed to reject offer",
        });
    }
}

module.exports = {
    submitOffer,
    getRideOffers,
    rejectOffer,
};
