const multer = require("multer");

// Voice-message uploads for order chat (Phase 3 A11b). Separate from
// uploadMiddleware.js (image-only) so the image policy is untouched.
const storage = multer.memoryStorage();

const ALLOWED_AUDIO_TYPES = [
    "audio/webm",
    "audio/mp4",
    "audio/mpeg",
    "audio/ogg",
    "audio/wav",
    "audio/x-m4a",
    "audio/aac",
];

const uploadAudio = multer({
    storage,
    limits: {
        fileSize: 10 * 1024 * 1024,
        files: 1,
    },
    fileFilter: (req, file, cb) => {
        if (!ALLOWED_AUDIO_TYPES.includes(file.mimetype)) {
            return cb(
                new Error(
                    `Unsupported audio type "${file.mimetype}". Allowed: ${ALLOWED_AUDIO_TYPES.join(", ")}`
                )
            );
        }

        cb(null, true);
    },
});

module.exports = uploadAudio;
module.exports.ALLOWED_AUDIO_TYPES = ALLOWED_AUDIO_TYPES;
