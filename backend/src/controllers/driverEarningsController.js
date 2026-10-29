const Driver = require("../models/Driver");
const Ride = require("../models/Ride");
const RideSettlement = require("../models/RideSettlement");
const ParcelOrder = require("../models/ParcelOrder");
const ParcelSettlement = require("../models/ParcelSettlement");
const PurchaseOrder = require("../models/PurchaseOrder");
const PurchaseSettlement = require("../models/PurchaseSettlement");

async function getMyEarnings(req, res) {
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

        const [summary] = await RideSettlement.aggregate([
            {
                $match: {
                    driverId: driver._id,
                    status: "SETTLED",
                },
            },
            {
                $group: {
                    _id: null,
                    completedTrips: { $sum: 1 },
                    totalFares: { $sum: "$fare" },
                    totalCommission: { $sum: "$commission" },
                    netEarnings: { $sum: "$driverEarnings" },
                },
            },
        ]);

        const [parcelSummary] = await ParcelSettlement.aggregate([
            {
                $match: {
                    driverId: driver._id,
                    status: "SETTLED",
                },
            },
            {
                $group: {
                    _id: null,
                    completedParcels: { $sum: 1 },
                    totalFares: { $sum: "$fare" },
                    totalCommission: { $sum: "$commission" },
                    netEarnings: { $sum: "$driverEarnings" },
                },
            },
        ]);

        const rideRecent = await RideSettlement.find({
            driverId: driver._id,
            status: "SETTLED",
        })
            .sort({ createdAt: -1 })
            .limit(20)
            .select(
                "rideId fare commission driverEarnings createdAt"
            )
            .lean();

        const parcelRecent = await ParcelSettlement.find({
            driverId: driver._id,
            status: "SETTLED",
        })
            .sort({ createdAt: -1 })
            .limit(20)
            .select(
                "parcelOrderId fare commission driverEarnings createdAt"
            )
            .lean();

        const recentTrips = [
            ...rideRecent.map((trip) => ({ ...trip, type: "RIDE" })),
            ...parcelRecent.map((trip) => ({ ...trip, type: "PARCEL" })),
        ]
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
            .slice(0, 20);

        // Daily breakdown for the last 7 Karachi-local days (today
        // included), merging settled rides and parcels. Day boundaries use
        // Asia/Karachi because fares are earned on local days.
        const DAY_MS = 24 * 60 * 60 * 1000;
        const dayKeyFormat = new Intl.DateTimeFormat("en-CA", {
            timeZone: "Asia/Karachi",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
        });
        const todayKey = dayKeyFormat.format(new Date());
        const rangeStart = new Date(
            new Date(`${todayKey}T00:00:00+05:00`).getTime() - 6 * DAY_MS
        );
        const dayPipeline = [
            {
                $match: {
                    driverId: driver._id,
                    status: "SETTLED",
                    createdAt: { $gte: rangeStart },
                },
            },
            {
                $group: {
                    _id: {
                        $dateToString: {
                            format: "%Y-%m-%d",
                            date: "$createdAt",
                            timezone: "Asia/Karachi",
                        },
                    },
                    earnings: { $sum: "$driverEarnings" },
                    trips: { $sum: 1 },
                },
            },
        ];
        const [rideDays, parcelDays] = await Promise.all([
            RideSettlement.aggregate(dayPipeline),
            ParcelSettlement.aggregate(dayPipeline),
        ]);
        const byDay = new Map();
        for (const row of [...rideDays, ...parcelDays]) {
            const entry = byDay.get(row._id) || { earnings: 0, trips: 0 };
            entry.earnings += row.earnings || 0;
            entry.trips += row.trips || 0;
            byDay.set(row._id, entry);
        }
        const days = [];
        for (let back = 6; back >= 0; back -= 1) {
            const date = new Date(rangeStart.getTime() + (6 - back) * DAY_MS);
            const key = dayKeyFormat.format(date);
            const entry = byDay.get(key) || { earnings: 0, trips: 0 };
            days.push({ date: key, earnings: entry.earnings, trips: entry.trips });
        }
        const todayEntry = byDay.get(todayKey) || { earnings: 0, trips: 0 };
        const daily = {
            today: {
                date: todayKey,
                earnings: todayEntry.earnings,
                trips: todayEntry.trips,
            },
            week: {
                earnings: days.reduce((sum, day) => sum + day.earnings, 0),
                trips: days.reduce((sum, day) => sum + day.trips, 0),
            },
            days,
        };

        const completedTrips = await Ride.countDocuments({
            driverId: driver._id,
            status: "TRIP_COMPLETED",
        });

        const completedParcels = await ParcelOrder.countDocuments({
            driverId: driver._id,
            status: "DELIVERED",
        });

        const rideSummary = summary || {
            completedTrips: 0,
            totalFares: 0,
            totalCommission: 0,
            netEarnings: 0,
        };

        const settledParcels = parcelSummary || {
            completedParcels: 0,
            totalFares: 0,
            totalCommission: 0,
            netEarnings: 0,
        };

        const settledSummary = {
            completedTrips:
                rideSummary.completedTrips +
                settledParcels.completedParcels,
            totalFares:
                rideSummary.totalFares + settledParcels.totalFares,
            totalCommission:
                rideSummary.totalCommission +
                settledParcels.totalCommission,
            netEarnings:
                rideSummary.netEarnings + settledParcels.netEarnings,
        };

        return res.json({
            success: true,
            currency: "PKR",
            summary: {
                ...settledSummary,
                completedTrips: completedTrips + completedParcels,
                settledTrips: settledSummary.completedTrips,
                unsettledTrips: Math.max(
                    0,
                    completedTrips +
                        completedParcels -
                        settledSummary.completedTrips
                ),
            },
            recentTrips,
            daily,
        });
    } catch (error) {
        console.error("Earnings error:", error.message);

        return res.status(500).json({
            success: false,
            message: "Unable to load earnings",
        });
    }
}

// Phase 4 — earnings split BY SERVICE (the endpoint Phase 3's driver
// dashboard deferred to). Every figure comes from real records:
//  - RIDE / PARCEL service earnings from their settlement collections;
//  - BUY_DELIVER service earnings from PurchaseSettlement (whose fare
//    is the delivery fee — the partner's only earnings from an order);
//  - the Buy & Deliver SHOPPING money is reported in its own block —
//    advanced (what the partner spent from their own pocket),
//    reimbursed (what the passenger has paid back) and unpaid. It is
//    reimbursement, NOT earnings, and is never added to any earnings
//    total.
async function getMyEarningsByService(req, res) {
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

        const settledGroup = (extra = {}) => [
            {
                $match: {
                    driverId: driver._id,
                    status: "SETTLED",
                    ...extra,
                },
            },
            {
                $group: {
                    _id: null,
                    completed: { $sum: 1 },
                    totalFares: { $sum: "$fare" },
                    totalCommission: { $sum: "$commission" },
                    netEarnings: { $sum: "$driverEarnings" },
                },
            },
        ];

        const [rideAgg, parcelAgg, purchaseAgg, shoppingAgg] =
            await Promise.all([
                RideSettlement.aggregate(settledGroup()),
                ParcelSettlement.aggregate(settledGroup()),
                PurchaseSettlement.aggregate(settledGroup()),
                PurchaseOrder.aggregate([
                    {
                        $match: {
                            driverId: driver._id,
                            actualCost: { $type: "number" },
                            status: {
                                $in: [
                                    "PURCHASED",
                                    "OUT_FOR_DELIVERY",
                                    "ARRIVED",
                                    "DELIVERED",
                                    "COMPLETED",
                                    "DISPUTED",
                                ],
                            },
                        },
                    },
                    {
                        $group: {
                            _id: null,
                            orders: { $sum: 1 },
                            advanced: { $sum: "$actualCost" },
                            reimbursed: { $sum: "$reimbursementReceived" },
                            unpaid: { $sum: "$unpaidAmount" },
                        },
                    },
                ]),
            ]);

        const zeroService = {
            completed: 0,
            totalFares: 0,
            totalCommission: 0,
            netEarnings: 0,
        };

        const ride = rideAgg[0] || zeroService;
        const parcel = parcelAgg[0] || zeroService;
        const buyDeliverService = purchaseAgg[0] || zeroService;
        const shopping = shoppingAgg[0] || {
            orders: 0,
            advanced: 0,
            reimbursed: 0,
            unpaid: 0,
        };

        const services = {
            RIDE: {
                completedOrders: ride.completed,
                totalFares: ride.totalFares,
                totalCommission: ride.totalCommission,
                netEarnings: ride.netEarnings,
            },
            PARCEL: {
                completedOrders: parcel.completed,
                totalFares: parcel.totalFares,
                totalCommission: parcel.totalCommission,
                netEarnings: parcel.netEarnings,
            },
            BUY_DELIVER: {
                completedOrders: buyDeliverService.completed,
                totalDeliveryFees: buyDeliverService.totalFares,
                totalCommission: buyDeliverService.totalCommission,
                netEarnings: buyDeliverService.netEarnings,
                // Reimbursement ledger — deliberately OUTSIDE the
                // earnings fields above and outside `totals`.
                shopping: {
                    orders: shopping.orders,
                    advanced: shopping.advanced,
                    reimbursed: shopping.reimbursed,
                    unpaid: shopping.unpaid,
                },
            },
        };

        return res.json({
            success: true,
            currency: "PKR",
            services,
            totals: {
                // Service earnings only. Shopping reimbursements are
                // pass-through money and are NEVER totalled as income.
                netEarnings:
                    ride.netEarnings +
                    parcel.netEarnings +
                    buyDeliverService.netEarnings,
                totalCommission:
                    ride.totalCommission +
                    parcel.totalCommission +
                    buyDeliverService.totalCommission,
            },
        });
    } catch (error) {
        console.error("Earnings by service error:", error.message);

        return res.status(500).json({
            success: false,
            message: "Unable to load earnings by service",
        });
    }
}

module.exports = { getMyEarnings, getMyEarningsByService };