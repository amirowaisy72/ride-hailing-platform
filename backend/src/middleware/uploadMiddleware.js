const multer = require("multer");

const storage = multer.memoryStorage();

const upload = multer({
    storage,
    limits: {
        // Phone photos are routinely 5-8 MB. The old 5 MB cap rejected
        // real photos, and with no error handler the failure came back
        // as an unreadable HTML 500 instead of a message.
        fileSize: 10 * 1024 * 1024,
        files: 1,
    },
    fileFilter: (req, file, cb) => {
        const allowedTypes = [
            "image/jpeg",
            "image/png",
            "image/webp",
        ];

        if (!allowedTypes.includes(file.mimetype)) {
            return cb(new Error("Only JPG, PNG and WEBP images allowed"));
        }

        cb(null, true);
    },
});

module.exports = upload;