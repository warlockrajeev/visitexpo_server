/**
 * @file emailOtpService.js
 * @description Zoho CPaaS (REST API + SMTP fallback) transactional Email OTP service for user registration.
 * Zoho CPaaS REST API endpoint: POST https://cpaas.zoho.in/v1.1/email
 */

import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import nodemailer from 'nodemailer';
import EmailOtpVerification from '../models/EmailOtpVerification.js';
import User from '../models/User.js';

const EMAIL_PATTERN = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
const RESEND_COOLDOWN_MS = 30 * 1000; // 30 seconds
const MAX_VERIFY_ATTEMPTS = 5;

const getRoleLabel = (role) => {
  if (!role) return 'User';
  const r = String(role).toLowerCase();
  if (r === 'organizer') return 'Organiser';
  if (r === 'exhibitor') return 'Exhibitor';
  if (r === 'visitor') return 'Visitor';
  if (r === 'super_admin' || r === 'admin') return 'Administrator';
  return r.charAt(0).toUpperCase() + r.slice(1);
};

const getJwtSecret = () =>
  process.env.JWT_SECRET || 'visitexpo_access_key_super_secret_change_me_in_production';

const getZohoAuthHeader = () => {
  const raw = String(process.env.ZOHO_CPAAS_API_KEY || '').trim();
  if (!raw) return '';
  return raw.toLowerCase().startsWith('zoho-enczapikey') ? raw : `Zoho-enczapikey ${raw}`;
};

const getZohoSender = () => ({
  address: (process.env.ZOHO_CPAAS_FROM_EMAIL || 'noreply@visitexpo.in').trim(),
  name: (process.env.ZOHO_CPAAS_FROM_NAME || 'VisitExpo').trim()
});

const buildOtpEmailContent = ({ code, recipientName }) => {
  const safeName = String(recipientName || '').trim().replace(/[<>]/g, '') || 'there';
  const subject = `Your VisitExpo Email Verification Code: ${code}`;
  const text = [
    `Hi ${safeName},`,
    '',
    `Your VisitExpo registration verification code is: ${code}`,
    '',
    'This 6-digit OTP is valid for 10 minutes. Please do not share it with anyone.',
    '',
    'If you did not initiate this registration on VisitExpo, you can safely ignore this email.',
    '',
    '— Team VisitExpo (visitexpo.in)'
  ].join('\n');

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>VisitExpo Email Verification</title>
</head>
<body style="margin:0;padding:0;background-color:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#18181b;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#f8fafc;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;background-color:#ffffff;border-radius:20px;overflow:hidden;border:1px solid #e4e4e7;box-shadow:0 8px 24px rgba(0,0,0,0.05);">
          <tr>
            <td style="background-color:#18181b;padding:28px 32px;text-align:center;">
              <div style="display:inline-block;background-color:#FFCC00;color:#18181b;font-weight:800;font-size:12px;letter-spacing:1px;text-transform:uppercase;padding:5px 14px;border-radius:999px;margin-bottom:10px;">
                VisitExpo Verification
              </div>
              <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:800;letter-spacing:-0.3px;">
                Verify Your Email Address
              </h1>
            </td>
          </tr>
          <tr>
            <td style="padding:32px;">
              <p style="margin:0 0 12px 0;font-size:15px;color:#27272a;line-height:1.6;">
                Hi <strong>${safeName}</strong>,
              </p>
              <p style="margin:0 0 24px 0;font-size:14px;color:#52525b;line-height:1.6;">
                Use the 6-digit One-Time Password (OTP) below to verify your email address and complete your VisitExpo registration:
              </p>
              <div style="background-color:#fefce8;border:2px dashed #eab308;border-radius:16px;padding:22px 16px;text-align:center;margin:0 0 24px 0;">
                <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1.4px;color:#a16207;margin-bottom:8px;">
                  One-Time Verification Code
                </div>
                <div style="font-family:'Courier New',Courier,monospace;font-size:34px;font-weight:800;letter-spacing:10px;color:#18181b;">
                  ${code}
                </div>
              </div>
              <p style="margin:0 0 8px 0;font-size:13px;color:#52525b;line-height:1.5;">
                This code expires in <strong>10 minutes</strong>. For your security, never share this code with anyone.
              </p>
              <p style="margin:0;font-size:12px;color:#71717a;line-height:1.5;">
                If you did not request this code, please ignore this email.
              </p>
            </td>
          </tr>
          <tr>
            <td style="background-color:#fafafa;border-top:1px solid #f4f4f5;padding:18px 24px;text-align:center;font-size:12px;color:#71717a;">
              VisitExpo &bull; Official Trade Shows &amp; Exhibitions Platform<br />
              <a href="https://visitexpo.in" style="color:#a16207;text-decoration:none;font-weight:700;">visitexpo.in</a>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();

  return { subject, html, text };
};

export class EmailOtpService {
  static normalizeEmail(email) {
    return typeof email === 'string' ? email.toLowerCase().trim() : '';
  }

  static isValidEmail(email) {
    const normalized = this.normalizeEmail(email);
    return normalized.length > 0 && normalized.length <= 254 && EMAIL_PATTERN.test(normalized);
  }

  /**
   * Dispatch transactional email via Zoho CPaaS REST API (https://cpaas.zoho.in/v1.1/email)
   */
  static async sendViaZohoCpaasRest({ toEmail, toName, subject, html, text }) {
    const apiUrl = (process.env.ZOHO_CPAAS_API_URL || 'https://cpaas.zoho.in/v1.1/email').trim();
    const authHeader = getZohoAuthHeader();
    if (!authHeader) {
      return { success: false, error: 'ZOHO_CPAAS_API_KEY is not configured on the server.' };
    }

    const sender = getZohoSender();
    const payload = {
      from: {
        address: sender.address,
        name: sender.name
      },
      to: [
        {
          email_address: {
            address: toEmail,
            name: String(toName || toEmail.split('@')[0]).trim()
          }
        }
      ],
      subject,
      htmlbody: html,
      textbody: text
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000);

    try {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: authHeader
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      const rawText = await response.text();
      let data = null;
      try {
        data = rawText ? JSON.parse(rawText) : null;
      } catch {
        data = null;
      }

      if (response.ok) {
        return {
          success: true,
          provider: 'zoho_cpaas_rest',
          requestId: data?.request_id || data?.data?.[0]?.message_id || null,
          data
        };
      }

      const zohoDetails =
        data?.error?.details?.[0]?.inner_error?.message ||
        data?.error?.details?.[0]?.message ||
        data?.error?.message ||
        data?.message ||
        rawText ||
        `HTTP ${response.status}`;

      console.error(`[EmailOtpService] Zoho CPaaS REST error (${response.status}):`, zohoDetails);
      return {
        success: false,
        status: response.status,
        error: zohoDetails,
        raw: data
      };
    } catch (err) {
      console.error('[EmailOtpService] Zoho CPaaS REST request failed:', err.message);
      return {
        success: false,
        error: err.name === 'AbortError' ? 'Zoho CPaaS request timed out.' : err.message
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Optional SMTP fallback using Zoho CPaaS (ZeptoMail) SMTP credentials
   */
  static async sendViaZohoCpaasSmtp({ toEmail, subject, html, text }) {
    const host = (process.env.ZOHO_CPAAS_SMTP_HOST || 'smtp.zeptomail.in').trim();
    const port = parseInt(process.env.ZOHO_CPAAS_SMTP_PORT || '587', 10);
    const user = (process.env.ZOHO_CPAAS_SMTP_USER || 'emailapikey').trim();
    const pass = String(process.env.ZOHO_CPAAS_SMTP_PASS || '').trim();
    if (!pass) {
      return { success: false, error: 'Zoho CPaaS SMTP password is not configured.' };
    }

    const sender = getZohoSender();
    try {
      const transporter = nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 10000,
        auth: { user, pass }
      });

      const info = await transporter.sendMail({
        from: `"${sender.name}" <${sender.address}>`,
        to: toEmail,
        subject,
        text,
        html
      });

      return {
        success: true,
        provider: 'zoho_cpaas_smtp',
        requestId: info.messageId
      };
    } catch (err) {
      console.error('[EmailOtpService] Zoho CPaaS SMTP fallback failed:', err.message);
      return { success: false, error: err.message };
    }
  }

  /**
   * Send a transactional email via Zoho CPaaS REST API (with Zoho SMTP fallback)
   */
  static async sendTransactionalEmail({ toEmail, toName, subject, html, text }) {
    const restResult = await this.sendViaZohoCpaasRest({ toEmail, toName, subject, html, text });
    if (restResult.success) {
      return restResult;
    }

    // Attempt Zoho CPaaS SMTP fallback if REST failed due to transient network/endpoint error
    const smtpResult = await this.sendViaZohoCpaasSmtp({ toEmail, subject, html, text });
    if (smtpResult.success) {
      return smtpResult;
    }

    return {
      success: false,
      error: restResult.error || smtpResult.error || 'Failed to send verification email via Zoho CPaaS.'
    };
  }

  /**
   * Generate, persist, and dispatch a 6-digit registration OTP to the user's email
   */
  static async sendRegistrationEmailOtp(emailInput, recipientName = '') {
    const email = this.normalizeEmail(emailInput);
    if (!this.isValidEmail(email)) {
      return {
        success: false,
        statusCode: 400,
        error: 'Please enter a valid email address.'
      };
    }

    // Reject early if email is already registered so users don't waste OTPs
    const existingUser = await User.findOne({ email }).select('role').lean();
    if (existingUser) {
      const existingLabel = getRoleLabel(existingUser.role);
      return {
        success: false,
        statusCode: 409,
        registeredRole: existingUser.role,
        error: `This email address is already registered as an ${existingLabel}. Please switch to the ${existingLabel} tab to sign in.`
      };
    }

    // Rate-limit OTP resend requests per email
    const existingRecord = await EmailOtpVerification.findOne({ email });
    if (existingRecord && existingRecord.lastSentAt) {
      const elapsedMs = Date.now() - new Date(existingRecord.lastSentAt).getTime();
      if (elapsedMs < RESEND_COOLDOWN_MS) {
        const waitSec = Math.max(1, Math.ceil((RESEND_COOLDOWN_MS - elapsedMs) / 1000));
        return {
          success: false,
          statusCode: 429,
          error: `Please wait ${waitSec} seconds before requesting another email OTP.`
        };
      }
    }

    const code = String(crypto.randomInt(100000, 1000000));
    const codeHash = await bcrypt.hash(code, 10);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + OTP_TTL_MS);

    await EmailOtpVerification.findOneAndUpdate(
      { email },
      {
        $set: {
          codeHash,
          attempts: 0,
          lastSentAt: now,
          expiresAt
        }
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    const { subject, html, text } = buildOtpEmailContent({ code, recipientName });
    const sendResult = await this.sendTransactionalEmail({
      toEmail: email,
      toName: recipientName,
      subject,
      html,
      text
    });

    if (!sendResult.success) {
      await EmailOtpVerification.deleteOne({ email });
      return {
        success: false,
        statusCode: 502,
        error: sendResult.error
          ? `Could not send verification email: ${sendResult.error}`
          : 'Could not send verification email right now. Please try again.'
      };
    }

    console.log(`[EmailOtpService] Registration OTP dispatched to ${email} via ${sendResult.provider}`);
    return {
      success: true,
      email,
      provider: sendResult.provider,
      message: `6-digit verification code sent to ${email}`
    };
  }

  /**
   * Verify 6-digit registration Email OTP and return a signed JWT verification token
   */
  static async verifyRegistrationEmailOtp(emailInput, otpInput) {
    const email = this.normalizeEmail(emailInput);
    const otp = String(otpInput || '').trim();

    if (!this.isValidEmail(email)) {
      return {
        success: false,
        statusCode: 400,
        error: 'Please enter a valid email address.'
      };
    }

    if (!/^\d{6}$/.test(otp)) {
      return {
        success: false,
        statusCode: 400,
        error: 'Please enter a valid 6-digit OTP code.'
      };
    }

    const record = await EmailOtpVerification.findOne({ email });
    if (!record || record.expiresAt <= new Date()) {
      return {
        success: false,
        statusCode: 400,
        error: 'Email OTP has expired or was not requested. Please request a new OTP.'
      };
    }

    if (record.attempts >= MAX_VERIFY_ATTEMPTS) {
      return {
        success: false,
        statusCode: 429,
        error: 'Too many incorrect OTP attempts. Please request a new email OTP.'
      };
    }

    const isMatch = await bcrypt.compare(otp, record.codeHash);
    if (!isMatch) {
      record.attempts += 1;
      await record.save();
      const remaining = Math.max(0, MAX_VERIFY_ATTEMPTS - record.attempts);
      return {
        success: false,
        statusCode: 400,
        error:
          remaining > 0
            ? `Incorrect OTP code. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`
            : 'Too many incorrect OTP attempts. Please request a new email OTP.'
      };
    }

    await EmailOtpVerification.deleteOne({ _id: record._id });

    const emailVerificationToken = this.generateEmailVerificationToken(email);
    return {
      success: true,
      email,
      emailVerificationToken,
      message: 'Email address verified successfully.'
    };
  }

  /**
   * Generate signed JWT proving ownership of an email address during registration
   */
  static generateEmailVerificationToken(emailInput) {
    const email = this.normalizeEmail(emailInput);
    return jwt.sign(
      {
        email,
        purpose: 'registration_email_verification',
        verifiedAt: Date.now()
      },
      getJwtSecret(),
      { expiresIn: '30m' }
    );
  }

  /**
   * Validate signed email verification token on final account creation
   */
  static validateEmailVerificationToken(token, emailInput) {
    if (!token || !emailInput) return false;
    const email = this.normalizeEmail(emailInput);
    try {
      const decoded = jwt.verify(token, getJwtSecret());
      return (
        decoded.purpose === 'registration_email_verification' &&
        decoded.email === email
      );
    } catch {
      return false;
    }
  }
}

export default EmailOtpService;
