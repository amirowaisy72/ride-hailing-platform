const express = require("express");
const { protect } = require("../middleware/authMiddleware");
const { authorize } = require("../middleware/roleMiddleware");
const upload = require("../middleware/uploadMiddleware");
const { uploadDocument } = require("../controllers/driverDocumentController");

const router = express.Router();

router.post(
    "/",
    protect,
    authorize("PASSENGER", "DRIVER"),
    upload.single("document"),
    uploadDocument
);

module.exports = router;