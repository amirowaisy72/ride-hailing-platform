
const mongoose = require("mongoose");

const schema = new mongoose.Schema({
    integration: { type: String, required: true },
    action: { type: String, required: true },
    previousValue: Boolean,
    newValue: Boolean,
    performedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
    },
}, { timestamps: true });

module.exports = mongoose.model("IntegrationAuditLog", schema);
