const crypto = require("crypto");
const bcrypt = require("bcryptjs");

const generateOTP = () => {
    return crypto.randomInt(100000, 1000000).toString();
};

const hashOTP = async (otp) => {
    return bcrypt.hash(otp, 10);
};

const verifyOTPHash = async (otp, hash) => {
    return bcrypt.compare(otp, hash);
};

module.exports = {
    generateOTP,
    hashOTP,
    verifyOTPHash,
};