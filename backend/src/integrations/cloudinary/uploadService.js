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

module.exports = { uploadToCloudinary };