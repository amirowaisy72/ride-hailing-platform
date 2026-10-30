const RentalPartnerDocument = require("../models/RentalPartnerDocument");
const { approvedDocumentTypes } = require("./eligibilityService");

// Phase 2 (Rentals foundation) — shared Rental Partner KYC rules.
// Business KYC: identity documents only. A driving licence is required
// additionally when the partner also supplies a chauffeur, and is then
// tracked by the separate chauffeurVerificationStatus flow.
const RENTAL_PARTNER_KYC_DOCUMENTS = [
    "CNIC_FRONT",
    "CNIC_BACK",
    "PROFILE_PHOTO",
];

const CHAUFFEUR_DOCUMENTS = ["DRIVING_LICENSE"];

function requiredKycDocuments(partner) {
    const required = [...RENTAL_PARTNER_KYC_DOCUMENTS];

    if (partner?.providesChauffeur) {
        required.push(...CHAUFFEUR_DOCUMENTS);
    }

    return required;
}

function missingKycDocuments(partner, documents, now = new Date()) {
    const approved = approvedDocumentTypes(documents, now);

    return requiredKycDocuments(partner).filter(
        (type) => !approved.has(type)
    );
}

async function loadRentalPartnerDocuments(rentalPartnerId) {
    return RentalPartnerDocument.find({ rentalPartnerId });
}

// ---------------------------------------------------------------------------
// Chauffeur verification flow (Amir review A16) — the missing half of the
// With-Driver gate in rentalBookingService.evaluateChauffeurEligibility:
// partners declare chauffeur identity here, admins review it, and only an
// APPROVED chauffeurVerificationStatus lets With-Driver bookings through.
//
// Semantics:
// - The partner DECLARES details (applyChauffeurDeclaration). Declaring
//   implies providesChauffeur=true. Complete details (name + licence
//   number) move the status to PENDING for review; partial details leave
//   it INCOMPLETE. Changing declared details while APPROVED drops the
//   status back to PENDING — a material change needs a fresh review.
// - The admin REVIEWS (applyChauffeurVerification). Admin-settable
//   statuses are PENDING / UNDER_REVIEW / APPROVED / REJECTED /
//   SUSPENDED. NOT_APPLIED and INCOMPLETE are partner-flow states and
//   are never set by an admin. "Unverify" is expressed as PENDING (the
//   declaration stays on file and must be re-approved), never as
//   NOT_APPLIED, which would falsely claim no declaration exists.
// - APPROVED requires providesChauffeur=true and a licence number on
//   file, and an expired licence cannot be approved (mirrors the
//   expired-document rule in adminRentalPartnerController).
// - A SUSPENDED chauffeur can never jump straight to APPROVED; it must
//   re-enter review (PENDING / UNDER_REVIEW) first.
// ---------------------------------------------------------------------------

const CHAUFFEUR_REVIEW_STATUSES = [
    "PENDING",
    "UNDER_REVIEW",
    "APPROVED",
    "REJECTED",
    "SUSPENDED",
];

const CHAUFFEUR_TRANSITIONS = {
    NOT_APPLIED: ["PENDING", "UNDER_REVIEW"],
    INCOMPLETE: ["PENDING", "UNDER_REVIEW", "REJECTED"],
    PENDING: ["UNDER_REVIEW", "APPROVED", "REJECTED"],
    UNDER_REVIEW: ["PENDING", "APPROVED", "REJECTED"],
    APPROVED: ["PENDING", "SUSPENDED"],
    REJECTED: ["PENDING", "UNDER_REVIEW"],
    SUSPENDED: ["PENDING", "UNDER_REVIEW"],
};

function chauffeurError(status, message) {
    return { ok: false, error: { status, message } };
}

// Normalises the chauffeur detail fields out of a request-style object.
// Returns { details } with only the keys actually present, or an error
// result when a present value is malformed.
function parseChauffeurDetails(input = {}, now = new Date()) {
    const details = {};

    if (input.chauffeurName !== undefined) {
        if (
            typeof input.chauffeurName !== "string" ||
            !input.chauffeurName.trim()
        ) {
            return chauffeurError(400, "Chauffeur name must be a non-empty string");
        }
        details.chauffeurName = input.chauffeurName.trim();
    }

    if (input.chauffeurLicenceNumber !== undefined) {
        if (
            typeof input.chauffeurLicenceNumber !== "string" ||
            !input.chauffeurLicenceNumber.trim()
        ) {
            return chauffeurError(
                400,
                "Chauffeur licence number must be a non-empty string"
            );
        }
        details.chauffeurLicenceNumber = input.chauffeurLicenceNumber.trim();
    }

    if (input.chauffeurLicenceExpiry !== undefined) {
        const expiry = new Date(input.chauffeurLicenceExpiry);
        if (!Number.isFinite(expiry.getTime())) {
            return chauffeurError(400, "Chauffeur licence expiry must be a valid date");
        }
        if (expiry <= now) {
            return chauffeurError(400, "Chauffeur licence expiry must be a future date");
        }
        details.chauffeurLicenceExpiry = expiry;
    }

    return { ok: true, details };
}

function writeChauffeurDetails(partner, details) {
    for (const key of [
        "chauffeurName",
        "chauffeurLicenceNumber",
        "chauffeurLicenceExpiry",
    ]) {
        if (details[key] !== undefined) partner[key] = details[key];
    }
}

// Partner-side declaration. Mutates `partner` (caller saves). Returns
// { ok: true } or { ok: false, error: { status, message } }.
function applyChauffeurDeclaration(partner, input = {}, now = new Date()) {
    if (partner.chauffeurVerificationStatus === "SUSPENDED") {
        return chauffeurError(
            403,
            "Chauffeur verification is suspended — contact support"
        );
    }

    const parsed = parseChauffeurDetails(input, now);
    if (!parsed.ok) return parsed;

    const details = parsed.details;
    if (Object.keys(details).length === 0) {
        return chauffeurError(
            400,
            "Provide chauffeurName, chauffeurLicenceNumber or chauffeurLicenceExpiry"
        );
    }

    const changedWhileApproved =
        partner.chauffeurVerificationStatus === "APPROVED" &&
        Object.entries(details).some(([key, value]) => {
            const current = partner[key];
            return current instanceof Date
                ? current.getTime() !== value.getTime()
                : current !== value;
        });

    writeChauffeurDetails(partner, details);
    partner.providesChauffeur = true;

    if (partner.chauffeurVerificationStatus === "APPROVED") {
        if (changedWhileApproved) {
            partner.chauffeurVerificationStatus = "PENDING";
            partner.chauffeurVerifiedBy = null;
            partner.chauffeurVerifiedAt = null;
        }
    } else {
        partner.chauffeurVerificationStatus =
            partner.chauffeurName && partner.chauffeurLicenceNumber
                ? "PENDING"
                : "INCOMPLETE";
        partner.chauffeurRejectionReason = null;
    }

    return { ok: true };
}

// Admin-side review. Mutates `partner` (caller saves). `input` may carry
// detail corrections alongside the status; the effective (post-update)
// values are what APPROVED is validated against.
function applyChauffeurVerification(
    partner,
    input = {},
    adminUserId = null,
    now = new Date()
) {
    const parsed = parseChauffeurDetails(input, now);
    if (!parsed.ok) return parsed;
    writeChauffeurDetails(partner, parsed.details);

    const { status, rejectionReason } = input;

    // Details-only correction: no status change requested.
    if (status === undefined) return { ok: true };

    if (!CHAUFFEUR_REVIEW_STATUSES.includes(status)) {
        return chauffeurError(
            400,
            `Invalid chauffeur verification status — an admin can set ${CHAUFFEUR_REVIEW_STATUSES.join(", ")}`
        );
    }

    const current = partner.chauffeurVerificationStatus;

    if (status !== current) {
        const allowed = CHAUFFEUR_TRANSITIONS[current] || [];
        if (!allowed.includes(status)) {
            return chauffeurError(
                400,
                `Cannot move chauffeur verification from ${current} to ${status}`
            );
        }
    }

    if (status === "APPROVED") {
        if (!partner.providesChauffeur) {
            return chauffeurError(
                400,
                "Partner does not provide a chauffeur (providesChauffeur is false)"
            );
        }
        if (!partner.chauffeurLicenceNumber) {
            return chauffeurError(
                400,
                "Chauffeur licence number required before approval"
            );
        }
        if (
            partner.chauffeurLicenceExpiry &&
            partner.chauffeurLicenceExpiry <= now
        ) {
            return chauffeurError(400, "Chauffeur licence has expired");
        }
    }

    if (
        status === "REJECTED" &&
        (typeof rejectionReason !== "string" || !rejectionReason.trim())
    ) {
        return chauffeurError(400, "Rejection reason required");
    }

    partner.chauffeurVerificationStatus = status;

    if (status === "APPROVED") {
        partner.chauffeurVerifiedBy = adminUserId;
        partner.chauffeurVerifiedAt = now;
        partner.chauffeurRejectionReason = null;
    } else {
        partner.chauffeurVerifiedBy = null;
        partner.chauffeurVerifiedAt = null;
        partner.chauffeurRejectionReason =
            status === "REJECTED" ? rejectionReason.trim() : null;
    }

    return { ok: true };
}

module.exports = {
    RENTAL_PARTNER_KYC_DOCUMENTS,
    CHAUFFEUR_DOCUMENTS,
    CHAUFFEUR_REVIEW_STATUSES,
    CHAUFFEUR_TRANSITIONS,
    requiredKycDocuments,
    missingKycDocuments,
    loadRentalPartnerDocuments,
    parseChauffeurDetails,
    applyChauffeurDeclaration,
    applyChauffeurVerification,
};
