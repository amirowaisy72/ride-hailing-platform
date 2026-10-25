require("dotenv").config();
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const User = require("./src/models/User");

(async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    const result = await User.updateOne(
      { email: process.env.ADMIN_EMAIL.trim().toLowerCase(), role: "ADMIN" },
      { $set: { passwordHash: await bcrypt.hash(process.env.ADMIN_PASSWORD, 12) } }
    );
    console.log("Matched:", result.matchedCount, "Updated:", result.modifiedCount);
  } finally {
    await mongoose.disconnect();
  }
})().catch(console.error);
