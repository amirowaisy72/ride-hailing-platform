const Vehicle = require("../models/Vehicle");
const DriverDocument = require("../models/DriverDocument");

// ---------------------------------------------------------------------------
// Phase 2 — Multi-service eligibility: SINGLE SOURCE OF TRUTH.
//
// Every "may this partner receive work for service X" decision must go
// through this module. It interprets the per-service records stored on
// Driver.services (see models/Driver.js) together with the legacy global
// Driver.verificationStatus, the driver's active vehicle and the driver's
// approved documents.
//
// Backward-compatibility contract (do not break):
//  - RIDE and PARCEL are the legacy pair. When a service record has never
//    been touched (status NOT_APPLIED), its effective status is DERIVED
//    from the global verificationStatus, so every driver approved before
//    Phase 2 keeps exactly the access they have today — by construction,
//    not by a data migration.
//  - An explicit per-service status (application or admin action) always
//    overrides the derivation for that service only. Approving or
//    suspending one service never changes another.
//  - A global SUSPENDED is an account-level sanction and blocks all
//    services; a global REJECTED blocks the legacy pair (RIDE/PARCEL)
//    but never an independently approved BUY_DELIVER.
//  - BUY_DELIVER has no legacy equivalent: only its own record counts.
//  - CORRECTION (Amir, 2026-10-29): Buy & Deliver partners must meet the
//    FULL motor-vehicle verification standard — approved active vehicle
//    plus approved/unexpired licence + vehicle-registration documents —
//    exactly like RIDE/PARCEL, whatever transport mode is recorded. An
//    earlier reduced "identity-only" tier for walking/bicycle partners
//    was a misunderstanding and has been removed; transportMode is now
//    descriptive metadata only and never lowers any requirement.
// ---------------------------------------------------------------------------

const SERVICES = ["RIDE", "PARCEL", "BUY_DELIVER"];

const SERVICE_STATUSES = [
    "NOT_APPLIED",
    "INCOMPLETE",
    "PENDING",
    "UNDER_REVIEW",
    "APPROVED",
    "REJECTED",
    "SUSPENDED",
];

const TRANSPORT_MODES = ["WALKING", "BICYCLE", "MOTORBIKE", "CAR"];
const MOTOR_TRANSPORT_MODES = ["MOTORBIKE", "CAR"];

// Vehicle.vehicleType values accepted for each motorised transport mode.
const VEHICLE_TYPES_BY_TRANSPORT_MODE = {
    MOTORBIKE: ["BIKE"],
    CAR: ["CAR_AC", "CAR_NON_AC"],
};

// Documents that must be APPROVED and unexpired before Admin may approve
// a motorised service — identical to the list the legacy global driver
// approval has always required.
const MOTOR_SERVICE_DOCUMENTS = [
    "CNIC_FRONT",
    "CNIC_BACK",
    "DRIVING_LICENSE",
    "VEHICLE_REGISTRATION",
];

// Buy & Deliver: the service's own identity requirements PLUS the full
// motor-vehicle list — for EVERY transport mode, without exception
// (Amir correction, 2026-10-29). Vehicle registration + verification is
// mandatory for Buy & Deliver partners just as it is for ride/parcel.
const BUY_DELIVER_DOCUMENTS = [
    "CNIC_FRONT",
    "CNIC_BACK",
    "PROFILE_PHOTO",
    "DRIVING_LICENSE",
    "VEHICLE_REGISTRATION",
];

// Deprecated alias kept for export stability; identical to
// BUY_DELIVER_DOCUMENTS now that the list is mode-independent.
const BUY_DELIVER_MOTOR_DOCUMENTS = BUY_DELIVER_DOCUMENTS;

function isValidService(service) {
    return SERVICES.includes(service);
}

function getRequiredDocuments(service, transportMode) {
    if (service === "BUY_DELIVER") {
        // Mode-independent: the recorded transport mode never reduces
        // the Buy & Deliver document requirements.
        return [...BUY_DELIVER_DOCUMENTS];
    }

    // RIDE and PARCEL keep today's requirements.
    return [...MOTOR_SERVICE_DOCUMENTS];
}

function serviceRequiresVehicle(service, transportMode) {
    // Every service — RIDE, PARCEL and BUY_DELIVER alike — requires an
    // approved active vehicle, whatever transport mode is recorded.
    return SERVICES.includes(service);
}

// Reads the raw per-service record with schema defaults filled in. Works
// for both Mongoose documents and plain objects (tests, lean queries).
function getServiceRecord(driver, service) {
    const record = driver?.services?.[service] || {};

    return {
        status: record.status || "NOT_APPLIED",
        enabled: record.enabled !== false,
        transportMode: record.transportMode || null,
        purchaseLimit:
            typeof record.purchaseLimit === "number"
                ? record.purchaseLimit
                : null,
        policyAcknowledgedAt: record.policyAcknowledgedAt || null,
        rejectionReason: record.rejectionReason || null,
        suspendedAt: record.suspendedAt || null,
        suspensionReason: record.suspensionReason || null,
        statusUpdatedAt: record.statusUpdatedAt || null,
    };
}

// The status that actually governs a service right now, after applying
// the legacy derivation rules described in the header.
function getEffectiveServiceStatus(driver, service) {
    const globalStatus = driver?.verificationStatus || "PENDING";

    // Account-level sanction: a globally suspended driver receives nothing.
    if (globalStatus === "SUSPENDED") {
        return "SUSPENDED";
    }

    const record = getServiceRecord(driver, service);

    if (service === "BUY_DELIVER") {
        return record.status;
    }

    // Legacy pair (RIDE / PARCEL): a global rejection stands, an explicit
    // per-service record wins, otherwise derive from the global status so
    // pre-Phase-2 drivers keep their access by construction.
    if (globalStatus === "REJECTED") {
        return "REJECTED";
    }

    if (record.status !== "NOT_APPLIED") {
        return record.status;
    }

    return globalStatus;
}

function isServiceEnabled(driver, service) {
    return getServiceRecord(driver, service).enabled;
}

function approvedDocumentTypes(documents, now = new Date()) {
    const approved = new Set();

    for (const doc of documents || []) {
        if (doc.verificationStatus !== "APPROVED") {
            continue;
        }

        if (doc.expiryDate && new Date(doc.expiryDate) <= now) {
            continue;
        }

        approved.add(doc.documentType);
    }

    return approved;
}

function missingDocumentsFor(service, transportMode, documents, now) {
    const approved = approvedDocumentTypes(documents, now);

    return getRequiredDocuments(service, transportMode).filter(
        (type) => !approved.has(type)
    );
}

// Pure evaluator — no database access. `snapshot` is
// { driver, vehicle, documents, now } where `vehicle` is the driver's
// APPROVED + active current vehicle (or null) and `documents` is the
// driver's full DriverDocument list.
function evaluateServiceEligibility(service, snapshot) {
    const { driver, vehicle = null, documents = [], now = new Date() } =
        snapshot || {};

    const record = getServiceRecord(driver, service);
    const status = getEffectiveServiceStatus(driver, service);
    const enabled = record.enabled;
    const transportMode =
        service === "BUY_DELIVER" ? record.transportMode : null;

    const reasons = [];

    if (status !== "APPROVED") {
        reasons.push(`Service status is ${status}`);
    }

    if (!enabled) {
        reasons.push("Service is turned off by the driver");
    }

    if (service === "BUY_DELIVER") {
        if (!transportMode) {
            reasons.push("Transport mode not selected");
        }

        if (!record.policyAcknowledgedAt) {
            reasons.push(
                "Purchase-handling policy has not been acknowledged"
            );
        }
    }

    const missingDocuments = missingDocumentsFor(
        service,
        transportMode,
        documents,
        now
    );

    if (missingDocuments.length > 0) {
        reasons.push(
            `Missing approved documents: ${missingDocuments.join(", ")}`
        );
    }

    if (serviceRequiresVehicle(service, transportMode)) {
        if (!vehicle) {
            reasons.push("Approved active vehicle required");
        } else {
            if (
                service === "BUY_DELIVER" &&
                transportMode &&
                VEHICLE_TYPES_BY_TRANSPORT_MODE[transportMode] &&
                !VEHICLE_TYPES_BY_TRANSPORT_MODE[transportMode].includes(
                    vehicle.vehicleType
                )
            ) {
                reasons.push(
                    "Active vehicle type does not match the selected transport mode"
                );
            }

            if (
                vehicle.registrationExpiryDate &&
                new Date(vehicle.registrationExpiryDate) <= now
            ) {
                reasons.push("Vehicle registration expired");
            }
        }
    }

    return {
        service,
        status,
        enabled,
        transportMode,
        purchaseLimit: record.purchaseLimit,
        eligible: reasons.length === 0,
        reasons,
        missingDocuments,
        requiredDocuments: getRequiredDocuments(service, transportMode),
    };
}

// Loads the vehicle + documents a pure evaluation needs. Mirrors the
// vehicle query the pre-Phase-2 online gate used (APPROVED + active).
async function loadEligibilityContext(driver) {
    const [vehicle, documents] = await Promise.all([
        driver.currentVehicleId
            ? Vehicle.findOne({
                  _id: driver.currentVehicleId,
                  driverId: driver._id,
                  verificationStatus: "APPROVED",
                  isActive: true,
              })
            : null,
        DriverDocument.find({ driverId: driver._id }),
    ]);

    return { vehicle, documents };
}

// Async evaluation. Accepts a Driver document (or any object with the
// driver's fields); when `context` is omitted the vehicle/documents are
// loaded from the database.
async function evaluateDriverService(driver, service, context) {
    const ctx = context || (await loadEligibilityContext(driver));

    return evaluateServiceEligibility(service, {
        driver,
        vehicle: ctx.vehicle || null,
        documents: ctx.documents || [],
        now: ctx.now || new Date(),
    });
}

async function canReceiveRideRequests(driver, context) {
    return (await evaluateDriverService(driver, "RIDE", context)).eligible;
}

async function canReceiveParcelRequests(driver, context) {
    return (await evaluateDriverService(driver, "PARCEL", context)).eligible;
}

async function canReceiveBuyDeliverRequests(partner, context) {
    return (
        await evaluateDriverService(partner, "BUY_DELIVER", context)
    ).eligible;
}

// At least one enabled service is fully eligible — used by the online
// gate. Every service requires its full document set + an approved
// active vehicle, so this only relaxes WHICH service qualifies the
// driver to go online, never the verification standard itself.
async function hasAnyEligibleService(driver, context) {
    const ctx = context || (await loadEligibilityContext(driver));

    const evaluations = {};

    for (const service of SERVICES) {
        evaluations[service] = evaluateServiceEligibility(service, {
            driver,
            vehicle: ctx.vehicle || null,
            documents: ctx.documents || [],
            now: ctx.now || new Date(),
        });
    }

    return {
        eligible: SERVICES.some((service) => evaluations[service].eligible),
        evaluations,
        context: ctx,
    };
}

module.exports = {
    SERVICES,
    SERVICE_STATUSES,
    TRANSPORT_MODES,
    MOTOR_TRANSPORT_MODES,
    VEHICLE_TYPES_BY_TRANSPORT_MODE,
    MOTOR_SERVICE_DOCUMENTS,
    BUY_DELIVER_DOCUMENTS,
    BUY_DELIVER_MOTOR_DOCUMENTS,
    isValidService,
    getRequiredDocuments,
    serviceRequiresVehicle,
    getServiceRecord,
    getEffectiveServiceStatus,
    isServiceEnabled,
    approvedDocumentTypes,
    missingDocumentsFor,
    evaluateServiceEligibility,
    loadEligibilityContext,
    evaluateDriverService,
    canReceiveRideRequests,
    canReceiveParcelRequests,
    canReceiveBuyDeliverRequests,
    hasAnyEligibleService,
};
