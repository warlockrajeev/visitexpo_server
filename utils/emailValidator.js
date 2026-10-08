/**
 * @file emailValidator.js
 * @description Utility to differentiate corporate/business email domains from free public/personal email services.
 * Corporate domains qualify for 100% Free Organizer plan auto-activation (₹0).
 * Public domains (Gmail, Yahoo, Hotmail, etc.) require the ₹1,499 verification charge.
 */

const PUBLIC_EMAIL_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'yahoo.co.in',
  'yahoo.co.uk',
  'yahoo.in',
  'ymail.com',
  'rocketmail.com',
  'hotmail.com',
  'hotmail.co.uk',
  'hotmail.fr',
  'outlook.com',
  'outlook.in',
  'live.com',
  'live.in',
  'msn.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'rediffmail.com',
  'rediff.com',
  'zoho.com',
  'zohomail.in',
  'protonmail.com',
  'proton.me',
  'aol.com',
  'gmx.com',
  'gmx.net',
  'mail.com',
  'yandex.com',
  'yandex.ru',
  'fastmail.com'
]);

/**
 * Checks whether an email address belongs to a corporate / business domain.
 * @param {string} email
 * @returns {boolean} True if corporate domain, false if free public domain.
 */
export const isCorporateEmail = (email) => {
  if (!email || typeof email !== 'string') return false;
  const parts = email.toLowerCase().trim().split('@');
  if (parts.length !== 2) return false;
  const domain = parts[1].trim();
  if (!domain || !domain.includes('.')) return false;
  return !PUBLIC_EMAIL_DOMAINS.has(domain);
};

/**
 * Returns 'corporate' or 'general' string based on the email domain.
 * @param {string} email
 * @returns {'corporate' | 'general'}
 */
export const getEmailDomainType = (email) => {
  return isCorporateEmail(email) ? 'corporate' : 'general';
};
