const nodemailer = require("nodemailer");
const IntegrationSetting = require("../../models/IntegrationSetting");

const sendOTPEmail = async (email, otp) => {
    const setting = await IntegrationSetting.findOne({
        key: "otp-email",
    }).lean();

    if (setting?.enabled === false) {
        const error = new Error("OTP email service is disabled by Admin");
        error.statusCode = 503;
        throw error;
    }

    const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT || 587),
        secure: process.env.SMTP_PORT === "465",
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
        },
    });

    await transporter.sendMail({
        from: process.env.SMTP_FROM,
        to: email,
        subject: "Verify Your Email - Safar",
        text: `Your verification code is ${otp}. It expires in 10 minutes.`,
    });
};

module.exports = { sendOTPEmail };