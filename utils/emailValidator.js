/**
 * @file emailValidator.js
 * @description Utility to differentiate genuine corporate/business email domains from free public/personal
 * or disposable/temporary email services, and verify live corporate mail servers (DNS MX records) without OTP.
 * Corporate domains qualify for 100% Free Organiser plan auto-activation (₹0).
 */

import dns from 'dns';

const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

export const PUBLIC_EMAIL_DOMAINS = new Set([
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
  'zohomail.com',
  'protonmail.com',
  'proton.me',
  'pm.me',
  'aol.com',
  'gmx.com',
  'gmx.net',
  'mail.com',
  'yandex.com',
  'yandex.ru',
  'fastmail.com',
  'tutanota.com',
  'tuta.io',
  'hey.com',
  'inbox.com',
  'mail.ru'
]);

export const DISPOSABLE_OR_PLACEHOLDER_DOMAINS = new Set([
  'mailinator.com',
  'yopmail.com',
  'yopmail.fr',
  'yopmail.net',
  'tempmail.com',
  'temp-mail.org',
  'temp-mail.io',
  '10minutemail.com',
  '10minutemail.net',
  'guerrillamail.com',
  'guerrillamailblock.com',
  'sharklasers.com',
  'grr.la',
  'pokemail.net',
  'trashmail.com',
  'trashmail.net',
  'maildrop.cc',
  'getnada.com',
  'nada.email',
  'fakeinbox.com',
  'dispostable.com',
  'throwawaymail.com',
  'mohmal.com',
  'emailondeck.com',
  'mintemail.com',
  'mailnesia.com',
  'mailcatch.com',
  'burnermail.io',
  'tempmailo.com',
  'crazymailing.com',
  'example.com',
  'example.org',
  'example.net',
  'test.com',
  'test.org',
  'test.in',
  'testing.com',
  'domain.com',
  'company.com',
  'yourcompany.com',
  'business.com',
  'work.com',
  'email.com',
  'sample.com',
  'abc.com',
  'xyz.com',
  'fake.com',
  'none.com',
  'invalid.com',
  'localhost',
  'localdomain'
]);

const PLACEHOLDER_LOCAL_PARTS = new Set([
  'test',
  'testing',
  'fake',
  'dummy',
  'sample',
  'example',
  'none',
  'null',
  'undefined',
  'asdf',
  'qwerty',
  'abc',
  'xyz',
  '123',
  '1234',
  '12345',
  '123456',
  'noemail',
  'user'
]);

/**
 * Synchronous format, public-provider, disposable-domain, and gibberish check for corporate work emails.
 * @param {string} email
 * @returns {{ valid: boolean, error?: string, normalizedEmail?: string, domain?: string }}
 */
export const validateCorporateEmailFormat = (email) => {
  if (!email || typeof email !== 'string') {
    return { valid: false, error: 'Work / Corporate Email is required for Organiser registration.' };
  }

  const normalizedEmail = email.toLowerCase().trim();
  if (!normalizedEmail) {
    return { valid: false, error: 'Work / Corporate Email is required for Organiser registration.' };
  }

  if (normalizedEmail.length > 254 || !EMAIL_REGEX.test(normalizedEmail)) {
    return { valid: false, error: 'Please enter a valid corporate email address (e.g. name@yourcompany.com).' };
  }

  const parts = normalizedEmail.split('@');
  if (parts.length !== 2) {
    return { valid: false, error: 'Please enter a valid corporate email address.' };
  }

  const [localPart, domain] = parts;
  if (!localPart || !domain || !domain.includes('.')) {
    return { valid: false, error: 'Please enter a valid corporate email domain.' };
  }

  if (localPart.startsWith('.') || localPart.endsWith('.') || localPart.includes('..') || domain.includes('..')) {
    return { valid: false, error: 'Please enter a valid corporate email address.' };
  }

  if (PUBLIC_EMAIL_DOMAINS.has(domain)) {
    return {
      valid: false,
      error: `Personal / free email providers (@${domain}) are not allowed for Work Email. Please use your official corporate domain.`
    };
  }

  if (DISPOSABLE_OR_PLACEHOLDER_DOMAINS.has(domain)) {
    return {
      valid: false,
      error: `Disposable or placeholder domains (@${domain}) are not allowed. Please enter a real company work email.`
    };
  }

  const domainLabels = domain.split('.');
  const rootLabel = domainLabels[0] || '';
  const tld = domainLabels[domainLabels.length - 1] || '';

  if (
    rootLabel.length < 2 ||
    tld.length < 2 ||
    /^\d+$/.test(rootLabel) ||
    /^\d+$/.test(tld) ||
    domainLabels.some((lbl) => !lbl || lbl.startsWith('-') || lbl.endsWith('-'))
  ) {
    return {
      valid: false,
      error: 'Please enter a valid corporate domain name.'
    };
  }

  const cleanLocal = localPart.replace(/[^a-z0-9]/g, '');
  if (
    cleanLocal.length < 2 ||
    /^\d+$/.test(cleanLocal) ||
    PLACEHOLDER_LOCAL_PARTS.has(localPart) ||
    PLACEHOLDER_LOCAL_PARTS.has(rootLabel) ||
    (cleanLocal === rootLabel && cleanLocal.length <= 4)
  ) {
    return {
      valid: false,
      error: 'Please enter a genuine corporate work email address (avoid test or placeholder addresses).'
    };
  }

  return {
    valid: true,
    normalizedEmail,
    domain
  };
};

/**
 * Checks whether an email address belongs to a corporate / business domain.
 * @param {string} email
 * @returns {boolean} True if corporate domain, false if free public/disposable/invalid domain.
 */
export const isCorporateEmail = (email) => {
  return validateCorporateEmailFormat(email).valid;
};

/**
 * Returns 'corporate' or 'general' string based on the email domain.
 * @param {string} email
 * @returns {'corporate' | 'general'}
 */
export const getEmailDomainType = (email) => {
  return isCorporateEmail(email) ? 'corporate' : 'general';
};

/**
 * Verifies without OTP that a corporate work email belongs to a genuine, active domain
 * with configured mail servers (DNS MX records).
 * @param {string} email
 * @returns {Promise<{ valid: boolean, error?: string, normalizedEmail?: string, domain?: string, mxRecords?: Array }>}
 */
export const verifyGenuineCorporateWorkEmail = async (email) => {
  const formatCheck = validateCorporateEmailFormat(email);
  if (!formatCheck.valid) {
    return formatCheck;
  }

  const { normalizedEmail, domain } = formatCheck;

  try {
    const mxLookupPromise = dns.promises.resolveMx(domain);
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => {
        const err = new Error('DNS_TIMEOUT');
        err.code = 'DNS_TIMEOUT';
        reject(err);
      }, 3500)
    );

    const mxRecords = await Promise.race([mxLookupPromise, timeoutPromise]);
    const validMx = Array.isArray(mxRecords)
      ? mxRecords.filter(
          (rec) =>
            rec &&
            typeof rec.exchange === 'string' &&
            rec.exchange.trim() !== '' &&
            rec.exchange.trim() !== '.' &&
            rec.exchange.trim().toLowerCase() !== 'localhost' &&
            rec.exchange.trim() !== '0.0.0.0'
        )
      : [];

    if (validMx.length === 0) {
      return {
        valid: false,
        error: `The domain "@${domain}" does not have an active corporate mail server configured. Please enter a genuine work email.`
      };
    }

    return {
      valid: true,
      normalizedEmail,
      domain,
      mxRecords: validMx.sort((a, b) => (a.priority || 0) - (b.priority || 0))
    };
  } catch (err) {
    const code = err?.code || '';
    if (
      code === 'ENOTFOUND' ||
      code === 'ENODATA' ||
      code === 'NXDOMAIN' ||
      code === 'ESERVFAIL' ||
      code === 'EREFUSED' ||
      code === 'EBADNAME'
    ) {
      return {
        valid: false,
        error: `The business domain "@${domain}" could not be verified (no active mail server / MX records found). Please enter a genuine corporate work email.`
      };
    }

    // Fallback: if DNS MX timed out transiently, check if the domain at least resolves to a live A/AAAA IP address
    try {
      const aRecords = await Promise.race([
        dns.promises.resolve4(domain),
        new Promise((_, reject) => setTimeout(() => reject(new Error('A_TIMEOUT')), 2000))
      ]);
      if (Array.isArray(aRecords) && aRecords.length > 0) {
        return {
          valid: true,
          normalizedEmail,
          domain,
          mxRecords: []
        };
      }
    } catch {
      // Domain neither has MX nor A record
    }

    return {
      valid: false,
      error: `Unable to verify corporate domain "@${domain}". Please ensure you entered an active company email address.`
    };
  }
};

export const isUserCorporateEmail = (user) => {
  if (user?.workEmail && isCorporateEmail(user.workEmail)) return true;
  return !user?.workEmailVerificationRequired && isCorporateEmail(user?.email);
};
