const express = require("express");
const { protect } = require("../middleware/authMiddleware");
const upload = require("../middleware/uploadMiddleware");
const {
    listConversations,
    getOrCreateConversation,
    getMessages,
    sendMessage,
    markRead,
    getUnreadCounts,
    uploadChatImage,
} = require("../controllers/orderChatController");

const router = express.Router();

// Phase 6 — order chat. Every route is `protect`-only: participants are
// resolved server-side from the order / conversation (no role gate
// beyond being a party). Literal paths are registered BEFORE /:id so
// /unread/counts and /upload always win over the parameter routes.

router.get("/unread/counts", protect, getUnreadCounts);
router.post("/upload", protect, upload.single("image"), uploadChatImage);

router.get("/", protect, listConversations);
router.post("/", protect, getOrCreateConversation);

router.get("/:id/messages", protect, getMessages);
router.post("/:id/messages", protect, sendMessage);
router.post("/:id/read", protect, markRead);

module.exports = router;
