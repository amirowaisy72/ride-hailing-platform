const express = require("express");
const { protect } = require("../middleware/authMiddleware");
const { authorize } = require("../middleware/roleMiddleware");
const {
    getAppVersion,
    setAppVersion,
} = require("../controllers/appVersionController");

const router = express.Router();

// GET is public: the app checks it on launch without signing in.
// PUT is admin-only. This router is mounted at both /app-version
// (public check) and /admin/app-version (dashboard management).
router.get("/", getAppVersion);
router.put("/", protect, authorize("ADMIN"), setAppVersion);

module.exports = router;
