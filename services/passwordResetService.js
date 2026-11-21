/**
 * @file passwordResetService.js
 * @description Forgot Password / Password Reset OTP service powered by Zoho CPaaS transactional email.
 */

import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import PasswordResetOtp from '../models/PasswordResetOtp.js';
import User from '../models/User.js';
import EmailOtpService from './emailOtpService.js';

const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
const RESEND_COOLDOWN_MS = 30 * 1000; // 30 seconds
const MAX_VERIFY_ATTEMPTS = 5;

const getJwtSecret = () =>
  process.env.JWT_SECRET || 'visitexpo_access_key_super_secret_change_me_in_production';

const escapeHtml = (str) =>
  String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const buildPasswordResetOtpEmail = ({ code, name }) => {
  const safeName = escapeHtml(String(name || '').trim() || 'there');
  const subject = `VisitExpo Password Reset Code: ${code}`;

  const text = [
    `Hi ${String(name || '').trim() || 'there'},`,
    '',
    'We received a request to reset your VisitExpo account password.',
    `Your 6-digit password reset verification code is: ${code}`,
    '',
    'This code expires in 10 minutes. For your security, never share this code with anyone.',
    '',
    'If you did not request a password reset, you can safely ignore this email — your password will remain unchanged.',
    '',
    '— The VisitExpo Team (visitexpo.in)'
  ].join('\n');

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Reset Your VisitExpo Password</title>
</head>
<body style="margin:0;padding:0;background-color:#F4F6FA;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#111827;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#F4F6FA;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:540px;background-color:#FFFFFF;border-radius:16px;border:1px solid #E5E7EB;overflow:hidden;box-shadow:0 6px 24px rgba(15,23,42,0.05);">
          <tr>
            <td style="background-color:#18181B;padding:26px 32px;text-align:center;">
              <div style="display:inline-block;background-color:#FFCC00;color:#18181B;font-size:11px;font-weight:800;letter-spacing:1px;text-transform:uppercase;padding:5px 14px;border-radius:999px;margin-bottom:10px;">
                VisitExpo Security
              </div>
              <h1 style="margin:0;color:#FFFFFF;font-size:21px;font-weight:800;">
                Reset Your Password
              </h1>
            </td>
          </tr>
          <tr>
            <td style="padding:32px;">
              <p style="margin:0 0 12px 0;font-size:15px;color:#1F2937;line-height:1.5;">
                Hi <strong>${safeName}</strong>,
              </p>
              <p style="margin:0 0 22px 0;font-size:14px;color:#4B5563;line-height:1.6;">
                We received a request to reset the password for your VisitExpo account. Enter the 6-digit verification code below to set a new password:
              </p>
              <div style="background-color:#EFF6FF;border:2px dashed #2563EB;border-radius:14px;padding:22px 16px;text-align:center;margin:0 0 22px 0;">
                <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1.3px;color:#1D4ED8;margin-bottom:8px;">
                  Password Reset OTP
                </div>
                <div style="font-family:'Courier New',Courier,monospace;font-size:34px;font-weight:800;letter-spacing:10px;color:#111827;">
                  ${code}
                </div>
              </div>
              <p style="margin:0 0 10px 0;font-size:13px;color:#4B5563;line-height:1.55;">
                This code is valid for <strong>10 minutes</strong>. Do not share this code with anyone.
              </p>
              <p style="margin:0;font-size:12px;color:#6B7280;line-height:1.55;">
                If you didn't request this password reset, you can safely ignore this email — your account remains secure.
              </p>
            </td>
          </tr>
          <tr>
            <td style="background-color:#F9FAFB;border-top:1px solid #EEF2F7;padding:18px 24px;text-align:center;font-size:12px;color:#6B7280;">
              Need help? Contact <a href="mailto:support@visitexpo.in" style="color:#2563EB;font-weight:600;text-decoration:none;">support@visitexpo.in</a> &bull; VisitExpo
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

const buildPasswordChangedNotificationEmail = ({ name }) => {
  const safeName = escapeHtml(String(name || '').trim() || 'there');
  const subject = 'Your VisitExpo Password Has Been Updated';
  const text = [
    `Hi ${String(name || '').trim() || 'there'},`,
    '',
    'Your VisitExpo account password was successfully updated.',
    'You can now sign in with your new password.',
    '',
    'If you did not make this change, please contact support@visitexpo.in immediately.',
    '',
    '— The VisitExpo Team'
  ].join('\n');

  const html = `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8" /></head>
<body style="margin:0;padding:0;background-color:#F4F6FA;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#111827;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#F4F6FA;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;background-color:#FFFFFF;border-radius:16px;border:1px solid #E5E7EB;overflow:hidden;">
          <tr>
            <td style="padding:28px 32px;">
              <div style="display:inline-block;background-color:#ECFDF5;color:#059669;font-size:11px;font-weight:700;padding:4px 12px;border-radius:999px;margin-bottom:14px;">
                &#10003; Security Update
              </div>
              <h2 style="margin:0 0 12px 0;font-size:20px;font-weight:800;color:#111827;">
                Password Updated Successfully
              </h2>
              <p style="margin:0 0 14px 0;font-size:14px;color:#374151;line-height:1.6;">
                Hi <strong>${safeName}</strong>,<br />
                Your VisitExpo account password was just updated. You can now sign in using your new password.
              </p>
              <p style="margin:0;font-size:12.5px;color:#6B7280;line-height:1.6;">
                If you did not make this change, please contact
                <a href="mailto:support@visitexpo.in" style="color:#2563EB;font-weight:600;text-decoration:none;">support@visitexpo.in</a> immediately.
              </p>
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

export class PasswordResetService {
  static validateNewPassword(newPassword) {
    if (!newPassword || typeof newPassword !== 'string') {
      return { valid: false, error: 'New password is required.' };
    }
    if (/[<>]/.test(newPassword)) {
      return { valid: false, error: 'Angle brackets (< and >) are not permitted in passwords.' };
    }
    if (/\s/.test(newPassword)) {
      return { valid: false, error: 'Password cannot contain spaces.' };
    }
    if (newPassword.length < 6) {
      return { valid: false, error: 'New password must be at least 6 characters long.' };
    }
    if (newPassword.length > 64) {
      return { valid: false, error: 'New password cannot exceed 64 characters.' };
    }
    if (!/(?=.*[a-zA-Z])(?=.*\d)/.test(newPassword)) {
      return { valid: false, error: 'New password must contain at least one letter and one number.' };
    }
    return { valid: true };
  }

  static generateResetToken(emailInput, userId) {
    const email = EmailOtpService.normalizeEmail(emailInput);
    return jwt.sign(
      {
        email,
        userId: String(userId || ''),
        purpose: 'password_reset_verification',
        verifiedAt: Date.now()
      },
      getJwtSecret(),
      { expiresIn: '15m' }
    );
  }

  static validateResetToken(token, emailInput) {
    if (!token || !emailInput) return null;
    const email = EmailOtpService.normalizeEmail(emailInput);
    try {
      const decoded = jwt.verify(token, getJwtSecret());
      if (decoded.purpose !== 'password_reset_verification') return null;
      if (decoded.email !== email) return null;
      return decoded;
    } catch {
      return null;
    }
  }

  static async sendPasswordResetOtp(emailInput) {
    const email = EmailOtpService.normalizeEmail(emailInput);
    if (!EmailOtpService.isValidEmail(email)) {
      return { success: false, statusCode: 400, error: 'Please enter a valid email address.' };
    }

    const user = await User.findOne({ email }).select('_id name email isSuspended status').lean();
    if (!user) {
      return {
        success: false,
        statusCode: 404,
        error: 'No VisitExpo account is registered with this email address.'
      };
    }

    if (user.isSuspended || user.status === 'suspended') {
      return {
        success: false,
        statusCode: 403,
        error: 'This account is currently suspended. Please contact support@visitexpo.in.'
      };
    }

    const existingRecord = await PasswordResetOtp.findOne({ email });
    if (existingRecord && existingRecord.lastSentAt) {
      const elapsedMs = Date.now() - new Date(existingRecord.lastSentAt).getTime();
      if (elapsedMs < RESEND_COOLDOWN_MS) {
        const waitSec = Math.max(1, Math.ceil((RESEND_COOLDOWN_MS - elapsedMs) / 1000));
        return {
          success: false,
          statusCode: 429,
          error: `Please wait ${waitSec} seconds before requesting another reset OTP.`
        };
      }
    }

    const code = String(crypto.randomInt(100000, 1000000));
    const codeHash = await bcrypt.hash(code, 10);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + OTP_TTL_MS);

    await PasswordResetOtp.findOneAndUpdate(
      { email },
      { $set: { codeHash, attempts: 0, lastSentAt: now, expiresAt } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    const { subject, html, text } = buildPasswordResetOtpEmail({ code, name: user.name });
    const sendResult = await EmailOtpService.sendTransactionalEmail({
      toEmail: email,
      toName: user.name,
      subject,
      html,
      text
    });

    if (!sendResult.success) {
      await PasswordResetOtp.deleteOne({ email });
      return {
        success: false,
        statusCode: 502,
        error: sendResult.error
          ? `Could not send password reset email: ${sendResult.error}`
          : 'Could not send password reset email right now. Please try again.'
      };
    }

    console.log(`[PasswordResetService] Reset OTP sent to ${email} via ${sendResult.provider}`);
    return {
      success: true,
      email,
      message: `6-digit password reset code sent to ${email}`
    };
  }

  static async verifyPasswordResetOtp(emailInput, otpInput) {
    const email = EmailOtpService.normalizeEmail(emailInput);
    const otp = String(otpInput || '').trim();

    if (!EmailOtpService.isValidEmail(email)) {
      return { success: false, statusCode: 400, error: 'Please enter a valid email address.' };
    }
    if (!/^\d{6}$/.test(otp)) {
      return { success: false, statusCode: 400, error: 'Please enter a valid 6-digit OTP code.' };
    }

    const record = await PasswordResetOtp.findOne({ email });
    if (!record || record.expiresAt <= new Date()) {
      return {
        success: false,
        statusCode: 400,
        error: 'Password reset OTP has expired or was not requested. Please request a new code.'
      };
    }

    if (record.attempts >= MAX_VERIFY_ATTEMPTS) {
      return {
        success: false,
        statusCode: 429,
        error: 'Too many incorrect OTP attempts. Please request a new reset code.'
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
            : 'Too many incorrect OTP attempts. Please request a new reset code.'
      };
    }

    const user = await User.findOne({ email }).select('_id email').lean();
    if (!user) {
      return { success: false, statusCode: 404, error: 'User account not found.' };
    }

    await PasswordResetOtp.deleteOne({ _id: record._id });
    const resetToken = this.generateResetToken(email, user._id);

    return {
      success: true,
      email,
      resetToken,
      message: 'OTP verified successfully. You can now set a new password.'
    };
  }

  static async resetPassword({ email: emailInput, resetToken, newPassword }) {
    const email = EmailOtpService.normalizeEmail(emailInput);
    if (!EmailOtpService.isValidEmail(email)) {
      return { success: false, statusCode: 400, error: 'Please enter a valid email address.' };
    }

    const passCheck = this.validateNewPassword(newPassword);
    if (!passCheck.valid) {
      return { success: false, statusCode: 400, error: passCheck.error };
    }

    const decoded = this.validateResetToken(resetToken, email);
    if (!decoded) {
      return {
        success: false,
        statusCode: 400,
        error: 'Password reset session expired or invalid. Please request a new OTP.'
      };
    }

    const userDoc = await User.findOne({ email }).select('+password');
    if (!userDoc) {
      return { success: false, statusCode: 404, error: 'User account not found.' };
    }

    if (userDoc.isSuspended || userDoc.status === 'suspended') {
      return {
        success: false,
        statusCode: 403,
        error: 'This account is suspended. Please contact support@visitexpo.in.'
      };
    }

    userDoc.password = newPassword;
    userDoc.hasCustomPassword = true;
    userDoc.refreshTokens = []; // Revoke old refresh sessions after password reset
    await userDoc.save();

    // Non-blocking security confirmation email via Zoho CPaaS
    const notice = buildPasswordChangedNotificationEmail({ name: userDoc.name });
    void EmailOtpService.sendTransactionalEmail({
      toEmail: email,
      toName: userDoc.name,
      subject: notice.subject,
      html: notice.html,
      text: notice.text
    }).catch((err) => {
      console.error('[PasswordResetService] Confirmation email failed:', err.message);
    });

    return {
      success: true,
      message: 'Password reset successfully! You can now sign in with your new password.'
    };
  }
}

export default PasswordResetService;
