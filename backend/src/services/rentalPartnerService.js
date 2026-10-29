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

module.exports = {
    RENTAL_PARTNER_KYC_DOCUMENTS,
    CHAUFFEUR_DOCUMENTS,
    requiredKycDocuments,
    missingKycDocuments,
    loadRentalPartnerDocuments,
};
