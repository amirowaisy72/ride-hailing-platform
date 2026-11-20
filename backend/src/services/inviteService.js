const crypto = require("crypto");
const User = require("../models/User");

// ---------------------------------------------------------------------
// Invite System (Safar To-Do #6) — invite-code helpers.
//
// Every user gets a short unique code (e.g. "K7M2QX9A"). The code is
// an ADDITIVE optional field on User: existing users simply have none
// until one is generated for them on first use. Codes are unambiguous
// (no 0/O, 1/I) so they survive being read out loud or typed by hand.
// There is NO reward/benefit logic anywhere — the user has explicitly
// not decided one yet; this is the invite facility only.
// ---------------------------------------------------------------------

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;

function generateInviteCode() {
    const bytes = crypto.randomBytes(CODE_LENGTH);
    let code = "";
    for (let i = 0; i < CODE_LENGTH; i++) {
        code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
    }
    return code;
}

// Returns the user's existing code, or generates + saves a fresh unique
// one. Safe to call repeatedly — the second call returns the first code.
async function ensureInviteCode(user) {
    if (user.inviteCode) return user.inviteCode;

    for (let attempt = 0; attempt < 10; attempt++) {
        const code = generateInviteCode();
        try {
            const updated = await User.findOneAndUpdate(
                { _id: user._id, inviteCode: { $in: [null, ""] } },
                { $set: { inviteCode: code } },
                { returnDocument: "after" }
            );
            if (updated?.inviteCode) return updated.inviteCode;
            // Someone else set a code concurrently — reload and return it.
            const fresh = await User.findById(user._id).select("inviteCode").lean();
            if (fresh?.inviteCode) return fresh.inviteCode;
        } catch (error) {
            // Duplicate-key race on the unique index: retry with a new code.
            if (error.code !== 11000) throw error;
        }
    }

    throw new Error("Could not generate a unique invite code");
}

// Normalises user input ("safar-k7m2qx9a", lower case, spaces) to the
// stored form, or returns null for anything that cannot be a code.
function normalizeInviteCode(raw) {
    if (typeof raw !== "string") return null;
    let cleaned = raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    // Forgiving: accept a "SAFAR" prefix ("SAFAR-K7M2QX9A" / "SAFARK7M2QX9A").
    if (cleaned.startsWith("SAFAR")) cleaned = cleaned.slice(5);
    if (cleaned.length !== CODE_LENGTH) return null;
    if (![...cleaned].every((ch) => CODE_ALPHABET.includes(ch))) return null;
    return cleaned;
}

// Finds the inviter for a code, or null when the code does not exist.
async function resolveInviteCode(raw) {
    const code = normalizeInviteCode(raw);
    if (!code) return null;
    return User.findOne({ inviteCode: code }).select("_id inviteCode").lean();
}

module.exports = {
    generateInviteCode,
    ensureInviteCode,
    normalizeInviteCode,
    resolveInviteCode,
    CODE_LENGTH,
};
