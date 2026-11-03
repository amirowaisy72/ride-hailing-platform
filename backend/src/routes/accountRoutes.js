const express = require("express");
const { protect } = require("../middleware/authMiddleware");
const upload = require("../middleware/uploadMiddleware");
const {
    getAccount,
    updateAccount,
    updateProfilePicture,
    switchMode,
} = require("../controllers/accountController");

const router = express.Router();

router.get("/me", protect, getAccount);
router.patch("/me/mode", protect, switchMode);
router.patch("/me", protect, updateAccount);
router.patch("/me/picture", protect, upload.single("picture"), updateProfilePicture);

const {
    registerDevice,
} = require("../controllers/pushDeviceController");

router.post("/push-device", protect, registerDevice);

const {
    reportAppVersion,
} = require("../controllers/appVersionReportController");

router.post("/app-version", protect, reportAppVersion);

module.exports = router;