const cloudinary = require("./cloudinary");
const { Readable } = require("stream");

const uploadToCloudinary = async (buffer, driverId) => {
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

const uploadProfileImage = async (buffer, userId) => {
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
    uploadProfileImage,
};