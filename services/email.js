import nodemailer from "nodemailer";
import dotenv from "dotenv";

dotenv.config();

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "smtp.ethereal.email",
  port: process.env.SMTP_PORT || 587,
  auth: {
    user: process.env.SMTP_USER || "mock_user",
    pass: process.env.SMTP_PASS || "mock_pass",
  },
});

export const sendVerificationEmail = async (email, token) => {
  const verificationUrl = `${process.env.FRONTEND_URL || "http://localhost:5173"}/verify-email?token=${token}`;

  const mailOptions = {
    from: `"Zently Project Management" <${process.env.SMTP_USER || "no-reply@example.com"}>`,
    to: email,
    subject: "Verify your email",
    html: `
      <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: auto; padding: 40px; background-color: #1a1a1a; color: #e5e5e5; border-radius: 16px; border: 1px solid #333;">
        <div style="text-align: center; margin-bottom: 30px;">
           <img src="https://ui-avatars.com/api/?name=Z&background=6D28D9&color=fff&size=64&font-size=0.5&rounded=true" alt="Zently Logo" style="width: 48px; height: 48px; border-radius: 12px;">
           <h1 style="color: #fff; margin-top: 10px; font-size: 24px; letter-spacing: -0.5px;">Zently</h1>
        </div>
        <h2 style="color: #fff; text-align: center; font-weight: 600; margin-bottom: 20px;">Verify your email address</h2>
        <p style="color: #a3a3a3; text-align: center; font-size: 16px; line-height: 1.6;">Welcome to Zently! We're excited to have you on board. Please verify your email address to get started managing your projects efficiently.</p>
        <div style="text-align: center; margin: 40px 0;">
          <a href="${verificationUrl}" style="background-color: #7c3aed; color: white; padding: 14px 32px; text-decoration: none; border-radius: 12px; font-weight: 600; display: inline-block; transition: background-color 0.2s;">Verify Email</a>
        </div>
        <p style="color: #737373; font-size: 14px; text-align: center;">If the button above doesn't work, copy and paste this link into your browser:</p>
        <p style="word-break: break-all; color: #7c3aed; text-align: center; font-size: 13px; background: #262626; padding: 10px; border-radius: 8px;">${verificationUrl}</p>
        <div style="border-top: 1px solid #333; margin-top: 40px; padding-top: 20px; text-align: center;">
            <p style="font-size: 12px; color: #525252;">&copy; ${new Date().getFullYear()} Zently. All rights reserved.</p>
        </div>
      </div>
    `,
  };

  try {
    // For development, if we use ethereal or don't have real creds, log it
    console.log(`[EMAIL] Verification link for ${email}: ${verificationUrl}`);

    // If using ethereal/mock, it might fail without real creds, so we wrap it
    if (process.env.SMTP_HOST) {
      await transporter.sendMail(mailOptions);
    }
  } catch (error) {
    console.error("Error sending verification email:", error);
  }
};

export const sendInvitationEmail = async (email, link, orgName, role) => {
  const mailOptions = {
    from: `"Zently Project Management" <${process.env.SMTP_USER || "no-reply@zently.app"}>`,
    to: email,
    subject: `Join ${orgName} on Zently`,
    html: `
      <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: auto; padding: 40px; background-color: #1a1a1a; color: #e5e5e5; border-radius: 16px; border: 1px solid #333;">
        <div style="text-align: center; margin-bottom: 30px;">
           <img src="https://ui-avatars.com/api/?name=Z&background=6D28D9&color=fff&size=64&font-size=0.5&rounded=true" alt="Zently Logo" style="width: 48px; height: 48px; border-radius: 12px;">
           <h1 style="color: #fff; margin-top: 10px; font-size: 24px; letter-spacing: -0.5px;">Zently</h1>
        </div>
        <h2 style="color: #fff; text-align: center; font-weight: 600; margin-bottom: 20px;">You've been invited!</h2>
        <p style="color: #a3a3a3; text-align: center; font-size: 16px; line-height: 1.6;">You have been invited to join <strong>${orgName}</strong> as a <strong>${role}</strong> on Zently.</p>
        <div style="text-align: center; margin: 40px 0;">
          <a href="${link}" style="background-color: #7c3aed; color: white; padding: 14px 32px; text-decoration: none; border-radius: 12px; font-weight: 600; display: inline-block; transition: background-color 0.2s;">Accept Invitation</a>
        </div>
        <p style="color: #737373; font-size: 14px; text-align: center;">If you don't have an account yet, you'll be asked to create one first.</p>
        <p style="color: #737373; font-size: 14px; text-align: center;">If the button above doesn't work, copy and paste this link:</p>
        <p style="word-break: break-all; color: #7c3aed; text-align: center; font-size: 13px; background: #262626; padding: 10px; border-radius: 8px;">${link}</p>
        <div style="border-top: 1px solid #333; margin-top: 40px; padding-top: 20px; text-align: center;">
            <p style="font-size: 12px; color: #525252;">&copy; ${new Date().getFullYear()} Zently. All rights reserved.</p>
        </div>
      </div>
    `,
  };

  try {
    console.log(`[EMAIL] Invitation link for ${email} (${orgName}): ${link}`);
    if (process.env.SMTP_HOST) {
      await transporter.sendMail(mailOptions);
    }
  } catch (error) {
    console.error("Error sending invitation email:", error);
  }
};
