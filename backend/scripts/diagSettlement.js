require("dotenv").config();
const mongoose = require("mongoose");
(async () => {
    await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
    const db = mongoose.connection.db;
    const failed = await db.collection("rides").find({ settlementStatus: "FAILED" }).limit(3).toArray();
    console.log("FAILED rides:", failed.length);
    for (const r of failed) {
        const debit = await db.collection("wallettransactions").findOne({ rideId: r._id, type: "COMMISSION_DEBIT" });
        const st = await db.collection("ridesettlements").findOne({ rideId: r._id });
        console.log({ ride: String(r._id), status: r.status, finalPrice: r.finalPrice, priceType: typeof r.finalPrice, driverId: r.driverId ? String(r.driverId) : null, attempts: r.settlementAttempts, hasDebit: !!debit, settlementDoc: st ? st.status : null });
    }
    console.log(await db.collection("rides").aggregate([{ $group: { _id: "$settlementStatus", n: { $sum: 1 } } }]).toArray());
    await mongoose.disconnect();
})().catch(e => { console.error(e.message); process.exit(1); });