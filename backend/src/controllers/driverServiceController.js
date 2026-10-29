const Driver = require("../models/Driver");
const DriverDocument = require("../models/DriverDocument");
const {
    SERVICES,
    TRANSPORT_MODES,
    isValidService,
    getServiceRecord,
    loadEligibilityContext,
    evaluateServiceEligibility,
    missingDocumentsFor,
} = require("../services/eligibilityService");

// ---------------------------------------------------------------------------
// Phase 2 — driver-facing multi-service endpoints ("My Services").
// Mounted under /api/v1/drivers/me/services (see routes/driverRoutes.js).
// All eligibility interpretation goes through eligibilityService — this
// controller only writes application state and availability preferences.
// ---------------------------------------------------------------------------

function normalizeService(req, res) {
    const service = String(req.params.service || "").toUpperCase();

    if (!isValidService(service)) {
        res.status(400).json({
            success: false,
            message: "Invalid service",
        });
        return null;
    }

    return service;
}

async function findOwnDriver(req, res) {
    const driver = await Driver.findOne({ userId: req.user._id });

    if (!driver) {
        res.status(404).json({
            success: false,
            message: "Driver profile not found",
        });
        return null;
    }

    return driver;
}

function serviceState(driver, service, context) {
    const evaluation = evaluateServiceEligibility(service, {
        driver,
        vehicle: context.vehicle,
        documents: context.documents,
    });
    const record = getServiceRecord(driver, service);

    return {
        service,
        status: evaluation.status,
        applicationStatus: record.status,
        enabled: evaluation.enabled,
        transportMode: evaluation.transportMode,
        purchaseLimit: evaluation.purchaseLimit,
        policyAcknowledged: Boolean(record.policyAcknowledgedAt),
        rejectionReason: record.rejectionReason,
        suspensionReason: record.suspensionReason,
        requiredDocuments: evaluation.requiredDocuments,
        missingDocuments: evaluation.missingDocuments,
        eligible: evaluation.eligible,
        blockedReasons: evaluation.reasons,
    };
}

// Recomputes the application status after an apply / transport-mode
// change: PENDING when every required document is already approved (and,
// for BUY_DELIVER, the policy is acknowledged), INCOMPLETE otherwise.
function recomputeApplicationStatus(driver, service, documents) {
    const record = driver.services[service];
    const transportMode =
        service === "BUY_DELIVER" ? record.transportMode : null;

    const missing = missingDocumentsFor(
        service,
        transportMode,
        documents,
        new Date()
    );

    const policyMissing =
        service === "BUY_DELIVER" && !record.policyAcknowledgedAt;

    record.status =
        missing.length === 0 && !policyMissing ? "PENDING" : "INCOMPLETE";
    record.statusUpdatedAt = new Date();
}

const getMyServices = async (req, res) => {
    try {
        const driver = await findOwnDriver(req, res);
        if (!driver) return;

        const context = await loadEligibilityContext(driver);

        const services = SERVICES.map((service) =>
            serviceState(driver, service, context)
        );

        return res.json({
            success: true,
            services,
        });
    } catch (error) {
        console.error("My services error:", error.message);

        return res.status(500).json({
            success: false,
            message: "Failed to load services",
        });
    }
};

const applyForService = async (req, res) => {
    try {
        const service = normalizeService(req, res);
        if (!service) return;

        const driver = await findOwnDriver(req, res);
        if (!driver) return;

        const record = driver.services[service];

        if (record.status === "APPROVED") {
            return res.status(409).json({
                success: false,
                message: "Service already approved",
            });
        }

        if (record.status === "SUSPENDED") {
            return res.status(403).json({
                success: false,
                message: "Service is suspended",
            });
        }

        if (service === "BUY_DELIVER") {
            const transportMode = String(
                req.body?.transportMode || record.transportMode || ""
            ).toUpperCase();

            if (!TRANSPORT_MODES.includes(transportMode)) {
                return res.status(400).json({
                    success: false,
                    message:
                        "A valid transport mode (WALKING, BICYCLE, MOTORBIKE or CAR) is required for Buy & Deliver",
                });
            }

            record.transportMode = transportMode;

            if (req.body?.policyAcknowledged === true) {
                record.policyAcknowledgedAt = new Date();
            }
        }

        // A fresh application clears any previous rejection.
        record.rejectionReason = null;

        const documents = await DriverDocument.find({
            driverId: driver._id,
        });

        recomputeApplicationStatus(driver, service, documents);

        await driver.save();

        const context = await loadEligibilityContext(driver);

        return res.status(200).json({
            success: true,
            message:
                record.status === "PENDING"
                    ? "Application submitted for review"
                    : "Application saved — requirements incomplete",
            service: serviceState(driver, service, context),
        });
    } catch (error) {
        console.error("Service application error:", error.message);

        return res.status(500).json({
            success: false,
            message: "Service application failed",
        });
    }
};

const updateServiceTransportMode = async (req, res) => {
    try {
        const service = normalizeService(req, res);
        if (!service) return;

        if (service !== "BUY_DELIVER") {
            return res.status(400).json({
                success: false,
                message: "Transport mode applies to Buy & Deliver only",
            });
        }

        const transportMode = String(
            req.body?.transportMode || ""
        ).toUpperCase();

        if (!TRANSPORT_MODES.includes(transportMode)) {
            return res.status(400).json({
                success: false,
                message: "Invalid transport mode",
            });
        }

        const driver = await findOwnDriver(req, res);
        if (!driver) return;

        const record = driver.services[service];

        if (record.status === "SUSPENDED") {
            return res.status(403).json({
                success: false,
                message: "Service is suspended",
            });
        }

        record.transportMode = transportMode;

        // A mode change changes the document requirements, so an
        // approved service goes back for re-review under the new mode.
        if (
            ["APPROVED", "PENDING", "INCOMPLETE", "UNDER_REVIEW"].includes(
                record.status
            )
        ) {
            const documents = await DriverDocument.find({
                driverId: driver._id,
            });

            recomputeApplicationStatus(driver, service, documents);
        } else {
            record.statusUpdatedAt = new Date();
        }

        await driver.save();

        const context = await loadEligibilityContext(driver);

        return res.json({
            success: true,
            service: serviceState(driver, service, context),
        });
    } catch (error) {
        console.error("Transport mode error:", error.message);

        return res.status(500).json({
            success: false,
            message: "Failed to update transport mode",
        });
    }
};

const updateServiceAvailability = async (req, res) => {
    try {
        const service = normalizeService(req, res);
        if (!service) return;

        if (typeof req.body?.enabled !== "boolean") {
            return res.status(400).json({
                success: false,
                message: "enabled must be true or false",
            });
        }

        const driver = await findOwnDriver(req, res);
        if (!driver) return;

        // The toggle is a preference only: eligibilityService still
        // requires APPROVED status + documents + vehicle before the
        // service can receive anything, so a toggle can never make an
        // ineligible service receivable.
        driver.services[service].enabled = req.body.enabled;

        await driver.save();

        const context = await loadEligibilityContext(driver);
        const state = serviceState(driver, service, context);

        return res.json({
            success: true,
            service: state.service,
            enabled: state.enabled,
            receivable: state.eligible,
            blockedReasons: state.blockedReasons,
        });
    } catch (error) {
        console.error("Service availability error:", error.message);

        return res.status(500).json({
            success: false,
            message: "Failed to update service availability",
        });
    }
};

module.exports = {
    getMyServices,
    applyForService,
    updateServiceTransportMode,
    updateServiceAvailability,
};
