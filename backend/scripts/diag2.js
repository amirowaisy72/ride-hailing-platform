require("dotenv").config();
const mongoose = require("mongoose");
(async () => {
    await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
    const db = mongoose.connection.db;
    console.log("settlements by status:", await db.collection("ridesettlements").aggregate([{ $group: { _id: "$status", n: { $sum: 1 } } }]).toArray());
    console.log("pending rides:", await db.collection("rides").countDocuments({ status: "TRIP_COMPLETED", settlementStatus: "PENDING" }));
    const f = await db.collection("ridesettlements").findOne({ status: "FAILED" });
    console.log("one FAILED settlement doc:", f ? { rideId: String(f.rideId), lastError: f.lastError || null, createdAt: f.createdAt, updatedAt: f.updatedAt } : null);
    await mongoose.disconnect();
})().catch(e => { console.error(e.message); process.exit(1); });