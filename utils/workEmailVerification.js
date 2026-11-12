import jwt from 'jsonwebtoken';
import { isCorporateEmail } from './emailValidator.js';

const getVerificationSecret = () => process.env.JWT_SECRET || 'visitexpo_access_key_super_secret';

export const createWorkEmailVerificationToken = (workEmail, accountEmail) => jwt.sign(
  {
    purpose: 'organizer-work-email',
    workEmail: workEmail.toLowerCase().trim(),
    accountEmail: accountEmail.toLowerCase().trim()
  },
  getVerificationSecret(),
  { expiresIn: '15m' }
);

export const verifyWorkEmailVerificationToken = (token, workEmail, accountEmail) => {
  if (!token || !workEmail || !accountEmail) return false;
  try {
    const payload = jwt.verify(token, getVerificationSecret());
    return payload.purpose === 'organizer-work-email' &&
      payload.workEmail === workEmail.toLowerCase().trim() &&
      payload.accountEmail === accountEmail.toLowerCase().trim() &&
      isCorporateEmail(payload.workEmail);
  } catch {
    return false;
  }
};
