const express = require("express");
const { protect } = require("../middleware/authMiddleware");
const {
    getMyInvite,
    validateInviteCode,
    applyInviteCode,
} = require("../controllers/inviteController");

// Invite System (Safar To-Do #6). New router, additive only.
// Mounted at /api/v1/invites — see server.js. No reward logic: the
// user has not decided any reward yet; invite facility only.

const router = express.Router();

// Public: check a code before signup (shows the inviter's first name).
router.get("/validate/:code", validateInviteCode);

router.use(protect);

router.get("/me", getMyInvite);
router.post("/apply", applyInviteCode);

module.exports = router;
