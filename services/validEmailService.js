/**
 * @file validEmailService.js
 * @description Server-side email genuineness & deliverability validation via ValidEmail.net API.
 * Keeps VALIDEMAIL_API_KEY strictly on the backend, retries interim Unknown/greylisted verdicts,
 * and caches results in memory to avoid wasting verification credits on repeat checks.
 */

const EMAIL_PATTERN = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const MAX_CACHE_ENTRIES = 5000;
const REQUEST_TIMEOUT_MS = 12000;
const MAX_RETRY_WAIT_SECONDS = 5;

const validationCache = new Map();
const inFlightRequests = new Map();

const sanitizeEnvValue = (val) => {
  let cleaned = String(val || '').trim();
  while (
    (cleaned.startsWith('"') && cleaned.endsWith('"')) ||
    (cleaned.startsWith("'") && cleaned.endsWith("'"))
  ) {
    cleaned = cleaned.slice(1, -1).trim();
  }
  return cleaned.replace(/[\r\n]+/g, '').trim();
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const getCachedResult = (normalizedEmail) => {
  const entry = validationCache.get(normalizedEmail);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    validationCache.delete(normalizedEmail);
    return null;
  }
  return { ...entry.result, cached: true };
};

const setCachedResult = (normalizedEmail, result) => {
  if (validationCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = validationCache.keys().next().value;
    if (oldestKey) validationCache.delete(oldestKey);
  }
  validationCache.set(normalizedEmail, {
    result,
    expiresAt: Date.now() + CACHE_TTL_MS
  });
};

const fetchValidEmailApi = async (email, token) => {
  const url = `https://api.validemail.net/?email=${encodeURIComponent(email)}&token=${encodeURIComponent(token)}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal
    });

    const rawText = await response.text();
    let data = null;
    try {
      data = rawText ? JSON.parse(rawText) : null;
    } catch {
      data = null;
    }

    if (!response.ok || !data || typeof data !== 'object') {
      return {
        ok: false,
        status: response.status,
        error: data?.error || data?.message || rawText || `ValidEmail API HTTP ${response.status}`
      };
    }

    return { ok: true, data };
  } catch (err) {
    return {
      ok: false,
      error: err.name === 'AbortError' ? 'Email validation timed out.' : err.message
    };
  } finally {
    clearTimeout(timeoutId);
  }
};

const interpretValidEmailResponse = (data, normalizedEmail) => {
  const isValidFlag = Boolean(data.IsValid ?? data.isValid);
  const rawScore = data.Score ?? data.score;
  const score = typeof rawScore === 'number' && Number.isFinite(rawScore) ? rawScore : null;
  const state = String(data.State ?? data.state ?? '').trim();
  const reason = String(data.Reason ?? data.reason ?? '').trim();
  const disposable = Boolean(data.Disposable ?? data.disposable);
  const acceptAll = Boolean(data.AcceptAll ?? data.acceptAll);
  const free = Boolean(data.Free ?? data.free);
  const role = Boolean(data.Role ?? data.role);
  const domain = String(data.Domain ?? data.domain ?? normalizedEmail.split('@')[1] ?? '').trim();
  const mxRecord = String(data.MXRecord ?? data.mxRecord ?? '').trim();
  const retryAfterSeconds = Number(data.RetryAfterSeconds ?? data.retryAfterSeconds) || null;

  const baseMeta = {
    email: normalizedEmail,
    score,
    state,
    reason,
    disposable,
    acceptAll,
    free,
    role,
    domain,
    mxRecord,
    cached: false
  };

  if (disposable) {
    return {
      ...baseMeta,
      valid: false,
      error: 'Temporary or disposable email addresses are not allowed. Please enter a genuine email address.'
    };
  }

  const normalizedState = state.toLowerCase();

  // Definitive rejection
  if (normalizedState === 'not deliverable' || isValidFlag === false) {
    // ValidEmail doc: never treat interim Unknown as undeliverable
    if (normalizedState === 'unknown' && mxRecord && (score === null || score >= 60)) {
      return {
        ...baseMeta,
        valid: true,
        message: 'Email domain verified. You can proceed to send OTP.'
      };
    }
    return {
      ...baseMeta,
      valid: false,
      error: 'This email address is not genuine or cannot receive mail. Please enter a valid, active email address.'
    };
  }

  // Recommended Score >= 80 rule for Deliverable emails (allow genuine corporate accept-all domains with Score >= 60)
  if (isValidFlag && (score === null || score >= 80 || (acceptAll && score >= 60))) {
    return {
      ...baseMeta,
      valid: true,
      message: 'Genuine email address verified'
    };
  }

  // Interim Unknown result after retry
  if (normalizedState === 'unknown' && mxRecord) {
    return {
      ...baseMeta,
      valid: true,
      retryAfterSeconds,
      message: 'Email server verified. You can proceed to send OTP.'
    };
  }

  return {
    ...baseMeta,
    valid: false,
    error: 'This email address has a low deliverability score and could not be verified as genuine. Please use another active email address.'
  };
};

export class ValidEmailService {
  static normalizeEmail(email) {
    return typeof email === 'string' ? email.toLowerCase().trim() : '';
  }

  static hasValidSyntax(email) {
    const normalized = this.normalizeEmail(email);
    return normalized.length > 0 && normalized.length <= 254 && EMAIL_PATTERN.test(normalized);
  }

  /**
   * Validate whether an email address is genuine and deliverable via ValidEmail.net API.
   * Uses in-memory cache + in-flight deduplication so each unique email uses at most 1 credit per 30 mins.
   */
  static async validateEmail(emailInput) {
    const email = this.normalizeEmail(emailInput);

    if (!this.hasValidSyntax(email)) {
      return {
        valid: false,
        email,
        error: 'Please enter a valid email address (e.g. name@example.com).'
      };
    }

    const cached = getCachedResult(email);
    if (cached) {
      return cached;
    }

    if (inFlightRequests.has(email)) {
      return inFlightRequests.get(email);
    }

    const apiKey = sanitizeEnvValue(process.env.VALIDEMAIL_API_KEY);
    if (!apiKey) {
      console.warn('[ValidEmailService] VALIDEMAIL_API_KEY is not configured; falling back to syntax check.');
      return {
        valid: true,
        email,
        skipped: true,
        message: 'Email format verified'
      };
    }

    const runValidation = (async () => {
      let apiRes = await fetchValidEmailApi(email, apiKey);

      // Automatic single retry on interim Unknown (PENDING / GREYLISTED) response per ValidEmail guide
      if (apiRes.ok) {
        const initialState = String(apiRes.data?.State ?? apiRes.data?.state ?? '').trim().toLowerCase();
        const retrySec = Number(apiRes.data?.RetryAfterSeconds ?? apiRes.data?.retryAfterSeconds) || 0;
        if (initialState === 'unknown' && retrySec > 0 && retrySec <= MAX_RETRY_WAIT_SECONDS) {
          await sleep(retrySec * 1000);
          const retryRes = await fetchValidEmailApi(email, apiKey);
          if (retryRes.ok) {
            apiRes = retryRes;
          }
        }
      }

      if (!apiRes.ok) {
        console.error(`[ValidEmailService] API error for ${email}:`, apiRes.error);
        return {
          valid: false,
          email,
          serviceError: true,
          error: 'Could not verify email genuineness right now. Please try again in a moment.'
        };
      }

      const verdict = interpretValidEmailResponse(apiRes.data, email);
      // Cache definitive verdicts (don't cache transient Unknown verdicts so next retry can get final result)
      if (String(verdict.state || '').toLowerCase() !== 'unknown') {
        setCachedResult(email, verdict);
      }
      return verdict;
    })();

    inFlightRequests.set(email, runValidation);
    try {
      return await runValidation;
    } finally {
      inFlightRequests.delete(email);
    }
  }
}

export default ValidEmailService;
