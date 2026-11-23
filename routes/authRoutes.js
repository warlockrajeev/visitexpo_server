/**
 * @file authRoutes.js
 * @description Production Authentication endpoints with cross-site HttpOnly cookie support.
 */

import express from 'express';
import bcrypt from 'bcryptjs';
import User from '../models/User.js';
import Organization from '../models/Organization.js';
import Subscription from '../models/Subscription.js';
import AuthService from '../services/AuthService.js';
import TwoFactorService from '../services/twoFactorService.js';
import EmailOtpService from '../services/emailOtpService.js';
import ValidEmailService from '../services/validEmailService.js';
import PasswordResetService from '../services/passwordResetService.js';
import { protect } from '../middlewares/auth.js';
import { authLimiter } from '../middlewares/rateLimiter.js';
import jwt from 'jsonwebtoken';
import UserRepository from '../repositories/UserRepository.js';
import { generateAccessToken, generateRefreshToken } from '../utils/jwt.js';
import { isCorporateEmail, isUserCorporateEmail, verifyGenuineCorporateWorkEmail } from '../utils/emailValidator.js';
import { sendWorkEmailVerificationCode, verifyWorkEmailCode } from '../services/workEmailVerificationService.js';
import { resolveUserCompany, syncUserCompanyName } from '../services/companyProfileHelper.js';
import { logUserActivity } from '../utils/activityLogger.js';

const router = express.Router();

// Helper to set refresh token cookie with environment & protocol detection
const setRefreshTokenCookie = (res, token, req) => {
  const origin = req?.get('origin') || '';
  const host = req?.get('host') || '';
  const isLocalhost = host.includes('localhost') || host.includes('127.0.0.1') || origin.includes('localhost') || origin.includes('127.0.0.1');
  const isProduction = !isLocalhost && (process.env.NODE_ENV === 'production' || process.env.RENDER === 'true');
  
  res.cookie('refreshToken', token, {
    httpOnly: true,
    secure: isProduction, // False on localhost HTTP so browser never rejects cookie; True on production HTTPS
    sameSite: isProduction ? 'none' : 'lax', // 'none' for cross-domain production, 'lax' for local development
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
  });
};

// ============================================================================
// MOBILE OTP VERIFICATION ENDPOINTS (2Factor.in)
// ============================================================================

router.post('/otp/send', authLimiter, async (req, res, next) => {
  try {
    const { phone } = req.body;
    if (!phone) {
      return res.status(400).json({ success: false, error: 'Mobile number is required' });
    }

    const result = await TwoFactorService.sendOtp(phone);
    if (!result.success) {
      return res.status(400).json(result);
    }

    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
});

router.post('/otp/verify', authLimiter, async (req, res, next) => {
  try {
    const { sessionId, otp, phone } = req.body;
    if (!sessionId || !otp) {
      return res.status(400).json({ success: false, error: 'Session ID and OTP code are required' });
    }

    const result = await TwoFactorService.verifyOtp(sessionId, otp, phone);
    if (!result.success) {
      return res.status(400).json(result);
    }

    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
});

router.post('/foreign-phone/verify-location', async (req, res) => {
  try {
    const { phone, lat, lng, city, countryCode, countryName } = req.body;
    const rawPhone = String(phone || '').trim();
    const digits = rawPhone.replace(/\D/g, '');

    if (!digits || digits.length < 7 || digits.length > 15) {
      return res.status(400).json({
        success: false,
        error: 'Please enter a valid international WhatsApp mobile number with country code (7 to 15 digits).'
      });
    }

    if (TwoFactorService.isIndianPhoneInput(rawPhone)) {
      return res.status(400).json({
        success: false,
        isIndia: true,
        error: 'Indian (+91) mobile numbers must be verified using the Indian Mobile Number OTP field above.'
      });
    }

    const numLat = Number(lat);
    const numLng = Number(lng);
    if (!Number.isFinite(numLat) || !Number.isFinite(numLng)) {
      return res.status(400).json({
        success: false,
        error: 'Live GPS coordinates are required to verify foreign location.'
      });
    }

    const normalizedCode = String(countryCode || '').trim().toUpperCase();
    const normalizedCountry = String(countryName || '').trim();
    const normalizedCity = String(city || '').trim();

    const isInsideIndiaBounds =
      numLat >= 6.5 && numLat <= 37.1 && numLng >= 68.1 && numLng <= 97.4;

    const isIndiaCountry =
      normalizedCode === 'IN' ||
      normalizedCode === 'IND' ||
      /\bindia\b|भारत/i.test(normalizedCountry) ||
      /\bindia\b|भारत/i.test(normalizedCity) ||
      (!normalizedCode && isInsideIndiaBounds);

    if (isIndiaCountry) {
      return res.status(400).json({
        success: false,
        isIndia: true,
        location: normalizedCity || normalizedCountry || 'India',
        error: `Live location detected in India (${normalizedCity || 'India'}). Foreign WhatsApp registration is only permitted for users outside India. Please use the Indian Mobile Number (+91) field with OTP verification.`
      });
    }

    const cleanForeign = TwoFactorService.cleanForeignPhoneNumber(rawPhone);
    const resolvedLocation =
      normalizedCity ||
      [normalizedCountry].filter(Boolean).join(', ') ||
      `${numLat.toFixed(3)}, ${numLng.toFixed(3)}`;

    const verificationToken = TwoFactorService.generateForeignLocationToken({
      phone: cleanForeign,
      countryCode: normalizedCode || 'FOREIGN',
      countryName: normalizedCountry,
      location: resolvedLocation
    });

    return res.status(200).json({
      success: true,
      isForeign: true,
      phone: cleanForeign,
      location: resolvedLocation,
      countryCode: normalizedCode,
      countryName: normalizedCountry,
      verificationToken,
      message: `Foreign location verified (${resolvedLocation})`
    });
  } catch {
    return res.status(500).json({
      success: false,
      error: 'Could not verify live location right now. Please try again.'
    });
  }
});

router.post('/work-email/validate', async (req, res) => {
  try {
    const { workEmail, excludeUserId } = req.body;
    const check = await verifyGenuineCorporateWorkEmail(workEmail);
    if (!check.valid) {
      return res.status(400).json({
        success: false,
        valid: false,
        error: check.error
      });
    }

    const dupFilter = { workEmail: check.normalizedEmail };
    if (excludeUserId && /^[a-fA-F0-9]{24}$/.test(String(excludeUserId))) {
      dupFilter._id = { $ne: excludeUserId };
    }
    const existingWorkUser = await User.findOne(dupFilter).select('_id').lean();
    if (existingWorkUser) {
      return res.status(409).json({
        success: false,
        valid: false,
        error: 'This Work / Corporate Email is already registered with another Organiser account.'
      });
    }

    return res.status(200).json({
      success: true,
      valid: true,
      normalizedEmail: check.normalizedEmail,
      domain: check.domain,
      message: `Verified corporate domain (@${check.domain})`
    });
  } catch {
    return res.status(500).json({
      success: false,
      valid: false,
      error: 'Could not verify corporate email domain right now.'
    });
  }
});

router.post('/work-email/send', authLimiter, async (req, res, next) => {
  try {
    const { workEmail, accountEmail } = req.body;
    await sendWorkEmailVerificationCode(workEmail, accountEmail);
    res.status(200).json({ success: true, message: 'Verification code sent.' });
  } catch (error) {
    next(error);
  }
});

router.post('/work-email/verify', authLimiter, async (req, res, next) => {
  try {
    const { workEmail, accountEmail, code } = req.body;
    const verificationToken = await verifyWorkEmailCode(workEmail, accountEmail, code);
    res.status(200).json({ success: true, verificationToken });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// REGISTRATION EMAIL OTP VERIFICATION ENDPOINTS (ValidEmail + Zoho CPaaS)
// ============================================================================

router.post('/email-otp/validate', async (req, res, next) => {
  try {
    const { email, checkDuplicate = true } = req.body || {};
    const normalizedEmail = ValidEmailService.normalizeEmail(email);

    if (!ValidEmailService.hasValidSyntax(normalizedEmail)) {
      return res.status(400).json({
        success: false,
        valid: false,
        error: 'Please enter a valid email address (e.g. name@example.com).'
      });
    }

    // Check duplicate before spending a ValidEmail credit
    if (checkDuplicate !== false) {
      const existingUser = await User.findOne({ email: normalizedEmail }).select('role').lean();
      if (existingUser) {
        const r = String(existingUser.role || '').toLowerCase();
        const roleLabel =
          r === 'organizer'
            ? 'Organiser'
            : r === 'exhibitor'
            ? 'Exhibitor'
            : r === 'visitor'
            ? 'Visitor'
            : r === 'super_admin' || r === 'admin'
            ? 'Administrator'
            : 'User';
        return res.status(409).json({
          success: false,
          valid: false,
          alreadyRegistered: true,
          registeredRole: existingUser.role,
          error: `This email address is already registered as an ${roleLabel}. Please switch to the ${roleLabel} tab to sign in.`
        });
      }
    }

    const result = await ValidEmailService.validateEmail(normalizedEmail);
    if (!result.valid) {
      return res.status(result.serviceError ? 503 : 400).json({
        success: false,
        valid: false,
        email: normalizedEmail,
        score: result.score ?? null,
        state: result.state || '',
        reason: result.reason || '',
        disposable: Boolean(result.disposable),
        error: result.error || 'Please enter a genuine, deliverable email address.'
      });
    }

    return res.status(200).json({
      success: true,
      valid: true,
      email: normalizedEmail,
      score: result.score ?? null,
      state: result.state || 'Deliverable',
      reason: result.reason || '',
      disposable: false,
      domain: result.domain || '',
      cached: Boolean(result.cached),
      message: result.message || 'Genuine email address verified'
    });
  } catch (error) {
    next(error);
  }
});

router.post('/email-otp/send', authLimiter, async (req, res, next) => {
  try {
    const { email, name } = req.body;
    if (!email || !String(email).trim()) {
      return res.status(400).json({ success: false, error: 'Email address is required' });
    }

    const result = await EmailOtpService.sendRegistrationEmailOtp(email, name);
    if (!result.success) {
      return res.status(result.statusCode || 400).json({
        success: false,
        error: result.error,
        registeredRole: result.registeredRole
      });
    }

    return res.status(200).json(result);
  } catch (error) {
    next(error);
  }
});

router.post('/email-otp/verify', authLimiter, async (req, res, next) => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp) {
      return res.status(400).json({ success: false, error: 'Email address and 6-digit OTP code are required' });
    }

    const result = await EmailOtpService.verifyRegistrationEmailOtp(email, otp);
    if (!result.success) {
      return res.status(result.statusCode || 400).json({
        success: false,
        error: result.error
      });
    }

    return res.status(200).json(result);
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// FORGOT PASSWORD / PASSWORD RESET ENDPOINTS (Zoho CPaaS Email OTP)
// ============================================================================

router.post('/forgot-password/send', authLimiter, async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email || !String(email).trim()) {
      return res.status(400).json({ success: false, error: 'Email address is required' });
    }

    const result = await PasswordResetService.sendPasswordResetOtp(email);
    if (!result.success) {
      return res.status(result.statusCode || 400).json({
        success: false,
        error: result.error
      });
    }

    return res.status(200).json(result);
  } catch (error) {
    next(error);
  }
});

router.post('/forgot-password/verify', authLimiter, async (req, res, next) => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp) {
      return res.status(400).json({ success: false, error: 'Email address and 6-digit OTP code are required' });
    }

    const result = await PasswordResetService.verifyPasswordResetOtp(email, otp);
    if (!result.success) {
      return res.status(result.statusCode || 400).json({
        success: false,
        error: result.error
      });
    }

    return res.status(200).json(result);
  } catch (error) {
    next(error);
  }
});

router.post('/forgot-password/reset', authLimiter, async (req, res, next) => {
  try {
    const { email, resetToken, newPassword } = req.body;
    if (!email || !resetToken || !newPassword) {
      return res.status(400).json({ success: false, error: 'Email, reset token, and new password are required' });
    }

    const result = await PasswordResetService.resetPassword({ email, resetToken, newPassword });
    if (!result.success) {
      return res.status(result.statusCode || 400).json({
        success: false,
        error: result.error
      });
    }

    return res.status(200).json(result);
  } catch (error) {
    next(error);
  }
});

router.post('/signup', authLimiter, async (req, res, next) => {
  try {
    const { name, email, password, organizationName, role, phone, city, interests, phoneVerificationToken, emailVerificationToken, otpSessionId, otp, workEmail } = req.body;
    
    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, error: 'Full Name is required' });
    }
    if (!email || !email.trim()) {
      return res.status(400).json({ success: false, error: 'Email address is required' });
    }
    if (!password || password.length < 6) {
      return res.status(400).json({ success: false, error: 'Password must be at least 6 characters long' });
    }
    if (!city || !city.trim()) {
      return res.status(400).json({ success: false, error: 'City / Location is required' });
    }
    const resolvedOrgName = (organizationName || req.body?.company || '').trim();
    if (!resolvedOrgName || resolvedOrgName.length < 2) {
      return res.status(400).json({
        success: false,
        error:
          role === 'visitor'
            ? 'Company / Organization Name is required (minimum 2 characters).'
            : role === 'exhibitor'
            ? 'Company / Exhibitor Name is required'
            : 'Organization Name is required'
      });
    }
    if (role === 'visitor' && (!Array.isArray(interests) || !interests.some((interest) => typeof interest === 'string' && interest.trim()))) {
      return res.status(400).json({ success: false, error: 'Please select a visitor category.' });
    }
    if ((!role || role === 'organizer') && (!workEmail || !String(workEmail).trim())) {
      return res.status(400).json({
        success: false,
        error: 'Work / Corporate Email is mandatory for Organiser registration.'
      });
    }

    const data = await AuthService.signup(name, email, password, resolvedOrgName, role, phone, city, phoneVerificationToken, otpSessionId, otp, interests, workEmail, emailVerificationToken);
    
    // Set refresh token cookie
    setRefreshTokenCookie(res, data.refreshToken, req);

    void logUserActivity({
      req,
      user: data.user,
      activityType: 'auth',
      category: 'auth',
      actionLabel: `Registered ${String(data.user?.role || role || 'visitor').replace('_', ' ')} Account`,
      description: `${data.user?.name || name} (${data.user?.email || email}) completed account registration.`,
      pagePath: '/login',
      formInfo: {
        formName: 'Registration Signup Form',
        status: 'submitted',
        fieldsSummary: {
          name: data.user?.name || name,
          email: data.user?.email || email,
          role: data.user?.role || role,
          company: resolvedOrgName,
          city
        }
      },
      source: 'server_hook'
    });

    res.status(201).json({
      success: true,
      message: 'Registration successful',
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      user: data.user
    });
  } catch (error) {
    next(error);
  }
});

router.post('/login', authLimiter, async (req, res, next) => {
  try {
    const { email, password, role } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Email and password are required' });
    }

    const data = await AuthService.login(email, password, role);

    // Set refresh token cookie
    setRefreshTokenCookie(res, data.refreshToken, req);

    void logUserActivity({
      req,
      user: data.user,
      activityType: 'auth',
      category: 'auth',
      actionLabel: `Logged In (${String(data.user?.role || role || 'user').replace('_', ' ')})`,
      description: `${data.user?.name || email} logged into the platform.`,
      pagePath: '/login',
      formInfo: {
        formName: 'User Login Form',
        status: 'submitted',
        fieldsSummary: {
          email: data.user?.email || email,
          role: data.user?.role || role
        }
      },
      source: 'server_hook'
    });

    res.status(200).json({
      success: true,
      message: 'Login successful',
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      user: data.user
    });
  } catch (error) {
    next(error);
  }
});

// Check if user exists and whether they have completed organizer/exhibitor profile
router.post('/google/check', authLimiter, async (req, res, next) => {
  try {
    const { email, role } = req.body;
    if (!email) {
      return res.status(400).json({ success: false, error: 'Google email is required' });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const user = await User.findOne({ email: normalizedEmail }).populate('organization');
    if (!user) {
      return res.status(200).json({ success: true, exists: false, hasDetails: false });
    }

    // Role mismatch check for Google pre-check
    const assignedRole = role === 'visitor' ? 'visitor' : role === 'exhibitor' ? 'exhibitor' : 'organizer';
    const existingRole = user.role || 'organizer';

    if (role && existingRole !== assignedRole) {
      const getRoleLabel = (r) => {
        if (!r) return 'User';
        const str = r.toLowerCase();
        if (str === 'organizer') return 'Organizer';
        if (str === 'exhibitor') return 'Exhibitor';
        if (str === 'visitor') return 'Visitor';
        if (str === 'super_admin' || str === 'admin') return 'Administrator';
        return r.charAt(0).toUpperCase() + r.slice(1);
      };
      const existingLabel = getRoleLabel(existingRole);
      return res.status(409).json({
        success: false,
        error: `This Google account (${normalizedEmail}) is already registered as an ${existingLabel}. Please switch to the ${existingLabel} tab to sign in.`,
        registeredRole: existingRole,
        exists: true
      });
    }

    // A user has complete details if:
    // - Has phone registered and verified (mandatory for all roles)
    // - For visitor: has verified phone
    // - For organizer: has verified phone and an explicit organization
    // - For exhibitor: has verified phone and company/organization set
    const hasOrg = !!(user.organization && user.organization.name && !user.organization.name.includes("'s Organization"));
    const hasPhone = !!user.phone && user.isPhoneVerified !== false;
    const hasDetails = hasPhone && (hasOrg || !!user.company);

    return res.status(200).json({
      success: true,
      exists: true,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        hasDetails,
        organizationName: user.organization?.name || user.company || '',
        phone: user.phone || user.organization?.contact?.phone || '',
        city: user.city || user.organization?.address?.city || ''
      }
    });
  } catch (error) {
    next(error);
  }
});

router.post('/google', authLimiter, async (req, res, next) => {
  try {
    const {
      email,
      name,
      photoURL,
      uid,
      idToken,
      role,
      organizationName,
      phone,
      city,
      website,
      company,
      designation,
      industry,
      interests,
      phoneVerificationToken,
      otpSessionId,
      otp,
      workEmail
    } = req.body;

    if (!email) {
      return res.status(400).json({ success: false, error: 'Google email is required' });
    }

    const data = await AuthService.googleAuth({
      email,
      name,
      photoURL,
      uid,
      idToken,
      role,
      organizationName,
      phone,
      city,
      website,
      company,
      designation,
      industry,
      interests,
      phoneVerificationToken,
      otpSessionId,
      otp,
      workEmail
    });

    // Set refresh token cookie
    setRefreshTokenCookie(res, data.refreshToken, req);

    void logUserActivity({
      req,
      user: data.user,
      activityType: 'auth',
      category: 'auth',
      actionLabel: `Logged In (${String(data.user?.role || role || 'user').replace('_', ' ')})`,
      description: `${data.user?.name || email} logged into the platform.`,
      pagePath: '/login',
      formInfo: {
        formName: 'User Login Form',
        status: 'submitted',
        fieldsSummary: {
          email: data.user?.email || email,
          role: data.user?.role || role
        }
      },
      source: 'server_hook'
    });

    res.status(200).json({
      success: true,
      message: 'Google login successful',
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      user: data.user
    });
  } catch (error) {
    next(error);
  }
});

router.post('/refresh', async (req, res, next) => {
  try {
    // Look up token in cookies or request body
    const token = req.cookies?.refreshToken || req.body?.refreshToken;

    if (!token) {
      return res.status(401).json({ success: false, error: 'Refresh token is missing' });
    }

    const data = await AuthService.refresh(token);

    // Set new refresh token cookie
    setRefreshTokenCookie(res, data.refreshToken, req);

    res.status(200).json({
      success: true,
      accessToken: data.accessToken,
      refreshToken: data.refreshToken
    });
  } catch (error) {
    next(error);
  }
});

router.post('/logout', protect, async (req, res, next) => {
  try {
    const token = req.cookies?.refreshToken || req.body?.refreshToken;
    
    if (token) {
      await AuthService.logout(req.user.id, token);
    }

    const origin = req?.get('origin') || '';
    const host = req?.get('host') || '';
    const isLocalhost = host.includes('localhost') || host.includes('127.0.0.1') || origin.includes('localhost') || origin.includes('127.0.0.1');
    const isProduction = !isLocalhost && (process.env.NODE_ENV === 'production' || process.env.RENDER === 'true');
    res.clearCookie('refreshToken', {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? 'none' : 'lax'
    });
    
    res.status(200).json({ success: true, message: 'Logged out successfully' });
  } catch (error) {
    next(error);
  }
});

// Get currently logged in user profile
router.get('/me', protect, async (req, res, next) => {
  try {
    const userDoc = await User.findById(req.user.id).select('-password').populate('organization');
    if (!userDoc) {
      return res.status(404).json({ success: false, error: 'User profile not found' });
    }

    if (!userDoc.isVerified) {
      userDoc.isVerified = true;
      await userDoc.save();
    }

    // Auto-sync corporate email plan activation & active subscription for organizers
    let activeSub = null;
    let hasGrowthPlan = false;
    if (userDoc.role === 'organizer') {
      const orgId = userDoc.organization?._id || userDoc.organization;

      // Find active BASE plan subscription (excluding Growth add-on)
      activeSub = await Subscription.findOne({
        $or: [
          ...(orgId ? [{ organization: orgId }] : []),
          { user: userDoc._id }
        ],
        plan: { $ne: 'growth' },
        status: 'active'
      }).sort({ createdAt: -1 });

      // Check if organizer also has an active Growth plan add-on
      const hasGrowthSub = await Subscription.exists({
        $or: [
          ...(orgId ? [{ organization: orgId }] : []),
          { user: userDoc._id }
        ],
        plan: 'growth',
        status: 'active',
        endDate: { $gt: new Date() }
      });
      hasGrowthPlan = Boolean(hasGrowthSub);

      let needsSave = false;
      const isCorporate = isUserCorporateEmail(userDoc);
      if (!userDoc.emailType) {
        userDoc.emailType = isCorporate ? 'corporate' : 'general';
        needsSave = true;
      }

      if (userDoc.hasGrowthPlan !== hasGrowthPlan) {
        userDoc.hasGrowthPlan = hasGrowthPlan;
        needsSave = true;
      }

      // If userDoc.plan was mistakenly set to 'growth', restore it to base plan
      if (userDoc.plan === 'growth') {
        userDoc.plan = activeSub?.plan || 'enterprise';
        needsSave = true;
      }

      if (activeSub && activeSub.plan && activeSub.plan !== 'growth') {
        if (userDoc.plan !== activeSub.plan || !userDoc.isPlanActive || !userDoc.isVerified) {
          userDoc.plan = activeSub.plan;
          userDoc.planStatus = 'active';
          userDoc.isPlanActive = true;
          userDoc.isVerified = true;
          needsSave = true;
        }
      } else if (['enterprise', 'starter'].includes(userDoc.plan)) {
        if (!userDoc.isPlanActive || !userDoc.isVerified) {
          userDoc.isPlanActive = true;
          userDoc.isVerified = true;
          userDoc.planStatus = 'active';
          needsSave = true;
        }
      } else if (isCorporate && (!userDoc.isPlanActive || !userDoc.isVerified)) {
        userDoc.isVerified = true;
        userDoc.plan = 'free';
        userDoc.planStatus = 'active';
        userDoc.isPlanActive = true;
        userDoc.planPaidAmount = 0;
        needsSave = true;
      }

      if (needsSave) {
        await userDoc.save();
      }
    } else {
      hasGrowthPlan = Boolean(userDoc.hasGrowthPlan);
    }

    const resolvedBasePlan = (activeSub?.plan && activeSub.plan !== 'growth')
      ? activeSub.plan
      : (userDoc.plan && userDoc.plan !== 'growth' ? userDoc.plan : 'free');

    const isPaidOrganizer = ['enterprise', 'starter'].includes(resolvedBasePlan);
    const isPlanActive = isPaidOrganizer ? true : (activeSub ? activeSub.status === 'active' : (userDoc.isPlanActive ?? true));
    const isVerified = isPaidOrganizer ? true : Boolean(userDoc.isVerified);

    const resolvedCompany = await resolveUserCompany(userDoc);

    res.status(200).json({
      success: true,
      user: {
        id: userDoc._id,
        name: userDoc.name,
        email: userDoc.email,
        phone: userDoc.phone || '',
        company: resolvedCompany || userDoc.company || '',
        designation: userDoc.designation || '',
        city: userDoc.city || '',
        workEmail: userDoc.workEmail || '',
        workEmailVerified: !!userDoc.workEmailVerified,
        workEmailVerificationRequired: !!userDoc.workEmailVerificationRequired,
        role: userDoc.role,
        adminRole: userDoc.adminRole || '',
        permissions: userDoc.permissions || [],
        isVerified,
        emailType: userDoc.emailType || (isUserCorporateEmail(userDoc) ? 'corporate' : 'general'),
        plan: resolvedBasePlan,
        basePlan: resolvedBasePlan,
        planStatus: userDoc.planStatus || (isPlanActive ? 'active' : 'payment_pending'),
        isPlanActive,
        hasGrowthPlan,
        subscription: activeSub,
        planPaidAmount: activeSub?.price !== undefined ? activeSub.price : (userDoc.planPaidAmount || 0),
        credits: userDoc.credits !== undefined ? userDoc.credits : 100,
        avatar: userDoc.avatar || userDoc.photoURL || '',
        photoURL: userDoc.avatar || userDoc.photoURL || '',
        organization: userDoc.organization,
        isChatEnabled: !!userDoc.isChatEnabled,
        chatStatus: userDoc.chatStatus || 'offline',
        chatWelcomeMessage: userDoc.chatWelcomeMessage || 'Hello! Welcome to our exhibition desk. How can we assist you today?',
        chatAutoReply: userDoc.chatAutoReply !== false,
        authProvider: userDoc.authProvider || 'local',
        hasCustomPassword: userDoc.hasCustomPassword !== undefined ? userDoc.hasCustomPassword : (userDoc.authProvider !== 'google')
      }
    });
  } catch (error) {
    next(error);
  }
});

// Update Organization / Brand Profile
router.put('/organization', protect, async (req, res, next) => {
  try {
    const userDoc = await User.findById(req.user.id);
    if (!userDoc) return res.status(404).json({ success: false, error: 'User not found' });

    let org;
    if (userDoc.organization) {
      org = await Organization.findById(userDoc.organization);
    }

    if (!org) {
      org = new Organization({
        name: req.body.name || `${userDoc.name}'s Organization`,
        teamMembers: [{ user: userDoc._id, role: userDoc.role || 'organizer' }]
      });
      userDoc.organization = org._id;
      await userDoc.save();
    }

    const { name, logo, website, phone, email, address, gst, description, socialLinkedIn, socialFacebook, socialInstagram, socialX, phoneVerificationToken } = req.body;

    // Mobile Number Change Check with OTP Verification
    if (phone !== undefined) {
      const cleanNewPhone = TwoFactorService.cleanPhoneNumber(phone);
      const currentOrgPhone = TwoFactorService.cleanPhoneNumber(org.contact?.phone || '');
      const currentUserPhone = TwoFactorService.cleanPhoneNumber(userDoc.phone || '');

      if (cleanNewPhone && (cleanNewPhone !== currentOrgPhone || cleanNewPhone !== currentUserPhone)) {
        if (!phoneVerificationToken || !TwoFactorService.validateVerificationToken(phoneVerificationToken, cleanNewPhone)) {
          return res.status(400).json({
            success: false,
            error: 'Mobile number was modified. Please verify with OTP before saving.'
          });
        }
        userDoc.phone = cleanNewPhone;
        userDoc.isPhoneVerified = true;
        await userDoc.save();
      }
    }

    if (name) {
      org.name = name;
      userDoc.company = String(name).trim();
      await userDoc.save();
    }
    if (logo !== undefined) org.logo = logo;
    if (website !== undefined) org.website = website;
    if (gst !== undefined) org.gst = gst;
    if (description !== undefined) org.description = description;
    if (phone !== undefined || email !== undefined) {
      const cleanPhone = phone !== undefined ? TwoFactorService.cleanPhoneNumber(phone) : org.contact?.phone;
      org.contact = {
        ...org.contact,
        phone: cleanPhone,
        email: email !== undefined ? email : org.contact?.email
      };
    }
    if (address !== undefined) {
      if (typeof address === 'string') {
        org.address = { ...org.address, street: address };
      } else if (typeof address === 'object') {
        org.address = { ...org.address, ...address };
      }
    }
    if (socialLinkedIn !== undefined || socialFacebook !== undefined || socialInstagram !== undefined || socialX !== undefined) {
      org.social = {
        linkedIn: socialLinkedIn || '',
        facebook: socialFacebook || '',
        instagram: socialInstagram || '',
        x: socialX || ''
      };
    }

    await org.save();

    const updatedUser = await User.findById(userDoc._id).select('-password').populate('organization');

    res.status(200).json({
      success: true,
      message: 'Organizer profile updated successfully',
      organization: org,
      user: {
        id: updatedUser._id,
        name: updatedUser.name,
        email: updatedUser.email,
        workEmail: updatedUser.workEmail || '',
        workEmailVerified: !!updatedUser.workEmailVerified,
        workEmailVerificationRequired: !!updatedUser.workEmailVerificationRequired,
        emailType: updatedUser.emailType || (isUserCorporateEmail(updatedUser) ? 'corporate' : 'general'),
        phone: updatedUser.phone || '',
        role: updatedUser.role,
        isVerified: updatedUser.isVerified,
        isPhoneVerified: updatedUser.isPhoneVerified !== false,
        plan: updatedUser.plan || 'free',
        basePlan: updatedUser.plan || 'free',
        planStatus: updatedUser.planStatus || (updatedUser.isPlanActive ? 'active' : 'payment_pending'),
        isPlanActive: !!updatedUser.isPlanActive,
        hasGrowthPlan: Boolean(updatedUser.hasGrowthPlan || updatedUser.plan === 'growth'),
        planPaidAmount: updatedUser.planPaidAmount || 0,
        credits: updatedUser.credits !== undefined ? updatedUser.credits : 100,
        organization: updatedUser.organization,
        authProvider: updatedUser.authProvider || 'local',
        hasCustomPassword: updatedUser.hasCustomPassword !== undefined ? updatedUser.hasCustomPassword : (updatedUser.authProvider !== 'google')
      }
    });
  } catch (error) {
    next(error);
  }
});

// Update Account Profile details (name, email, workEmail, phone, company, designation, city, avatar)
router.put('/profile', protect, async (req, res, next) => {
  try {
    const { name, email, workEmail, phone, company, designation, city, avatar, photoURL, phoneVerificationToken } = req.body;
    const userDoc = await User.findById(req.user.id);
    if (!userDoc) {
      return res.status(404).json({ success: false, error: 'User account not found' });
    }

    // Mobile Number Change Check with OTP Verification
    if (phone !== undefined) {
      const cleanNewPhone = TwoFactorService.cleanPhoneNumber(phone);
      const currentUserPhone = TwoFactorService.cleanPhoneNumber(userDoc.phone || '');

      if (cleanNewPhone && cleanNewPhone !== currentUserPhone) {
        if (!phoneVerificationToken || !TwoFactorService.validateVerificationToken(phoneVerificationToken, cleanNewPhone)) {
          return res.status(400).json({
            success: false,
            error: 'Mobile number was modified. Please verify with OTP before saving.'
          });
        }
        userDoc.phone = cleanNewPhone;
        userDoc.isPhoneVerified = true;

        // Also synchronize with organization contact if present
        if (userDoc.organization) {
          await Organization.findByIdAndUpdate(userDoc.organization, {
            'contact.phone': cleanNewPhone
          });
        }
      }
    }

    if (name) userDoc.name = name;
    if (company !== undefined) userDoc.company = company;
    if (designation !== undefined) userDoc.designation = designation;
    if (city !== undefined) userDoc.city = city;

    if (avatar !== undefined) {
      userDoc.avatar = avatar;
      userDoc.photoURL = avatar;
    } else if (photoURL !== undefined) {
      userDoc.avatar = photoURL;
      userDoc.photoURL = photoURL;
    }

    if (email && email.toLowerCase() !== userDoc.email.toLowerCase()) {
      const existingUser = await User.findOne({ email: email.toLowerCase() });
      if (existingUser && existingUser._id.toString() !== userDoc._id.toString()) {
        return res.status(400).json({ success: false, error: 'Email address is already in use' });
      }
      userDoc.email = email.toLowerCase();
    }

    if (workEmail !== undefined) {
      const normalizedWorkEmail = typeof workEmail === 'string' ? workEmail.toLowerCase().trim() : '';
      if (normalizedWorkEmail) {
        const workCheck = await verifyGenuineCorporateWorkEmail(normalizedWorkEmail);
        if (!workCheck.valid) {
          return res.status(400).json({
            success: false,
            error: workCheck.error || 'Please enter a genuine corporate work email address.'
          });
        }
        const duplicateWork = await User.findOne({
          _id: { $ne: userDoc._id },
          workEmail: normalizedWorkEmail
        }).select('_id').lean();
        if (duplicateWork) {
          return res.status(409).json({
            success: false,
            error: 'This Work / Corporate Email is already registered with another Organiser account.'
          });
        }
        userDoc.workEmail = normalizedWorkEmail;
        userDoc.workEmailVerified = true;
        userDoc.workEmailVerificationRequired = false;
        userDoc.emailType = 'corporate';
        if (userDoc.role === 'organizer') {
          userDoc.isVerified = true;
          userDoc.isPlanActive = true;
          if (!userDoc.planStatus || userDoc.planStatus === 'payment_pending') {
            userDoc.planStatus = 'active';
          }
          const orgId = userDoc.organization?._id || userDoc.organization;
          await Subscription.updateMany(
            {
              $or: [...(orgId ? [{ organization: orgId }] : []), { user: userDoc._id }],
              status: 'payment_pending'
            },
            { $set: { status: 'active', price: 0, emailType: 'corporate' } }
          );
        }
      } else {
        if (userDoc.role === 'organizer' && userDoc.workEmail) {
          return res.status(400).json({
            success: false,
            error: 'Work / Corporate Email is mandatory for Organiser accounts and cannot be cleared.'
          });
        }
        userDoc.workEmail = '';
        userDoc.workEmailVerified = false;
        userDoc.emailType = isCorporateEmail(userDoc.email) ? 'corporate' : 'general';
        userDoc.workEmailVerificationRequired = false;
      }
    }

    await userDoc.save();

    if (company !== undefined && String(company).trim().length >= 2) {
      await syncUserCompanyName(userDoc._id, company);
    }

    const updatedUser = await User.findById(userDoc._id).select('-password').populate('organization');
    const resolvedCompany = await resolveUserCompany(updatedUser);

    res.status(200).json({
      success: true,
      message: 'Account details updated successfully!',
      user: {
        id: updatedUser._id,
        name: updatedUser.name,
        email: updatedUser.email,
        workEmail: updatedUser.workEmail || '',
        workEmailVerified: !!updatedUser.workEmailVerified,
        workEmailVerificationRequired: !!updatedUser.workEmailVerificationRequired,
        emailType: updatedUser.emailType || (isUserCorporateEmail(updatedUser) ? 'corporate' : 'general'),
        phone: updatedUser.phone || '',
        company: resolvedCompany || updatedUser.company || '',
        designation: updatedUser.designation || '',
        city: updatedUser.city || '',
        avatar: updatedUser.avatar || updatedUser.photoURL || '',
        photoURL: updatedUser.avatar || updatedUser.photoURL || '',
        role: updatedUser.role,
        isVerified: updatedUser.isVerified,
        isPhoneVerified: updatedUser.isPhoneVerified !== false,
        plan: updatedUser.plan || 'free',
        basePlan: updatedUser.plan || 'free',
        planStatus: updatedUser.planStatus || (updatedUser.isPlanActive ? 'active' : 'payment_pending'),
        isPlanActive: !!updatedUser.isPlanActive,
        hasGrowthPlan: Boolean(updatedUser.hasGrowthPlan || updatedUser.plan === 'growth'),
        planPaidAmount: updatedUser.planPaidAmount || 0,
        credits: updatedUser.credits !== undefined ? updatedUser.credits : 100,
        organization: updatedUser.organization,
        authProvider: updatedUser.authProvider || 'local',
        hasCustomPassword: updatedUser.hasCustomPassword !== undefined ? updatedUser.hasCustomPassword : (updatedUser.authProvider !== 'google')
      }
    });
  } catch (error) {
    next(error);
  }
});

// Update Security & Password Credentials
router.put('/change-password', protect, async (req, res, next) => {
  try {
    const { currentPassword, newPassword, resetToken } = req.body;

    const passCheck = PasswordResetService.validateNewPassword(newPassword);
    if (!passCheck.valid) {
      return res.status(400).json({ success: false, error: passCheck.error });
    }

    const userDoc = await User.findById(req.user.id).select('+password');
    if (!userDoc) {
      return res.status(404).json({ success: false, error: 'User account not found' });
    }

    const isGoogleWithoutPassword = (userDoc.authProvider === 'google' && !userDoc.hasCustomPassword);
    const isVerifiedViaEmailOtp = Boolean(
      resetToken && PasswordResetService.validateResetToken(resetToken, userDoc.email)
    );

    if (!isGoogleWithoutPassword && !isVerifiedViaEmailOtp) {
      if (!currentPassword) {
        return res.status(400).json({ success: false, error: 'Current password is required to change password' });
      }

      const isMatch = await bcrypt.compare(currentPassword, userDoc.password);
      if (!isMatch) {
        return res.status(400).json({ success: false, error: 'Current password does not match' });
      }

      if (currentPassword === newPassword) {
        return res.status(400).json({ success: false, error: 'New password cannot be the same as current password' });
      }
    }

    // Set new password (will be automatically hashed by UserSchema pre-save hook)
    userDoc.password = newPassword;
    userDoc.hasCustomPassword = true;
    await userDoc.save();

    const updatedUser = await User.findById(userDoc._id).select('-password').populate('organization');
    const resolvedCompany = await resolveUserCompany(updatedUser);

    res.status(200).json({
      success: true,
      message: isGoogleWithoutPassword
        ? 'Password set successfully! You can now log in using your email and password as well as Google.'
        : isVerifiedViaEmailOtp
        ? 'Password reset and updated successfully!'
        : 'Password changed successfully!',
      hasCustomPassword: true,
      user: {
        id: updatedUser._id,
        name: updatedUser.name,
        email: updatedUser.email,
        workEmail: updatedUser.workEmail || '',
        workEmailVerified: !!updatedUser.workEmailVerified,
        workEmailVerificationRequired: !!updatedUser.workEmailVerificationRequired,
        emailType: updatedUser.emailType || (isUserCorporateEmail(updatedUser) ? 'corporate' : 'general'),
        phone: updatedUser.phone || '',
        company: resolvedCompany || updatedUser.company || '',
        designation: updatedUser.designation || '',
        city: updatedUser.city || '',
        avatar: updatedUser.avatar || updatedUser.photoURL || '',
        photoURL: updatedUser.avatar || updatedUser.photoURL || '',
        role: updatedUser.role,
        isVerified: updatedUser.isVerified,
        isPhoneVerified: updatedUser.isPhoneVerified !== false,
        plan: updatedUser.plan || 'free',
        basePlan: updatedUser.plan || 'free',
        planStatus: updatedUser.planStatus || (updatedUser.isPlanActive ? 'active' : 'payment_pending'),
        isPlanActive: !!updatedUser.isPlanActive,
        hasGrowthPlan: Boolean(updatedUser.hasGrowthPlan || updatedUser.plan === 'growth'),
        planPaidAmount: updatedUser.planPaidAmount || 0,
        credits: updatedUser.credits !== undefined ? updatedUser.credits : 100,
        organization: updatedUser.organization,
        authProvider: updatedUser.authProvider || 'local',
        hasCustomPassword: true
      }
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Exchange one-time impersonation token for user session
// @route   POST /api/auth/impersonate-exchange
router.post('/impersonate-exchange', async (req, res, next) => {
  try {
    const { token } = req.body;
    if (!token) {
      return res.status(400).json({ success: false, error: 'Exchange token is required' });
    }

    const secret = process.env.JWT_SECRET || 'visitexpo_access_key_super_secret_change_me_in_production';
    let decoded;
    try {
      decoded = jwt.verify(token, secret);
    } catch (err) {
      return res.status(401).json({ success: false, error: 'Impersonation link is expired or invalid. Please request a new one.' });
    }

    if (decoded.type !== 'impersonate_exchange') {
      return res.status(401).json({ success: false, error: 'Invalid exchange token type' });
    }

    const userDoc = await User.findById(decoded.userId).populate('organization');
    if (!userDoc) {
      return res.status(404).json({ success: false, error: 'Target user account not found' });
    }

    if (userDoc.isSuspended || userDoc.status === 'suspended') {
      return res.status(403).json({ success: false, error: 'Target user account is suspended' });
    }

    const accessToken = generateAccessToken(userDoc);
    const refreshToken = generateRefreshToken(userDoc);

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);
    await UserRepository.addRefreshToken(userDoc._id, refreshToken, expiresAt);

    // Set refresh token cookie
    setRefreshTokenCookie(res, refreshToken, req);

    res.status(200).json({
      success: true,
      message: `Successfully authenticated as ${userDoc.name}`,
      accessToken,
      refreshToken,
      user: {
        id: userDoc._id,
        name: userDoc.name,
        email: userDoc.email,
        phone: userDoc.phone || '',
        company: userDoc.company || '',
        designation: userDoc.designation || '',
        city: userDoc.city || '',
        role: userDoc.role,
        isVerified: userDoc.isVerified,
        credits: userDoc.credits !== undefined ? userDoc.credits : 100,
        avatar: userDoc.avatar || userDoc.photoURL || '',
        photoURL: userDoc.avatar || userDoc.photoURL || '',
        organization: userDoc.organization,
        authProvider: userDoc.authProvider || 'local',
        hasCustomPassword: userDoc.hasCustomPassword !== undefined ? userDoc.hasCustomPassword : true
      }
    });
  } catch (error) {
    next(error);
  }
});

export default router;
