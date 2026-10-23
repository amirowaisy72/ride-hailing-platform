require("dotenv").config();

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");

const connectDB = require("./config/db");
const { connectSocket } = require("./services/socketService");

const authRoutes = require("./routes/authRoutes");
const driverRoutes = require("./routes/driverRoutes");
const driverDocumentRoutes = require("./routes/driverDocumentRoutes");
const adminDriverRoutes = require("./routes/adminDriverRoutes");
const locationRoutes = require("./routes/locationRoutes");
const serviceAreaRoutes = require("./routes/serviceAreaRoutes");
const rideRoutes = require("./routes/rideRoutes");
const vehiclePricingRoutes = require("./routes/vehiclePricingRoutes");
const vehicleRoutes = require("./routes/vehicleRoutes");
const adminVehicleRoutes = require("./routes/adminVehicleRoutes");

const app = express();

app.set("trust proxy", 1);

app.use(helmet());
app.use(cors());
app.use(express.json());

app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/account", require("./routes/accountRoutes"));
app.use("/api/v1/saved-places", require("./routes/savedPlaceRoutes"));
app.use(
    "/api/v1/admin/commission",
    require("./routes/adminCommissionRoutes")
);
app.use(
    "/api/v1/admin/settlements",
    require("./routes/adminSettlementRoutes")
);
app.use(
    "/api/v1/admin/wallets",
    require("./routes/adminWalletRoutes")
);
app.use("/api/v1/drivers", driverRoutes);
app.use("/api/v1/drivers/me/documents", driverDocumentRoutes);
app.use("/api/v1/admin/drivers", adminDriverRoutes);
app.use("/api/v1/locations", locationRoutes);
app.use("/api/v1/service-areas", serviceAreaRoutes);
app.use("/api/v1/admin/service-areas", serviceAreaRoutes);
app.use("/api/v1/rides", rideRoutes);
app.use("/api/v1/parcels", require("./routes/parcelRoutes"));
app.use("/api/v1/admin/parcels", require("./routes/adminParcelRoutes"));
app.use("/api/v1/vehicle-pricing", vehiclePricingRoutes);
app.use("/api/v1/drivers/me/vehicles", vehicleRoutes);
app.use("/api/v1/admin/vehicles", adminVehicleRoutes);
app.use(
    "/api/v1/admin/operations",
    require("./routes/adminOperationsRoutes")
);

app.get("/api/v1/health", (req, res) => {
    res.status(200).json({
        success: true,
        message: "Ride-Hailing API is running",
    });
});

const PORT = process.env.PORT || 5000;

const startServer = async () => {
    await connectDB();

    app.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
        connectSocket();
    });
};

startServer();