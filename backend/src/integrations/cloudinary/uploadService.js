const cloudinary = require("./cloudinary");
const IntegrationSetting = require("../../models/IntegrationSetting");

async function ensureCloudinaryEnabled() {
    const setting = await IntegrationSetting.findOne({
        key: "cloudinary-uploads",
    }).lean();

    if (setting?.enabled === false) {
        const error = new Error("Cloudinary uploads are temporarily disabled by Admin");
        error.statusCode = 503;
        throw error;
    }
}
const { Readable } = require("stream");

const uploadToCloudinary = async (buffer, driverId) => {
    await ensureCloudinaryEnabled();

    return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
            {
                folder: `ride-hailing/drivers/${driverId}`,
                resource_type: "image",
                type: "authenticated",
                overwrite: false,
            },
            (error, result) => {
                if (error) return reject(error);

                resolve({
                    imageUrl: result.secure_url,
                    publicId: result.public_id,
                });
            }
        );

        Readable.from(buffer).pipe(stream);
    });
};

// Voice messages (Phase 3 A11b). Cloudinary stores audio under
// resource_type "video"; type "upload" (public) so a plain <audio>
// tag can play the returned secure_url without signed delivery.
const uploadAudioToCloudinary = async (buffer, userId) => {
    await ensureCloudinaryEnabled();

    return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
            {
                folder: `ride-hailing/chat-audio/${userId}`,
                resource_type: "video",
                type: "upload",
                overwrite: false,
            },
            (error, result) => {
                if (error) return reject(error);

                resolve({
                    audioUrl: result.secure_url,
                    publicId: result.public_id,
                });
            }
        );

        Readable.from(buffer).pipe(stream);
    });
};

const uploadProfileImage = async (buffer, userId) => {
    await ensureCloudinaryEnabled();

    return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
            {
                folder: "ride-hailing/profile-pictures",
                public_id: String(userId),
                resource_type: "image",
                type: "upload",
                format: "webp",
                transformation: [
                    {
                        width: 512,
                        height: 512,
                        crop: "fill",
                        gravity: "auto",
                    },
                ],
                overwrite: true,
                invalidate: true,
            },
            (error, result) => {
                if (error) return reject(error);

                resolve({
                    imageUrl: result.secure_url,
                    publicId: result.public_id,
                });
            }
        );

        stream.end(buffer);
    });
};

module.exports = {
    uploadToCloudinary,
    uploadAudioToCloudinary,
    uploadProfileImage,
};