require("dotenv").config();

const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const User = require("../models/User");

const createAdmin = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI);

        const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
        const password = process.env.ADMIN_PASSWORD;

        if (!email || !password || password.length < 12) {
            throw new Error("Valid admin email and 12+ character password required");
        }

        if (await User.exists({ email })) {
            throw new Error("Email already registered");
        }

        await User.create({
            firstName: "System",
            lastName: "Admin",
            email,
            passwordHash: await bcrypt.hash(password, 12),
            role: "ADMIN",
            emailVerified: true,
            status: "ACTIVE",
        });

        console.log("Admin account created successfully");
    } catch (error) {
        console.error("Admin setup failed:", error.message);
        process.exitCode = 1;
    } finally {
        await mongoose.disconnect();
    }
};

createAdmin();