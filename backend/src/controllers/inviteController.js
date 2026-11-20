const User = require("../models/User");
const {
    ensureInviteCode,
    normalizeInviteCode,
    resolveInviteCode,
} = require("../services/inviteService");
const { webAppBaseUrl } = require("./safetyController");

// ---------------------------------------------------------------------
// Invite System (Safar To-Do #6) — all routes are NEW and additive.
//
// GET  /invites/me            — your code + share link + invited count
// GET  /invites/validate/:code — public; is this code real? (first name
//                                of the inviter only, for the signup screen)
// POST /invites/apply         — attach an inviter to your own account
//                                (e.g. you signed up via Google first)
// Signup attribution itself lives in verifySignupOTP / googleLogin,
// which accept the same optional inviteCode.
// NO reward/benefit logic: the user has not decided one yet.
// ---------------------------------------------------------------------

const getMyInvite = async (req, res) => {
    try {
        const user = await User.findById(req.user._id);
        if (!user) {
            return res.status(404).json({ success: false, message: "User not found" });
        }

        const code = await ensureInviteCode(user);
        const invitedCount = await User.countDocuments({ invitedBy: user._id });

        return res.json({
            success: true,
            inviteCode: code,
            inviteLink: `${webAppBaseUrl()}/signup?invite=${code}`,
            invitedCount,
        });
    } catch (error) {
        console.error("Get invite error:", error.message);
        return res.status(500).json({ success: false, message: "Failed to load invite code" });
    }
};

const validateInviteCode = async (req, res) => {
    try {
        const inviter = await resolveInviteCode(req.params.code);
        if (!inviter) {
            return res.json({ success: true, valid: false });
        }

        const user = await User.findById(inviter._id).select("firstName").lean();
        return res.json({
            success: true,
            valid: true,
            inviterName: user?.firstName || "A Safar user",
        });
    } catch (error) {
        console.error("Validate invite error:", error.message);
        return res.status(500).json({ success: false, message: "Failed to validate invite code" });
    }
};

const applyInviteCode = async (req, res) => {
    try {
        const code = normalizeInviteCode(req.body?.code);
        if (!code) {
            return res.status(400).json({ success: false, message: "Enter a valid invite code" });
        }

        const inviter = await resolveInviteCode(code);
        if (!inviter) {
            return res.status(404).json({ success: false, message: "Invite code not found" });
        }

        if (String(inviter._id) === String(req.user._id)) {
            return res.status(400).json({ success: false, message: "You cannot invite yourself" });
        }

        const user = await User.findById(req.user._id).select("invitedBy");
        if (!user) {
            return res.status(404).json({ success: false, message: "User not found" });
        }
        if (user.invitedBy) {
            return res.status(409).json({ success: false, message: "An inviter is already set on this account" });
        }

        user.invitedBy = inviter._id;
        user.invitedAt = new Date();
        await user.save();

        return res.json({ success: true, message: "Invite recorded" });
    } catch (error) {
        console.error("Apply invite error:", error.message);
        return res.status(500).json({ success: false, message: "Failed to apply invite code" });
    }
};

module.exports = { getMyInvite, validateInviteCode, applyInviteCode };
