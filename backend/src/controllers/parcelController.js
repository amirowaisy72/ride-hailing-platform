const ParcelOrder = require("../models/ParcelOrder");
const { publishEvent } = require("../services/socketService");
const { sendPushToUser } = require("../services/pushService");
const ParcelOffer = require("../models/ParcelOffer");
const Driver = require("../models/Driver");
const Vehicle = require("../models/Vehicle");
const crypto = require("node:crypto");
const CommissionSettings = require("../models/CommissionSettings");
const DriverWallet = require("../models/DriverWallet");
const { paymentsConfigured } = require("../services/paymentsConfigService");

const hashParcelOtp = (otp) => crypto.createHash("sha256").update(String(otp)).digest("hex");

const verifyParcelOtp = async (order, stage, otp) => {
    const field = stage === "PICKUP" ? "pickupOtpAttempts" : "deliveryOtpAttempts";
    const hashField = stage === "PICKUP" ? "pickupOtpHash" : "deliveryOtpHash";

    const result = await ParcelOrder.findOneAndUpdate(
        {
            _id: order._id,
            driverId: order.driverId,
            status: stage === "PICKUP"
                ? "ARRIVED_AT_PICKUP"
                : "OUT_FOR_DELIVERY",
            [field]: { $not: { $gte: 5 } },
            [hashField]: { $type: "string" },
        },
        { $inc: { [field]: 1 } },
        { new: true }
    ).select(`+${hashField}`);

    if (!result) return false;

    return typeof otp === "string" &&
        /^\d{6}$/.test(otp) &&
        result[hashField] === hashParcelOtp(otp);
};

const createParcelOtp = () =>
    String(crypto.randomInt(100000, 1000000));
const { isLocationSupported } = require("../services/serviceAreaService");

const validPoint = (p) =>
    p &&
    Number.isFinite(p.latitude) &&
    Number.isFinite(p.longitude) &&
    Math.abs(p.latitude) <= 90 &&
    Math.abs(p.longitude) <= 180;

const createParcel = async (req, res) => {
    try {
        const {
            serviceType, pickup, destination, sender, receiver,
            parcel, vehicleType, requestedPrice,
            paymentBy = "SENDER", instructions = "",
        } = req.body || {};

        if (
            !["SEND_PARCEL", "SHOP_PICKUP"].includes(serviceType) ||
            !validPoint(pickup) ||
            !validPoint(destination) ||
            !sender?.name?.trim() || !sender?.phone?.trim() ||
            !receiver?.name?.trim() || !receiver?.phone?.trim() ||
            !["DOCUMENTS", "FOOD", "CLOTHES", "ELECTRONICS", "OTHER"].includes(parcel?.category) ||
            !Number.isFinite(parcel?.weightKg) ||
            parcel.weightKg <= 0 ||
            !Number.isInteger(parcel?.quantity ?? 1) ||
            (parcel?.quantity ?? 1) < 1 ||
            !["BIKE", "RICKSHAW", "CAR_NON_AC", "CAR_AC"].includes(vehicleType) ||
            !Number.isFinite(requestedPrice) ||
            requestedPrice < 1 ||
            !["SENDER", "RECEIVER"].includes(paymentBy) ||
            typeof instructions !== "string" ||
            instructions.length > 500
        ) {
            return res.status(400).json({
                success: false,
                message: "Invalid parcel booking details",
            });
        }

        const [pickupArea, destinationArea] = await Promise.all([
            isLocationSupported(pickup.latitude, pickup.longitude),
            isLocationSupported(destination.latitude, destination.longitude),
        ]);

        if (!pickupArea.supported || !destinationArea.supported) {
            return res.status(400).json({
                success: false,
                message: "Parcel locations are outside the service area",
            });
        }

        const order = await ParcelOrder.create({
            customerId: req.user._id,
            serviceType,
            pickup: {
                type: "Point",
                coordinates: [pickup.longitude, pickup.latitude],
                address: pickup.address || "",
            },
            destination: {
                type: "Point",
                coordinates: [destination.longitude, destination.latitude],
                address: destination.address || "",
            },
            sender,
            receiver,
            parcel,
            vehicleType,
            requestedPrice,
            paymentBy,
            instructions,
        });

        void (async () => {
            try {
                const drivers = await Driver.find({
                    verificationStatus: "APPROVED",
                    isOnline: true,
                    isAvailable: true,
                    currentLocation: {
                        $near: {
                            $geometry: {
                                type: "Point",
                                coordinates: [pickup.longitude, pickup.latitude],
                            },
                            $maxDistance: 15000,
                        },
                    },
                }).select("userId currentVehicleId").limit(100).lean();

                for (const driver of drivers) {
                    const eligible = await Vehicle.exists({
                        _id: driver.currentVehicleId,
                        driverId: driver._id,
                        vehicleType,
                        verificationStatus: "APPROVED",
                        isActive: true,
                    });

                    if (eligible) {
                        await sendPushToUser(
                            driver.userId,
                            "New Parcel Request",
                            "A parcel delivery is available nearby.",
                            { type: "PARCEL_REQUEST", parcelId: String(order._id) }
                        );
                    }
                }
            } catch (error) {
                console.error("Parcel push error:", error.message);
            }
        })();

        return res.status(201).json({ success: true, order });
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: "Unable to create parcel booking",
        });
    }
};

const getMyParcels = async (req, res) => {
    try {
        const orders = await ParcelOrder.find({
            customerId: req.user._id,
        }).sort({ createdAt: -1 }).limit(50).lean();

        return res.json({ success: true, orders });
    } catch {
        return res.status(500).json({
            success: false,
            message: "Unable to load parcels",
        });
    }
};

const getParcelDetails = async (req, res) => {
    try {
        const order = await ParcelOrder.findOne({
            _id: req.params.id,
            customerId: req.user._id,
        }).lean();

        if (!order) {
            return res.status(404).json({
                success: false,
                message: "Parcel not found",
            });
        }

        return res.json({ success: true, order });
    } catch {
        return res.status(400).json({
            success: false,
            message: "Invalid parcel ID",
        });
    }
};

const cancelParcel = async (req, res) => {
    try {
        const order = await ParcelOrder.findOneAndUpdate(
            {
                _id: req.params.id,
                customerId: req.user._id,
                status: "REQUESTED",
            },
            { $set: { status: "CANCELLED" } },
            { new: true, runValidators: true }
        );

        if (!order) {
            return res.status(409).json({
                success: false,
                message: "Parcel cannot be cancelled at this stage",
            });
        }

        return res.json({ success: true, order });
    } catch {
        return res.status(400).json({
            success: false,
            message: "Invalid parcel ID",
        });
    }
};

const getAvailableParcels = async (req, res) => {
    try {
        const orders = await ParcelOrder.find({
            status: "REQUESTED",
            driverId: null,
        })
            .select("serviceType status pickup destination parcel.category parcel.weightKg parcel.quantity vehicleType requestedPrice createdAt")
            .sort({ createdAt: -1 })
            .limit(50)
            .lean();

        return res.json({ success: true, orders });
    } catch {
        return res.status(500).json({
            success: false,
            message: "Unable to load parcel requests",
        });
    }
};

const submitParcelOffer = async (req, res) => {
    try {
        const driver = await Driver.findOne({ userId: req.user._id });
        if (!driver) {
            return res.status(403).json({
                success: false,
                message: "Driver profile not found",
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
                    message: "Please top up your wallet to submit parcel offers. Platform commission will be deducted from your wallet after each completed service.",
                });
            }
        }

        const price = Number(req.body?.price);
        if (!Number.isSafeInteger(price) || price < 1) {
            return res.status(400).json({
                success: false,
                message: "Invalid offer price",
            });
        }

        const order = await ParcelOrder.findOne({
            _id: req.params.id,
            status: "REQUESTED",
            driverId: null,
        });

        if (!order) {
            return res.status(409).json({
                success: false,
                message: "Parcel request unavailable",
            });
        }

        const offer = await ParcelOffer.findOneAndUpdate(
            {
                parcelId: order._id,
                driverId: driver._id,
                status: "PENDING",
            },
            {
                $set: {
                    price,
                    expiresAt: new Date(Date.now() + 60000),
                },
            },
            { new: true, upsert: false }
        );

        if (!offer) {
            const created = await ParcelOffer.create({
                parcelId: order._id,
                driverId: driver._id,
                price,
                expiresAt: new Date(Date.now() + 60000),
            });

            void sendPushToUser(
                order.customerId,
                "New Parcel Offer",
                `Driver offered PKR ${created.price} for your parcel.`,
                { type: "PARCEL_OFFER", parcelId: String(order._id) }
            );

            publishEvent("parcel:offer:new", `passenger:${order.customerId}`, {
                parcelId: String(order._id),
                offerId: String(created._id),
                price: created.price,
                message: "New driver offer received",
            });

            return res.status(201).json({
                success: true,
                offer: created,
            });
        }

        void sendPushToUser(
            order.customerId,
            "Parcel Offer Updated",
            `Driver updated offer to PKR ${offer.price}.`,
            { type: "PARCEL_OFFER", parcelId: String(order._id) }
        );

        publishEvent("parcel:offer:new", `passenger:${order.customerId}`, {
            parcelId: String(order._id),
            offerId: String(offer._id),
            price: offer.price,
            message: "Driver updated their offer",
        });

        return res.json({ success: true, offer });
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: "Unable to submit parcel offer",
        });
    }
};

const getParcelOffers = async (req, res) => {
    try {
        const order = await ParcelOrder.findOne({
            _id: req.params.id,
            customerId: req.user._id,
        }).select("_id status").lean();

        if (!order) {
            return res.status(404).json({
                success: false,
                message: "Parcel not found",
            });
        }

        const offers = await ParcelOffer.find({
            parcelId: order._id,
            status: "PENDING",
            expiresAt: { $gt: new Date() },
        })
            .select("driverId price status expiresAt createdAt")
            .sort({ price: 1 })
            .lean();

        return res.json({ success: true, offers });
    } catch {
        return res.status(400).json({
            success: false,
            message: "Unable to load parcel offers",
        });
    }
};

const acceptParcelOffer = async (req, res) => {
    try {
        const offer = await ParcelOffer.findOne({
            _id: req.params.offerId,
            parcelId: req.params.id,
            status: "PENDING",
            expiresAt: { $gt: new Date() },
        });

        if (!offer) {
            return res.status(409).json({
                success: false,
                message: "Offer unavailable or expired",
            });
        }

        const pickupOtp = createParcelOtp();
        const deliveryOtp = createParcelOtp();

        const order = await ParcelOrder.findOneAndUpdate(
            {
                _id: req.params.id,
                customerId: req.user._id,
                status: "REQUESTED",
                driverId: null,
            },
            {
                $set: {
                    driverId: offer.driverId,
                    acceptedOfferId: offer._id,
                    finalPrice: offer.price,
                    assignedAt: new Date(),
                    status: "DRIVER_ASSIGNED",
                    pickupOtpHash: hashParcelOtp(pickupOtp),
                    deliveryOtpHash: hashParcelOtp(deliveryOtp),
                },
            },
            { new: true, runValidators: true }
        );

        if (!order) {
            return res.status(409).json({
                success: false,
                message: "Parcel already assigned or unavailable",
            });
        }

        await ParcelOffer.updateOne(
            { _id: offer._id },
            { $set: { status: "ACCEPTED" } }
        );

        await ParcelOffer.updateMany(
            {
                parcelId: order._id,
                _id: { $ne: offer._id },
                status: "PENDING",
            },
            { $set: { status: "REJECTED" } }
        );

        const assignedDriver = await Driver.findById(order.driverId)
            .select("userId")
            .lean();

        if (assignedDriver?.userId) {
            void sendPushToUser(
                assignedDriver.userId,
                "Parcel Offer Accepted",
                "Your parcel offer was accepted.",
                { type: "PARCEL_ASSIGNED", parcelId: String(order._id) }
            );

            publishEvent(
                "parcel:assigned",
                `driver:${assignedDriver.userId}`,
                {
                    parcelId: String(order._id),
                    status: "DRIVER_ASSIGNED",
                    message: "Your parcel offer was accepted",
                }
            );
        }

        void sendPushToUser(
            order.customerId,
            "Driver Assigned",
            "A driver has been assigned to your parcel.",
            { type: "PARCEL_ASSIGNED", parcelId: String(order._id) }
        );

        publishEvent(
            "parcel:status:updated",
            `passenger:${order.customerId}`,
            {
                parcelId: String(order._id),
                status: "DRIVER_ASSIGNED",
                message: "Driver assigned to your parcel",
            }
        );

        return res.json({
            success: true,
            order,
        });
    } catch {
        return res.status(400).json({
            success: false,
            message: "Unable to accept parcel offer",
        });
    }
};

const getDriverParcels = async (req, res) => {
    try {
        const driver = await Driver.findOne({
            userId: req.user._id,
        }).select("_id");

        if (!driver) {
            return res.status(403).json({
                success: false,
                message: "Driver profile not found",
            });
        }

        const orders = await ParcelOrder.find({
            driverId: driver._id,
            status: {
                $in: [
                    "DRIVER_ASSIGNED",
                    "DRIVER_EN_ROUTE",
                    "ARRIVED_AT_PICKUP",
                    "PICKED_UP",
                    "OUT_FOR_DELIVERY",
                ],
            },
        })
            .sort({ assignedAt: -1 })
            .limit(20)
            .lean();

        return res.json({ success: true, orders });
    } catch {
        return res.status(500).json({
            success: false,
            message: "Unable to load assigned parcels",
        });
    }
};

const updateParcelStatus = async (req, res) => {
    try {
        const driver = await Driver.findOne({
            userId: req.user._id,
        }).select("_id");

        if (!driver) {
            return res.status(403).json({
                success: false,
                message: "Driver profile not found",
            });
        }

        const transitions = {
            DRIVER_ASSIGNED: "DRIVER_EN_ROUTE",
            DRIVER_EN_ROUTE: "ARRIVED_AT_PICKUP",
            ARRIVED_AT_PICKUP: "PICKED_UP",
            PICKED_UP: "OUT_FOR_DELIVERY",
            OUT_FOR_DELIVERY: "DELIVERED",
        };

        const order = await ParcelOrder.findOne({
            _id: req.params.id,
            driverId: driver._id,
        });

        if (!order || !transitions[order.status]) {
            return res.status(409).json({
                success: false,
                message: "Parcel status cannot be updated",
            });
        }

        const nextStatus = transitions[order.status];
        const now = new Date();

        if (["PICKED_UP", "DELIVERED"].includes(nextStatus)) {
            const otp = req.body?.otp;

            if (!/^\d{6}$/.test(String(otp || ""))) {
                return res.status(400).json({
                    success: false,
                    message: "Enter the 6-digit confirmation code",
                });
            }

            const stage = nextStatus === "PICKED_UP"
                ? "PICKUP"
                : "DELIVERY";

            const verified = await verifyParcelOtp(
                order,
                stage,
                String(otp)
            );

            if (!verified) {
                return res.status(403).json({
                    success: false,
                    message: "Invalid OTP or maximum 5 attempts reached. Request a new OTP.",
                });
            }
        }

        const update = { status: nextStatus };

        if (nextStatus === "PICKED_UP") {
            update.pickupOtpVerifiedAt = now;
            update.pickupOtpHash = null;
        }

        if (nextStatus === "DELIVERED") {
            update.deliveryOtpVerifiedAt = now;
            update.deliveryOtpHash = null;
            // Commission settlement picks the parcel up from here
            // (services/parcelSettlementService).
            update.settlementStatus = "PENDING";
        }

        if (nextStatus === "PICKED_UP") update.pickedUpAt = now;
        if (nextStatus === "DELIVERED") update.deliveredAt = now;

        const updated = await ParcelOrder.findOneAndUpdate(
            {
                _id: order._id,
                driverId: driver._id,
                status: order.status,
            },
            { $set: update },
            { new: true, runValidators: true }
        );

        if (!updated) {
            return res.status(409).json({
                success: false,
                message: "Parcel status changed. Please refresh.",
            });
        }

        publishEvent(
            "parcel:status:updated",
            `passenger:${order.customerId}`,
            {
                parcelId: String(order._id),
                status: nextStatus,
                message: `Parcel status: ${nextStatus.replaceAll("_", " ")}`,
            }
        );

        void sendPushToUser(
            order.customerId,
            "Parcel Update",
            `Parcel status: ${nextStatus.replaceAll("_", " ")}`,
            {
                type: nextStatus,
                parcelId: String(order._id),
            }
        );

        return res.json({ success: true, order: updated });
    } catch {
        return res.status(400).json({
            success: false,
            message: "Unable to update parcel status",
        });
    }
};

const regenerateParcelOtp = async (req, res) => {
    try {
        const { stage } = req.body || {};

        if (!["PICKUP", "DELIVERY"].includes(stage)) {
            return res.status(400).json({
                success: false,
                message: "Invalid verification stage",
            });
        }

        const allowedStatuses = stage === "PICKUP"
            ? ["DRIVER_ASSIGNED", "DRIVER_EN_ROUTE", "ARRIVED_AT_PICKUP"]
            : ["PICKED_UP", "OUT_FOR_DELIVERY"];

        const otp = createParcelOtp();
        const field = stage === "PICKUP"
            ? "pickupOtpHash"
            : "deliveryOtpHash";

        const order = await ParcelOrder.findOneAndUpdate(
            {
                _id: req.params.id,
                customerId: req.user._id,
                status: { $in: allowedStatuses },
            },
            {
                $set: {
                    [field]: hashParcelOtp(otp),
                    [stage === "PICKUP"
                        ? "pickupOtpAttempts"
                        : "deliveryOtpAttempts"]: 0,
                },
            },
            { new: true }
        ).select("_id status");

        if (!order) {
            return res.status(409).json({
                success: false,
                message: "OTP unavailable at this delivery stage",
            });
        }

        return res.json({ success: true, stage, otp });
    } catch {
        return res.status(400).json({
            success: false,
            message: "Unable to generate OTP",
        });
    }
};

const getDriverParcelDetails = async (req, res) => {
    try {
        const driver = await Driver.findOne({
            userId: req.user._id,
        }).select("_id");

        if (!driver) {
            return res.status(403).json({
                success: false,
                message: "Driver profile not found",
            });
        }

        const order = await ParcelOrder.findOne({
            _id: req.params.id,
            driverId: driver._id,
        }).lean();

        if (!order) {
            return res.status(404).json({
                success: false,
                message: "Assigned parcel not found",
            });
        }

        return res.json({ success: true, order });
    } catch {
        return res.status(400).json({
            success: false,
            message: "Unable to load parcel details",
        });
    }
};

module.exports = {
    getDriverParcelDetails,
    regenerateParcelOtp,
    updateParcelStatus,
    getDriverParcels,
    acceptParcelOffer,
    getParcelOffers,
    submitParcelOffer,
    createParcel,
    getMyParcels,
    getParcelDetails,
    cancelParcel,
    getAvailableParcels,
};