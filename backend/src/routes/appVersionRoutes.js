const express = require("express");
const { protect } = require("../middleware/authMiddleware");
const { authorize } = require("../middleware/roleMiddleware");
const {
    getAppVersion,
    setAppVersion,
} = require("../controllers/appVersionController");
const {
    getVersionUsage,
} = require("../controllers/appVersionReportController");

const router = express.Router();

// GET is public: the app checks it on launch without signing in.
// PUT is admin-only. This router is mounted at both /app-version
// (public check) and /admin/app-version (dashboard management).
router.get("/", getAppVersion);
router.put("/", protect, authorize("ADMIN"), setAppVersion);
// Admin-only usage stats. Guarded even though the router is also
// mounted on the public /app-version path, so unauthenticated or
// non-admin callers get 401/403, never the data.
router.get("/usage", protect, authorize("ADMIN"), getVersionUsage);

module.exports = router;
