// Pakistani mobile numbers only. Accepted inputs (spaces/dashes
// ignored): 03XX-XXXXXXX or +92 3XX XXXXXXX. Normalised to +92 form
// for storage, e.g. 0301-2345678 -> +923012345678.
function normalizePkPhone(raw) {
    if (typeof raw !== "string") return null;
    const cleaned = raw.replace(/[\s-]/g, "").trim();
    if (/^03\d{9}$/.test(cleaned)) return `+92${cleaned.slice(1)}`;
    if (/^\+923\d{9}$/.test(cleaned)) return cleaned;
    return null;
}

function isValidPkPhone(raw) {
    return normalizePkPhone(raw) !== null;
}

module.exports = { normalizePkPhone, isValidPkPhone };
