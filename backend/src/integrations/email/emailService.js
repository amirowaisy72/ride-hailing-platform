const nodemailer = require("nodemailer");

const sendOTPEmail = async (email, otp) => {
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
        subject: "Verify Your Email - Ride Hailing",
        text: `Your verification code is ${otp}. It expires in 10 minutes.`,
    });
};

module.exports = { sendOTPEmail };