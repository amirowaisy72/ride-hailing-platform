const mongoose = require("mongoose");
const Ride = require("../models/Ride");
const Driver = require("../models/Driver");
const RideMessage = require("../models/RideMessage");
const { publishEvent } = require("../services/socketService");

const ALLOWED = ["DRIVER_SELECTED", "DRIVER_EN_ROUTE", "DRIVER_ARRIVED", "TRIP_STARTED"];

async function access(req) {
    if (!mongoose.isValidObjectId(req.params.rideId)) return null;
    const ride = await Ride.findOne({ _id: req.params.rideId, status: { $in: ALLOWED } });
    if (!ride || !ride.driverId) return null;
    const driver = await Driver.findById(ride.driverId).select("userId");
    if (!driver) return null;
    const uid = String(req.user._id);
    return uid === String(ride.passengerId) || uid === String(driver.userId)
        ? { ride, driver, recipientId: uid === String(ride.passengerId) ? driver.userId : ride.passengerId }
        : null;
}

async function getMessages(req, res) {
    try {
        const context = await access(req);
        if (!context) return res.status(403).json({ success: false, message: "Chat unavailable for this ride" });
        const messages = await RideMessage.find({ rideId: context.ride._id })
            .sort({ createdAt: -1 }).limit(100).lean();
        await RideMessage.updateMany({ rideId: context.ride._id, senderId: { $ne: req.user._id }, readAt: null }, { $set: { readAt: new Date() } });
        return res.json({ success: true, messages: messages.reverse() });
    } catch (error) { console.error("Load ride chat", error); return res.status(500).json({ success: false, message: "Chat unavailable" }); }
}

async function sendMessage(req, res) {
    try {
        const context = await access(req);
        if (!context) return res.status(403).json({ success: false, message: "Chat unavailable for this ride" });
        const body = typeof req.body?.body === "string" ? req.body.body.trim() : "";
        if (!body || body.length > 1000) return res.status(400).json({ success: false, message: "Message must contain 1–1000 characters" });
        const message = await RideMessage.create({ rideId: context.ride._id, senderId: req.user._id, body });
        const payload = { rideId: String(context.ride._id), message: message.toObject() };
        publishEvent("ride:chat:new", `passenger:${context.ride.passengerId}`, payload);
        publishEvent("ride:chat:new", `driver:${context.driver.userId}`, payload);
        return res.status(201).json({ success: true, message });
    } catch (error) { console.error("Send ride chat", error); return res.status(500).json({ success: false, message: "Message failed" }); }
}
module.exports = { getMessages, sendMessage };
