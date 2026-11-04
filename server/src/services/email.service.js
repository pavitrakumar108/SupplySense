import nodemailer from 'nodemailer';
import { env } from '../config/env.js';
import { AppError } from '../utils/app-error.js';
import { logger } from '../config/logger.js';

let transporter;

function getTransporter() {
  if (!env.SMTP_HOST) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      ...(env.SMTP_USER ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } } : {}),
    });
  }
  return transporter;
}

export function assertEmailConfigured() {
  if (!env.SMTP_HOST) {
    throw new AppError('Email delivery is not configured. Add SMTP settings to the local .env file and restart the app.', { statusCode: 503, code: 'EMAIL_NOT_CONFIGURED' });
  }
}

export async function sendVerificationCode({ email, code }) {
  assertEmailConfigured();
  const mailer = getTransporter();

  try {
    await mailer.sendMail({
      from: env.EMAIL_FROM,
      to: email,
      subject: 'Your SupplySense verification code',
      text: `Your SupplySense verification code is ${code}. It expires in 10 minutes. If you did not request this, you can ignore this email.`,
      html: `<p>Your SupplySense verification code is:</p><p style="font-size:28px;font-weight:700;letter-spacing:6px">${code}</p><p>It expires in 10 minutes. If you did not request this, you can ignore this email.</p>`,
    });
  } catch (error) {
    logger.error({ err: error }, 'verification email delivery failed');
    if (error.code === 'EAUTH') {
      throw new AppError('Gmail rejected the SMTP login. Replace SMTP_PASSWORD with a fresh Google App Password, then restart the API.', { statusCode: 503, code: 'EMAIL_AUTH_FAILED' });
    }
    throw new AppError('Could not send the verification email. Check the SMTP settings in .env.', { statusCode: 503, code: 'EMAIL_DELIVERY_FAILED' });
  }
  return { deliveryMode: 'email' };
}
