const express = require("express");
const { protect } = require("../middleware/authMiddleware");
const { authorize } = require("../middleware/roleMiddleware");
const {
    previewAnnouncementTargets,
    createAnnouncement,
    listAnnouncements,
    setAnnouncementActive,
    getActiveAnnouncement,
    markAnnouncementRead,
} = require("../controllers/announcementController");

const router = express.Router();

// User routes: any signed-in user, mounted at /announcements.
router.get("/active", protect, getActiveAnnouncement);
router.post("/:id/read", protect, markAnnouncementRead);

// Admin routes: mounted at /admin/announcements (same router, so
// these are also reachable under /announcements, but still admin-gated).
router.post("/preview", protect, authorize("ADMIN"), previewAnnouncementTargets);
router.post("/", protect, authorize("ADMIN"), createAnnouncement);
router.get("/", protect, authorize("ADMIN"), listAnnouncements);
router.patch("/:id", protect, authorize("ADMIN"), setAnnouncementActive);

module.exports = router;
