const Driver = require("../models/Driver");
const DriverDocument = require("../models/DriverDocument");
const {
    SERVICES,
    isValidService,
    getServiceRecord,
    serviceRequiresVehicle,
    VEHICLE_TYPES_BY_TRANSPORT_MODE,
    loadEligibilityContext,
    evaluateServiceEligibility,
    evaluateDriverService,
    missingDocumentsFor,
} = require("../services/eligibilityService");

// ---------------------------------------------------------------------------
// Phase 2 — Admin per-service driver actions.
// Mounted under /api/v1/admin/drivers/:id/services (see
// routes/adminDriverRoutes.js). These endpoints sit BESIDE the legacy
// global updateDriverStatus, which is unchanged: approving, rejecting or
// suspending one service never touches the driver's other services or the
// global verificationStatus.
// ---------------------------------------------------------------------------

const ADMIN_SETTABLE_STATUSES = [
    "APPROVED",
    "REJECTED",
    "SUSPENDED",
    "UNDER_REVIEW",
    "PENDING",
];

// Applies an admin service-status decision to a LOADED driver document
// (record mutation + the last-eligible-service offline rule). Does NOT
// save — the caller saves. Shared by the per-service status endpoint
// below and by suspendDriverService (Phase 7 fraud restriction), so the
// isolation rule — suspending one service never disables another
// approved service — lives in exactly one place.
const applyServiceStatus = async (
    driver,
    service,
    { status, rejectionReason, suspensionReason, purchaseLimit } = {}
) => {
    const record = driver.services[service];

    record.status = status;
    record.statusUpdatedAt = new Date();
    record.rejectionReason =
        status === "REJECTED" ? rejectionReason.trim() : null;

    if (status === "SUSPENDED") {
        record.suspendedAt = new Date();
        record.suspensionReason =
            typeof suspensionReason === "string" && suspensionReason.trim()
                ? suspensionReason.trim()
                : null;
    } else {
        record.suspendedAt = null;
        record.suspensionReason = null;
    }

    if (purchaseLimit !== undefined) {
        record.purchaseLimit = purchaseLimit;
    }

    // Suspending / rejecting the driver's last eligible service takes
    // them offline — but suspending one service while another stays
    // eligible leaves them online, untouched.
    if ((status === "SUSPENDED" || status === "REJECTED") && driver.isOnline) {
        const context = await loadEligibilityContext(driver);
        const anyEligible = SERVICES.some(
            (candidate) =>
                evaluateServiceEligibility(candidate, {
                    driver,
                    vehicle: context.vehicle,
                    documents: context.documents,
                }).eligible
        );

        if (!anyEligible) {
            driver.isOnline = false;
            driver.isAvailable = false;
        }
    }
};

// Suspends ONE service for a driver (Phase 7 — e.g. the Buy & Deliver
// fraud restriction from the purchase-order admin). Returns the saved
// driver, or null when the driver does not exist.
const suspendDriverService = async (driverId, service, suspensionReason) => {
    const driver = await Driver.findById(driverId);

    if (!driver) {
        return null;
    }

    await applyServiceStatus(driver, service, {
        status: "SUSPENDED",
        suspensionReason,
    });

    await driver.save();

    return driver;
};

const updateDriverServiceStatus = async (req, res) => {
    try {
        const service = String(req.params.service || "").toUpperCase();

        if (!isValidService(service)) {
            return res.status(400).json({
                success: false,
                message: "Invalid service",
            });
        }

        const { status, rejectionReason, suspensionReason } = req.body;
        let { purchaseLimit } = req.body;

        if (!ADMIN_SETTABLE_STATUSES.includes(status)) {
            return res.status(400).json({
                success: false,
                message: "Invalid service status",
            });
        }

        if (
            status === "REJECTED" &&
            (typeof rejectionReason !== "string" || !rejectionReason.trim())
        ) {
            return res.status(400).json({
                success: false,
                message: "Rejection reason required",
            });
        }

        if (purchaseLimit !== undefined) {
            if (
                service !== "BUY_DELIVER" ||
                typeof purchaseLimit !== "number" ||
                !Number.isFinite(purchaseLimit) ||
                purchaseLimit < 0
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "purchaseLimit must be a non-negative number and applies to Buy & Deliver only",
                });
            }
        }

        const driver = await Driver.findById(req.params.id);

        if (!driver) {
            return res.status(404).json({
                success: false,
                message: "Driver not found",
            });
        }

        const record = driver.services[service];
        const transportMode =
            service === "BUY_DELIVER" ? record.transportMode : null;

        if (status === "APPROVED") {
            // Service-specific document list (eligibilityService is the
            // single source): Buy & Deliver requires its identity
            // documents PLUS the full motor list — driving licence and
            // vehicle registration included — for every transport mode
            // (Amir correction, 2026-10-29: vehicle verification is
            // mandatory for Buy & Deliver, no reduced tier).
            const context = await loadEligibilityContext(driver);

            const missing = missingDocumentsFor(
                service,
                transportMode,
                context.documents,
                new Date()
            );

            if (missing.length > 0) {
                return res.status(400).json({
                    success: false,
                    message: "Required approved documents missing",
                    missingDocuments: missing,
                });
            }

            if (serviceRequiresVehicle(service, transportMode)) {
                if (!context.vehicle) {
                    return res.status(400).json({
                        success: false,
                        message: "Approved active vehicle required",
                    });
                }

                const allowedTypes =
                    VEHICLE_TYPES_BY_TRANSPORT_MODE[transportMode];

                if (
                    allowedTypes &&
                    !allowedTypes.includes(context.vehicle.vehicleType)
                ) {
                    return res.status(400).json({
                        success: false,
                        message:
                            "Active vehicle type does not match the selected transport mode",
                    });
                }
            }

            if (service === "BUY_DELIVER" && !record.policyAcknowledgedAt) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Partner has not acknowledged the purchase-handling policy",
                });
            }

            if (service === "BUY_DELIVER" && !transportMode) {
                return res.status(400).json({
                    success: false,
                    message: "Transport mode not selected",
                });
            }
        }

        await applyServiceStatus(driver, service, {
            status,
            rejectionReason,
            suspensionReason,
            purchaseLimit,
        });

        await driver.save();

        return res.json({
            success: true,
            message: `Service ${service} ${status.toLowerCase()} successfully`,
            driver: {
                id: driver._id,
                service,
                status: getServiceRecord(driver, service).status,
            },
        });
    } catch (error) {
        console.error("Driver service status error:", error.message);

        return res.status(500).json({
            success: false,
            message: "Failed to update driver service status",
        });
    }
};

// Phase 7 — Driver Management detail: per-service status (stored AND
// effective), transport mode, purchase limit, the eligibility
// evaluation with its exact blocked reasons, the required/missing
// document lists, and the driver's documents with their review state.
// The per-service records carry statusUpdatedAt + rejection/suspension
// reasons — that is the approval history the schema records; there is
// no separate history collection to invent one from.
const getDriverServicesAdmin = async (req, res) => {
    try {
        const driver = await Driver.findById(req.params.id).populate(
            "userId",
            "firstName lastName email"
        );

        if (!driver) {
            return res.status(404).json({
                success: false,
                message: "Driver not found",
            });
        }

        const context = await loadEligibilityContext(driver);

        const services = [];

        for (const service of SERVICES) {
            const evaluation = await evaluateDriverService(
                driver,
                service,
                context
            );

            services.push({
                ...evaluation,
                record: getServiceRecord(driver, service),
            });
        }

        const documents = await DriverDocument.find({ driverId: driver._id })
            .select(
                "_id documentType verificationStatus rejectionReason expiryDate createdAt updatedAt"
            )
            .sort({ createdAt: -1 })
            .lean();

        return res.json({
            success: true,
            driver: {
                id: driver._id,
                user: driver.userId || null,
                globalVerificationStatus: driver.verificationStatus,
                globalRejectionReason: driver.rejectionReason || null,
                isOnline: driver.isOnline === true,
                isAvailable: driver.isAvailable === true,
            },
            services,
            documents,
            activeVehicle: context.vehicle
                ? {
                    id: context.vehicle._id,
                    vehicleType: context.vehicle.vehicleType,
                    make: context.vehicle.make || "",
                    model: context.vehicle.model || "",
                    registrationExpiryDate:
                        context.vehicle.registrationExpiryDate || null,
                }
                : null,
        });
    } catch (error) {
        console.error("Driver services detail error:", error.message);

        return res.status(500).json({
            success: false,
            message: "Failed to load driver services",
        });
    }
};

module.exports = {
    updateDriverServiceStatus,
    getDriverServicesAdmin,
    suspendDriverService,
};
