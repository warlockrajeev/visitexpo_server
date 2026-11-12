import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import WorkEmailVerification from '../models/WorkEmailVerification.js';
import { sendEmail } from './emailService.js';
import { isCorporateEmail } from '../utils/emailValidator.js';
import { createWorkEmailVerificationToken } from '../utils/workEmailVerification.js';

const EMAIL_PATTERN = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;

const normalizeEmail = (email) => (typeof email === 'string' ? email.toLowerCase().trim() : '');

export const sendWorkEmailVerificationCode = async (workEmailInput, accountEmailInput) => {
  const workEmail = normalizeEmail(workEmailInput);
  const accountEmail = normalizeEmail(accountEmailInput);
  if (workEmail.length > 254 || accountEmail.length > 254 || !EMAIL_PATTERN.test(workEmail) || !EMAIL_PATTERN.test(accountEmail)) {
    const error = new Error('Valid work and account email addresses are required.');
    error.statusCode = 400;
    throw error;
  }
  if (!isCorporateEmail(workEmail)) {
    const error = new Error('Use a business-domain work email to request the organizer fee waiver.');
    error.statusCode = 400;
    throw error;
  }

  const currentVerification = await WorkEmailVerification.findOne({ workEmail, accountEmail });
  if (currentVerification && Date.now() - currentVerification.updatedAt.getTime() < 30_000) {
    const error = new Error('Please wait before requesting another verification code.');
    error.statusCode = 429;
    throw error;
  }

  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  const codeHash = await bcrypt.hash(code, 10);
  await WorkEmailVerification.findOneAndUpdate(
    { workEmail, accountEmail },
    { $set: { codeHash, attempts: 0, expiresAt: new Date(Date.now() + CODE_TTL_MS) } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  const emailResult = await sendEmail({
    to: workEmail,
    subject: 'VisitExpo work email verification code',
    text: `Your VisitExpo verification code is ${code}. It expires in 10 minutes.`,
    html: `<p>Your VisitExpo work email verification code is:</p><p style="font-size:24px;font-weight:bold;letter-spacing:6px">${code}</p><p>This code expires in 10 minutes. If you did not request it, you can ignore this email.</p>`
  });
  if (!emailResult.success) {
    await WorkEmailVerification.deleteOne({ workEmail, accountEmail });
    const error = new Error('Could not send the verification email. Please try again later.');
    error.statusCode = 502;
    throw error;
  }
};

export const verifyWorkEmailCode = async (workEmailInput, accountEmailInput, codeInput) => {
  const workEmail = normalizeEmail(workEmailInput);
  const accountEmail = normalizeEmail(accountEmailInput);
  const code = String(codeInput || '').trim();
  if (
    workEmail.length > 254 ||
    accountEmail.length > 254 ||
    !EMAIL_PATTERN.test(workEmail) ||
    !EMAIL_PATTERN.test(accountEmail) ||
    !isCorporateEmail(workEmail)
  ) {
    const error = new Error('Valid business and account email addresses are required.');
    error.statusCode = 400;
    throw error;
  }
  const verification = await WorkEmailVerification.findOne({ workEmail, accountEmail });

  if (!verification || verification.expiresAt <= new Date()) {
    const error = new Error('The verification code is invalid or expired. Request a new code.');
    error.statusCode = 400;
    throw error;
  }
  if (verification.attempts >= MAX_ATTEMPTS) {
    const error = new Error('Too many incorrect attempts. Request a new verification code.');
    error.statusCode = 429;
    throw error;
  }
  if (!/^\d{6}$/.test(code) || !(await bcrypt.compare(code, verification.codeHash))) {
    verification.attempts += 1;
    await verification.save();
    const error = new Error('The verification code is incorrect.');
    error.statusCode = 400;
    throw error;
  }

  await WorkEmailVerification.deleteOne({ _id: verification._id });
  return createWorkEmailVerificationToken(workEmail, accountEmail);
};
