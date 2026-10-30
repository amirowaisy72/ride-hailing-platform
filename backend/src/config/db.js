const mongoose = require("mongoose");

const connectDB = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log("MongoDB connected successfully");

        // Amir-test fix round (T-18): schema indexes were never built
        // on a fresh database — mongoose autoIndex did not create
        // them on this stack — so geo searches died with a 500
        // ("unable to find index for $geoNear query") on
        // RentalVehicle.pickupArea's 2dsphere index, and unique
        // indexes silently did not exist either. Build every
        // registered model's schema indexes once at startup.
        // createIndexes() only creates what is missing; it never
        // drops anything. A failure on one model must not stop the
        // server, so errors are logged, not thrown.
        for (const modelName of mongoose.modelNames()) {
            try {
                await mongoose.model(modelName).createIndexes();
            } catch (error) {
                console.error(
                    `Index build failed for ${modelName}:`,
                    error.message
                );
            }
        }
    } catch (error) {
        console.error("MongoDB connection failed:", error.message);
        process.exit(1);
    }
};

module.exports = connectDB;