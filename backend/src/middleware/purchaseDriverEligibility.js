const Driver = require("../models/Driver");
const PurchaseOrder = require("../models/PurchaseOrder");
const CommissionSettings = require("../models/CommissionSettings");
const eligibilityService = require("../services/eligibilityService");
const { checkAmountWithinCaps } = require("../services/purchaseOrderService");

// Phase 4 — Buy & Deliver partner gate, mirroring
// middleware/parcelDriverEligibility but driven by the Phase 2
// eligibility service instead of the legacy global status alone:
//
//   * driver profile exists, is online and available;
//   * canReceiveBuyDeliverRequests(driver) — the single source of
//     truth, which (per the Amir correction, 2026-10-29) requires the
//     FULL verification standard for Buy & Deliver: per-service
//     APPROVED status + enabled + approved/unexpired licence and
//     vehicle-registration documents + an approved active vehicle.
//     There is NO transport-mode bypass anywhere in this path;
//   * fresh GPS (<= 120 s), same as parcels;
//   * when an order id is present: the order is still in BIDDING, the
//     driver is within the configured radius of the DELIVERY location
//     (matching never uses a store/pickup pin — none exists), and the
//     order's estimated budget fits the partner's purchaseLimit and the
//     admin global cap.
//
// Attaches req.purchaseDriver (Driver doc), req.purchaseContext (the
// loaded eligibility context) and req.purchaseSettings.

function distanceKm(lat1, lon1, lat2, lon2) {
    const rad = Math.PI / 180;
    const dLat = (lat2 - lat1) * rad;
    const dLon = (lon2 - lon1) * rad;

    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1 * rad) *
        Math.cos(lat2 * rad) *
        Math.sin(dLon / 2) ** 2;

    return 6371 * 2 * Math.atan2(
        Math.sqrt(a),
        Math.sqrt(1 - a)
    );
}

async function purchaseDriverEligibility(req, res, next) {
    try {
        const driver = await Driver.findOne({
            userId: req.user._id,
            isOnline: true,
            isAvailable: true,
        });

        if (!driver) {
            return res.status(403).json({
                success: false,
                message: "Online and available driver required",
            });
        }

        const context = await eligibilityService.loadEligibilityContext(driver);
        const eligible = await eligibilityService.canReceiveBuyDeliverRequests(
            driver,
            context
        );

        if (!eligible) {
            const evaluation = eligibilityService.evaluateServiceEligibility(
                "BUY_DELIVER",
                {
                    driver,
                    vehicle: context.vehicle,
                    documents: context.documents,
                }
            );

            return res.status(403).json({
                success: false,
                code: "BUY_DELIVER_NOT_ELIGIBLE",
                message: "You are not eligible to receive Buy & Deliver requests",
                reasons: evaluation.reasons,
            });
        }

        const coords = driver.currentLocation?.coordinates;

        if (
            !Array.isArray(coords) ||
            coords.length !== 2 ||
            !coords.every(Number.isFinite) ||
            (coords[0] === 0 && coords[1] === 0) ||
            !driver.lastLocationUpdate ||
            Date.now() - new Date(driver.lastLocationUpdate).getTime() > 120000
        ) {
            return res.status(403).json({
                success: false,
                message: "Fresh driver GPS location required",
            });
        }

        const settings = await CommissionSettings.findOne({
            key: "GLOBAL",
        })
            .select("buyDeliverEnabled buyDeliverMaxOrderValue buyDeliverRadiusKm")
            .lean();

        if (settings?.buyDeliverEnabled === false) {
            return res.status(403).json({
                success: false,
                message: "Buy & Deliver is currently disabled",
            });
        }

        const radiusKm =
            Number.isFinite(settings?.buyDeliverRadiusKm) &&
            settings.buyDeliverRadiusKm >= 1
                ? settings.buyDeliverRadiusKm
                : 15;

        if (req.params.id) {
            const order = await PurchaseOrder.findOne({
                _id: req.params.id,
                status: "BIDDING",
                driverId: null,
            }).select("deliveryAddress estimatedBudget");

            if (!order) {
                return res.status(404).json({
                    success: false,
                    message: "Purchase request unavailable",
                });
            }

            const deliveryCoords = order.deliveryAddress?.coordinates;

            if (
                !Array.isArray(deliveryCoords) ||
                deliveryCoords.length !== 2 ||
                !deliveryCoords.every(Number.isFinite)
            ) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid delivery coordinates",
                });
            }

            const distance = distanceKm(
                coords[1],
                coords[0],
                deliveryCoords[1],
                deliveryCoords[0]
            );

            if (distance > radiusKm) {
                return res.status(403).json({
                    success: false,
                    message: `Delivery location is outside your ${radiusKm} km service radius`,
                });
            }

            const record = eligibilityService.getServiceRecord(
                driver,
                "BUY_DELIVER"
            );

            const capCheck = checkAmountWithinCaps(order.estimatedBudget, {
                partnerLimit: record.purchaseLimit,
                globalCap: settings?.buyDeliverMaxOrderValue ?? null,
            });

            if (!capCheck.ok) {
                return res.status(403).json({
                    success: false,
                    code: capCheck.code,
                    message: "This request's budget is above your purchase limit",
                });
            }
        }

        req.purchaseDriver = driver;
        req.purchaseContext = context;
        req.purchaseSettings = settings || null;
        req.purchaseRadiusKm = radiusKm;

        return next();
    } catch (error) {
        console.error("Purchase eligibility error:", error.message);
        return res.status(500).json({
            success: false,
            message: "Driver eligibility verification failed",
        });
    }
}

module.exports = { purchaseDriverEligibility, distanceKm };
