/**
 * @file AuthService.js
 * @description Authentication service managing registrations, logins, and refresh token verification.
 */

import crypto from 'crypto';
import UserRepository from '../repositories/UserRepository.js';
import Organization from '../models/Organization.js';
import Subscription from '../models/Subscription.js';
import Plan from '../models/Plan.js';
import TwoFactorService from './twoFactorService.js';
import EmailOtpService from './emailOtpService.js';
import { sendAccountCreatedWelcomeEmail } from './welcomeEmailService.js';
import { generateAccessToken, generateRefreshToken, verifyRefreshToken } from '../utils/jwt.js';
import { isCorporateEmail, isUserCorporateEmail, verifyGenuineCorporateWorkEmail } from '../utils/emailValidator.js';

export const getRoleLabel = (role) => {
  if (!role) return 'User';
  const r = role.toLowerCase();
  if (r === 'organizer') return 'Organiser';
  if (r === 'exhibitor') return 'Exhibitor';
  if (r === 'visitor') return 'Visitor';
  if (r === 'super_admin' || r === 'admin') return 'Administrator';
  return role.charAt(0).toUpperCase() + role.slice(1);
};

class AuthService {
  async signup(name, email, password, orgName = '', role = 'organizer', phone = '', city = '', phoneVerificationToken = '', otpSessionId = '', otp = '', interests = [], workEmail = '', emailVerificationToken = '') {
    // 1. Check if email already registered
    const normalizedEmail = (email || '').toLowerCase().trim();
    const existingUser = await UserRepository.findOne({ email: normalizedEmail });
    if (existingUser) {
      const existingLabel = getRoleLabel(existingUser.role);
      const err = new Error(`This email address is already registered as an ${existingLabel}. Please switch to the ${existingLabel} tab to sign in.`);
      err.statusCode = 409;
      err.registeredRole = existingUser.role;
      throw err;
    }

    // 1b. Mandatory Email OTP verification check
    if (!emailVerificationToken || !EmailOtpService.validateEmailVerificationToken(emailVerificationToken, normalizedEmail)) {
      const err = new Error('Mandatory email verification failed. Please verify your email address with the 6-digit OTP sent to your inbox.');
      err.statusCode = 400;
      throw err;
    }

    // 2. Validate mandatory name and city
    if (!name || name.trim().length < 2) {
      const err = new Error('Full Name is required (minimum 2 characters).');
      err.statusCode = 400;
      throw err;
    }

    if (!city || city.trim().length < 2) {
      const err = new Error('City / Location is mandatory (minimum 2 characters).');
      err.statusCode = 400;
      throw err;
    }

    const assignedRole = ['visitor', 'organizer', 'exhibitor'].includes(role) ? role : 'organizer';
    if (assignedRole === 'organizer' && workEmail != null && typeof workEmail !== 'string') {
      const err = new Error('Work email must be a valid email address.');
      err.statusCode = 400;
      throw err;
    }
    const normalizedWorkEmail = typeof workEmail === 'string' ? workEmail.toLowerCase().trim() : '';
    if (assignedRole === 'organizer') {
      if (!normalizedWorkEmail) {
        const err = new Error('Work / Corporate Email is mandatory for Organiser registration.');
        err.statusCode = 400;
        throw err;
      }
      const workEmailCheck = await verifyGenuineCorporateWorkEmail(normalizedWorkEmail);
      if (!workEmailCheck.valid) {
        const err = new Error(workEmailCheck.error || 'Enter a genuine corporate work email address.');
        err.statusCode = 400;
        throw err;
      }
      const existingWorkUser = await UserRepository.findOne({ workEmail: normalizedWorkEmail });
      if (existingWorkUser) {
        const err = new Error('This Work / Corporate Email is already registered with another Organiser account.');
        err.statusCode = 409;
        throw err;
      }
    }
    const hasCorporateWorkEmail = assignedRole === 'organizer' && !!normalizedWorkEmail;
    const visitorInterests = Array.isArray(interests)
      ? Array.from(new Set(interests.filter((interest) => typeof interest === 'string').map((interest) => interest.trim()).filter(Boolean)))
      : [];
    if (assignedRole === 'visitor' && visitorInterests.length === 0) {
      const err = new Error('Please select a visitor category.');
      err.statusCode = 400;
      throw err;
    }
    if (!orgName || orgName.trim().length < 2) {
      const err = new Error(
        assignedRole === 'visitor'
          ? 'Company / Organization Name is required (minimum 2 characters).'
          : assignedRole === 'exhibitor'
          ? 'Company / Exhibitor Name is required (minimum 2 characters).'
          : 'Organization Name is required (minimum 2 characters).'
      );
      err.statusCode = 400;
      throw err;
    }

    // 3. Mandatory Mobile OTP or Foreign Live-Location Verification Check
    const isForeignPhoneVerified =
      Boolean(phoneVerificationToken) && TwoFactorService.isForeignVerificationToken(phoneVerificationToken, phone);
    const cleanPhone = isForeignPhoneVerified
      ? TwoFactorService.cleanForeignPhoneNumber(phone)
      : TwoFactorService.cleanPhoneNumber(phone);

    if (!cleanPhone || (!isForeignPhoneVerified && cleanPhone.length < 10) || (isForeignPhoneVerified && cleanPhone.replace(/\D/g, '').length < 7)) {
      const err = new Error('A valid mobile number is mandatory for registration.');
      err.statusCode = 400;
      throw err;
    }

    let isPhoneValid = isForeignPhoneVerified;
    if (!isPhoneValid && phoneVerificationToken && TwoFactorService.validateVerificationToken(phoneVerificationToken, cleanPhone)) {
      isPhoneValid = true;
    } else if (!isPhoneValid && otpSessionId && otp) {
      const verifyRes = await TwoFactorService.verifyOtp(otpSessionId, otp, cleanPhone);
      if (verifyRes.success) {
        isPhoneValid = true;
      } else {
        const err = new Error(verifyRes.error || 'Invalid or expired mobile OTP.');
        err.statusCode = 400;
        throw err;
      }
    }

    if (!isPhoneValid) {
      const err = new Error('Mandatory mobile number verification failed. Please verify your Indian mobile number via OTP or confirm your foreign live location.');
      err.statusCode = 400;
      throw err;
    }

    // 4. Determine corporate vs general email & plan activation
    const isCorporate = assignedRole === 'organizer' ? hasCorporateWorkEmail : isCorporateEmail(normalizedEmail);
    const emailType = isCorporate ? 'corporate' : 'general';

    // Accounts are activated immediately upon creation without waiting for admin approval
    const isVerified = true;
    let planStatus = 'payment_pending';
    let isPlanActive = false;
    let planPaidAmount = 0;
    let generalEmailPrice = 1499;

    if (assignedRole === 'visitor') {
      planStatus = 'active';
      isPlanActive = true;
    } else if (assignedRole === 'organizer') {
      const freePlanDoc = await Plan.findOne({ planId: 'free' });
      generalEmailPrice = freePlanDoc?.pricing?.generalEmailPrice !== undefined ? freePlanDoc.pricing.generalEmailPrice : 1499;
      const isGeneralFree = generalEmailPrice === 0;

      if (isCorporate || isGeneralFree) {
        // Corporate business email or no charge for general email configured by admin: Free Organizer plan is automatically active!
        planStatus = 'active';
        isPlanActive = true;
        planPaidAmount = 0;
      } else {
        // General personal email: requires ₹1,499 plan activation charge (account itself still does not require admin approval)
        planStatus = 'payment_pending';
        isPlanActive = false;
        planPaidAmount = 0;
      }
    } else if (assignedRole === 'exhibitor') {
      planStatus = 'active';
      isPlanActive = true;
    }

    // Create the User (password hashing handled by Mongoose pre-save hook)
    const user = await UserRepository.create({
      name: name.trim(),
      email: normalizedEmail,
      password,
      role: assignedRole,
      phone: cleanPhone,
      company: orgName ? orgName.trim() : '',
      city: city.trim(),
      interests: assignedRole === 'visitor' ? visitorInterests : [],
      workEmail: hasCorporateWorkEmail ? normalizedWorkEmail : '',
      workEmailVerified: hasCorporateWorkEmail,
      workEmailVerificationRequired: false,
      emailType,
      plan: 'free',
      planStatus,
      isPlanActive,
      planPaidAmount,
      isVerified,
      status: 'active',
      isEmailVerified: true,
      isPhoneVerified: true,
      authProvider: 'local',
      hasCustomPassword: true
    });

    // 5. Create default Organization & Subscription for organizer or exhibitor
    if (assignedRole === 'organizer' || assignedRole === 'exhibitor') {
      const organization = await Organization.create({
        name: (orgName || `${name.trim()}'s Organization`).trim(),
        contact: { email: normalizedEmail, phone: cleanPhone },
        address: { city: city.trim() },
        teamMembers: [{ user: user._id, role: assignedRole }]
      });

      // Automatically create Subscription for organizer
      if (assignedRole === 'organizer') {
        const subscription = await Subscription.create({
          organization: organization._id,
          user: user._id,
          plan: 'free',
          emailType,
          status: isPlanActive ? 'active' : 'payment_pending',
          price: isCorporate ? 0 : generalEmailPrice,
          paymentCycle: isCorporate ? 'quarterly' : 'one_time',
          startDate: new Date(),
          endDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
        });
        organization.subscription = subscription._id;
        await organization.save();
      }

      // Link Organization to User
      user.organization = organization._id;
      await user.save();
    }

    // 6. Generate JWT tokens
    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);

    // Save refresh token
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7 days
    await UserRepository.addRefreshToken(user._id, refreshToken, expiresAt);

    // 7. Automatically dispatch first-time Account Created welcome email via Zoho CPaaS (non-blocking)
    void sendAccountCreatedWelcomeEmail({
      userId: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      organizationName: orgName ? orgName.trim() : ''
    }).catch((err) => {
      console.error('[AuthService] Welcome email error on signup:', err.message);
    });

    return {
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        city: user.city || '',
        interests: user.interests || [],
        workEmail: user.workEmail || '',
        workEmailVerified: !!user.workEmailVerified,
        workEmailVerificationRequired: !!user.workEmailVerificationRequired,
        adminRole: user.adminRole || '',
        permissions: user.permissions || [],
        isVerified: user.isVerified,
        emailType: user.emailType,
        plan: user.plan,
        planStatus: user.planStatus,
        isPlanActive: user.isPlanActive,
        hasGrowthPlan: Boolean(user.hasGrowthPlan || user.plan === 'growth'),
        planPaidAmount: user.planPaidAmount,
        credits: user.credits !== undefined ? user.credits : 100,
        organization: user.organization,
        phone: user.phone || '',
        avatar: user.avatar || user.photoURL || '',
        photoURL: user.avatar || user.photoURL || '',
        authProvider: 'local',
        hasCustomPassword: true
      },
      accessToken,
      refreshToken
    };
  }

  async login(email, password, expectedRole = null) {
    const normalizedEmail = (email || '').toLowerCase().trim();
    // 1. Find user with password field
    const user = await UserRepository.findByEmailWithPassword(normalizedEmail);
    if (!user) {
      const err = new Error('Invalid email or password credentials');
      err.statusCode = 401;
      throw err;
    }

    // Role mismatch check if expectedRole is passed
    if (expectedRole && user.role && user.role !== expectedRole) {
      const existingLabel = getRoleLabel(user.role);
      const err = new Error(
        `This account is registered as an ${existingLabel}. Please switch to the ${existingLabel} tab to sign in.`
      );
      err.statusCode = 409;
      err.registeredRole = user.role;
      throw err;
    }

    // 2. Match password
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      const err = new Error('Invalid email or password credentials');
      err.statusCode = 401;
      throw err;
    }

    // 3. Block login if user is suspended
    if (user.isSuspended || user.status === 'suspended') {
      const err = new Error(user.suspendReason ? `Your account has been suspended: "${user.suspendReason}". Contact support@visitexpo.in.` : 'Your account has been suspended by an administrator. Please contact support@visitexpo.in.');
      err.statusCode = 403;
      throw err;
    }

    // 4. Auto-verify account & sync organizer corporate email plan
    if (!user.isVerified) {
      user.isVerified = true;
      await user.save();
    }

    if (user.role === 'organizer') {
      const isCorporate = isUserCorporateEmail(user);
      let needsSave = false;
      if (!user.emailType) {
        user.emailType = isCorporate ? 'corporate' : 'general';
        needsSave = true;
      }

      // Check active subscription
      const orgId = user.organization?._id || user.organization;
      const activeSub = await Subscription.findOne({
        $or: [
          ...(orgId ? [{ organization: orgId }] : []),
          { user: user._id }
        ],
        plan: { $ne: 'growth' },
        status: 'active'
      }).sort({ createdAt: -1 });

      if (activeSub && activeSub.plan && activeSub.plan !== 'growth') {
        if (user.plan !== activeSub.plan || !user.isPlanActive || !user.isVerified) {
          user.plan = activeSub.plan;
          user.planStatus = 'active';
          user.isPlanActive = true;
          user.isVerified = true;
          needsSave = true;
        }
      } else if (['enterprise', 'starter'].includes(user.plan)) {
        if (!user.isPlanActive || !user.isVerified) {
          user.isPlanActive = true;
          user.isVerified = true;
          user.planStatus = 'active';
          needsSave = true;
        }
      } else if (isCorporate && !user.isPlanActive) {
        // Corporate business email: 100% Free Organizer plan automatically active!
        user.isVerified = true;
        user.plan = 'free';
        user.planStatus = 'active';
        user.isPlanActive = true;
        user.planPaidAmount = 0;
        needsSave = true;
      } else if (!isCorporate && !user.isPlanActive && user.plan === 'free') {
        user.plan = 'free';
        user.planStatus = user.isPlanActive ? 'active' : 'payment_pending';
        needsSave = true;
      }
      if (needsSave) {
        await user.save();
      }
    }

    // 5. Generate tokens
    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);

    // Save refresh token
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7 days
    await UserRepository.addRefreshToken(user._id, refreshToken, expiresAt);

    const isPaidOrganizer = ['enterprise', 'starter'].includes(user.plan);

    return {
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        city: user.city || '',
        interests: user.interests || [],
        workEmail: user.workEmail || '',
        workEmailVerified: !!user.workEmailVerified,
        workEmailVerificationRequired: !!user.workEmailVerificationRequired,
        adminRole: user.adminRole || '',
        permissions: user.permissions || [],
        isVerified: true,
        emailType: user.emailType || (isUserCorporateEmail(user) ? 'corporate' : 'general'),
        plan: user.plan || 'free',
        basePlan: user.plan || 'free',
        planStatus: user.planStatus || (user.isPlanActive ? 'active' : 'payment_pending'),
        isPlanActive: isPaidOrganizer ? true : !!user.isPlanActive,
        hasGrowthPlan: Boolean(user.hasGrowthPlan || user.plan === 'growth'),
        planPaidAmount: user.planPaidAmount || 0,
        credits: user.credits !== undefined ? user.credits : 100,
        organization: user.organization,
        phone: user.phone || '',
        avatar: user.avatar || user.photoURL || '',
        photoURL: user.avatar || user.photoURL || '',
        authProvider: user.authProvider || 'local',
        hasCustomPassword: user.hasCustomPassword !== undefined ? user.hasCustomPassword : (user.authProvider !== 'google')
      },
      accessToken,
      refreshToken
    };
  }

  async refresh(token) {
    // 1. Verify token signature
    const decoded = verifyRefreshToken(token);
    if (!decoded) {
      const err = new Error('Invalid or expired refresh token');
      err.statusCode = 401;
      throw err;
    }

    // 2. Find user containing this token in active or recently rotated list
    const user = await UserRepository.findOne({
      _id: decoded.id,
      'refreshTokens.token': token
    });

    if (!user) {
      const err = new Error('Refresh token revoked or user not found');
      err.statusCode = 401;
      throw err;
    }

    const tokenEntry = (user.refreshTokens || []).find((t) => t.token === token);
    const now = new Date();

    // 3. Grace period check: if this token was already rotated within the last 60 seconds,
    // don't reject it (handles concurrent requests from tab shifts or parallel requests)
    if (tokenEntry && tokenEntry.rotatedAt) {
      const ageMs = now.getTime() - new Date(tokenEntry.rotatedAt).getTime();
      if (ageMs < 60 * 1000) {
        const activeTokens = (user.refreshTokens || []).filter(
          (t) => !t.rotatedAt && new Date(t.expiresAt) > now
        );
        const fallbackRefresh =
          tokenEntry.replacedBy ||
          (activeTokens.length > 0 ? activeTokens[activeTokens.length - 1].token : token);

        return {
          accessToken: generateAccessToken(user),
          refreshToken: fallbackRefresh
        };
      } else {
        const err = new Error('Refresh token has expired or was already rotated');
        err.statusCode = 401;
        throw err;
      }
    }

    // 4. Token is active: generate new tokens and mark old token rotated
    const newAccessToken = generateAccessToken(user);
    const newRefreshToken = generateRefreshToken(user);
    const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    await UserRepository.markRefreshTokenRotated(user._id, token, newRefreshToken, expiresAt);

    return {
      accessToken: newAccessToken,
      refreshToken: newRefreshToken
    };
  }

  async logout(userId, token) {
    await UserRepository.removeRefreshToken(userId, token);
    return true;
  }

  async googleAuth({ email, name, role = 'organizer', organizationName, phone, city, website, company, designation, industry, interests = [], phoneVerificationToken, otpSessionId, otp, workEmail = '' }) {
    if (!email) {
      const err = new Error('Email is required for Google authentication');
      err.statusCode = 400;
      throw err;
    }

    const normalizedEmail = email.toLowerCase().trim();
    let user = await UserRepository.findOne({ email: normalizedEmail });

    // Block Google login if account is suspended
    if (user && (user.isSuspended || user.status === 'suspended')) {
      const err = new Error(user.suspendReason ? `Your account has been suspended: "${user.suspendReason}". Contact support@visitexpo.in.` : 'Your account has been suspended by an administrator. Please contact support@visitexpo.in.');
      err.statusCode = 403;
      throw err;
    }

    const assignedRole = role === 'visitor' ? 'visitor' : role === 'exhibitor' ? 'exhibitor' : 'organizer';
    const visitorInterests = Array.isArray(interests)
      ? Array.from(new Set(interests.filter((interest) => typeof interest === 'string').map((interest) => interest.trim()).filter(Boolean)))
      : [];
    const finalOrgName = organizationName || company || `${name || normalizedEmail.split('@')[0]}'s ${assignedRole === 'exhibitor' ? 'Exhibition Enterprise' : 'Organization'}`;

    if (user) {
      // Check if user is registered with a different role
      const existingRole = user.role || 'organizer';
      if (assignedRole && existingRole !== assignedRole) {
        const existingLabel = getRoleLabel(existingRole);
        const err = new Error(
          `This Google account (${normalizedEmail}) is already registered as an ${existingLabel}. Please switch to the ${existingLabel} tab to sign in.`
        );
        err.statusCode = 409;
        err.registeredRole = existingRole;
        throw err;
      }
    }

    if (!user) {
      // Mandatory Mobile OTP or Foreign Live-Location verification for new Google registration
      const isForeignPhoneVerified =
        Boolean(phoneVerificationToken) && TwoFactorService.isForeignVerificationToken(phoneVerificationToken, phone);
      const cleanPhone = isForeignPhoneVerified
        ? TwoFactorService.cleanForeignPhoneNumber(phone)
        : TwoFactorService.cleanPhoneNumber(phone);

      if (!cleanPhone || (!isForeignPhoneVerified && cleanPhone.length < 10) || (isForeignPhoneVerified && cleanPhone.replace(/\D/g, '').length < 7)) {
        const err = new Error('A valid mobile number is mandatory to complete Google registration.');
        err.statusCode = 400;
        throw err;
      }

      let isPhoneValid = isForeignPhoneVerified;
      if (!isPhoneValid && phoneVerificationToken && TwoFactorService.validateVerificationToken(phoneVerificationToken, cleanPhone)) {
        isPhoneValid = true;
      } else if (!isPhoneValid && otpSessionId && otp) {
        const verifyRes = await TwoFactorService.verifyOtp(otpSessionId, otp, cleanPhone);
        if (verifyRes.success) {
          isPhoneValid = true;
        } else {
          const err = new Error(verifyRes.error || 'Invalid or expired mobile OTP.');
          err.statusCode = 400;
          throw err;
        }
      }

      if (!isPhoneValid) {
        const err = new Error('Mobile number verification is required to complete Google registration.');
        err.statusCode = 400;
        throw err;
      }

      // Mandatory Organization / Company Name check for all roles
      const resolvedGoogleOrg = (organizationName || company || '').trim();
      if (!resolvedGoogleOrg || resolvedGoogleOrg.length < 2) {
        const err = new Error(
          assignedRole === 'visitor'
            ? 'Company / Organization Name is required (minimum 2 characters).'
            : assignedRole === 'exhibitor'
            ? 'Company / Brand Name is required.'
            : 'Organization Name is required.'
        );
        err.statusCode = 400;
        throw err;
      }

      // Mandatory City / Location check
      if (!city || !city.trim() || city.trim().length < 2) {
        const err = new Error('City / Location is mandatory to complete registration.');
        err.statusCode = 400;
        throw err;
      }

      // Mandatory Industry Sector for Exhibitors
      if (assignedRole === 'exhibitor' && (!industry || !industry.trim())) {
        const err = new Error('Industry Sector / Product Category is required.');
        err.statusCode = 400;
        throw err;
      }
      if (assignedRole === 'visitor' && visitorInterests.length === 0) {
        const err = new Error('Please select a visitor category.');
        err.statusCode = 400;
        throw err;
      }

      // Auto-register new user authenticated via Google
      const randomPassword = crypto.randomBytes(24).toString('hex');
      const userName = name || normalizedEmail.split('@')[0];
      if (assignedRole === 'organizer' && workEmail != null && typeof workEmail !== 'string') {
        const err = new Error('Work email must be a valid email address.');
        err.statusCode = 400;
        throw err;
      }
      const normalizedWorkEmail = typeof workEmail === 'string' ? workEmail.toLowerCase().trim() : '';
      if (assignedRole === 'organizer') {
        if (!normalizedWorkEmail) {
          const err = new Error('Work / Corporate Email is mandatory for Organiser registration.');
          err.statusCode = 400;
          throw err;
        }
        const workEmailCheck = await verifyGenuineCorporateWorkEmail(normalizedWorkEmail);
        if (!workEmailCheck.valid) {
          const err = new Error(workEmailCheck.error || 'Enter a genuine corporate work email address.');
          err.statusCode = 400;
          throw err;
        }
        const existingWorkUser = await UserRepository.findOne({ workEmail: normalizedWorkEmail });
        if (existingWorkUser) {
          const err = new Error('This Work / Corporate Email is already registered with another Organiser account.');
          err.statusCode = 409;
          throw err;
        }
      }
      const hasCorporateWorkEmail = assignedRole === 'organizer' && !!normalizedWorkEmail;

      const isCorporate = assignedRole === 'organizer' ? hasCorporateWorkEmail : isCorporateEmail(normalizedEmail);
      const emailType = isCorporate ? 'corporate' : 'general';

      // Accounts are activated immediately upon creation without waiting for admin approval
      const isVerified = true;
      let planStatus = 'payment_pending';
      let isPlanActive = false;
      let generalEmailPrice = 1499;

      if (assignedRole === 'visitor') {
        planStatus = 'active';
        isPlanActive = true;
      } else if (assignedRole === 'organizer') {
        const freePlanDoc = await Plan.findOne({ planId: 'free' });
        generalEmailPrice = freePlanDoc?.pricing?.generalEmailPrice !== undefined ? freePlanDoc.pricing.generalEmailPrice : 1499;
        const isGeneralFree = generalEmailPrice === 0;

        if (isCorporate || isGeneralFree) {
          planStatus = 'active';
          isPlanActive = true;
        } else {
          planStatus = 'payment_pending';
          isPlanActive = false;
        }
      } else if (assignedRole === 'exhibitor') {
        planStatus = 'active';
        isPlanActive = true;
      }

      user = await UserRepository.create({
        name: userName,
        email: normalizedEmail,
        password: randomPassword,
        role: assignedRole,
        phone: cleanPhone,
        company: company || organizationName || '',
        designation: designation || '',
        city: city || '',
        interests: assignedRole === 'visitor' ? visitorInterests : [],
        workEmail: hasCorporateWorkEmail ? normalizedWorkEmail : '',
        workEmailVerified: hasCorporateWorkEmail,
        workEmailVerificationRequired: false,
        emailType,
        plan: 'free',
        planStatus,
        isPlanActive,
        planPaidAmount: 0,
        isVerified,
        status: 'active',
        isEmailVerified: true,
        isPhoneVerified: true,
        authProvider: 'google',
        hasCustomPassword: false
      });

      // Create organization if registering as organizer or exhibitor
      if (assignedRole === 'organizer' || assignedRole === 'exhibitor') {
        const organization = await Organization.create({
          name: finalOrgName,
          website: website || '',
          contact: { email: normalizedEmail, phone: cleanPhone },
          address: { city: city || '' },
          description: industry ? `Industry Sector: ${industry}` : '',
          teamMembers: [{ user: user._id, role: assignedRole }]
        });

        if (assignedRole === 'organizer') {
          const subscription = await Subscription.create({
            organization: organization._id,
            user: user._id,
            plan: 'free',
            emailType,
            status: isPlanActive ? 'active' : 'payment_pending',
            price: isCorporate ? 0 : generalEmailPrice,
            paymentCycle: isCorporate ? 'quarterly' : 'one_time',
            startDate: new Date(),
            endDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
          });
          organization.subscription = subscription._id;
          await organization.save();
        }

        user.organization = organization._id;
        await user.save();
      }

      // Automatically dispatch first-time Account Created welcome email via Zoho CPaaS (non-blocking)
      void sendAccountCreatedWelcomeEmail({
        userId: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        organizationName: company || organizationName || ''
      }).catch((err) => {
        console.error('[AuthService] Welcome email error on Google registration:', err.message);
      });
    } else {
      // Auto-verify existing account if created under prior pending rule
      if (!user.isVerified) {
        user.isVerified = true;
      }

      // If user exists, sync corporate email plan if organizer
      if (user.role === 'organizer' && workEmail) {
        if (workEmail != null && typeof workEmail !== 'string') {
          const err = new Error('Work email must be a valid email address.');
          err.statusCode = 400;
          throw err;
        }
        const normalizedWorkEmail = typeof workEmail === 'string' ? workEmail.toLowerCase().trim() : '';
        const workEmailCheck = await verifyGenuineCorporateWorkEmail(normalizedWorkEmail);
        if (!workEmailCheck.valid) {
          const err = new Error(workEmailCheck.error || 'Enter a genuine corporate work email address.');
          err.statusCode = 400;
          throw err;
        }
        user.workEmail = normalizedWorkEmail;
        user.workEmailVerified = true;
        user.workEmailVerificationRequired = false;
      }

      if (user.role === 'organizer') {
        const isCorporate = isUserCorporateEmail(user);
        user.emailType = isCorporate ? 'corporate' : 'general';

        const orgId = user.organization?._id || user.organization;
        const subscriptionFilter = {
          $or: [
            ...(orgId ? [{ organization: orgId }] : []),
            { user: user._id }
          ],
          plan: { $ne: 'growth' },
        };
        const activeSub = await Subscription.findOne({
          ...subscriptionFilter,
          status: 'active'
        }).sort({ createdAt: -1 });

        if (activeSub && activeSub.plan && activeSub.plan !== 'growth') {
          user.plan = activeSub.plan;
          user.planStatus = 'active';
          user.isPlanActive = true;
          user.isVerified = true;
        } else if (['enterprise', 'starter'].includes(user.plan)) {
          user.isPlanActive = true;
          user.isVerified = true;
          user.planStatus = 'active';
        } else if (isCorporate && !user.isPlanActive) {
          user.isVerified = true;
          user.plan = 'free';
          user.planStatus = 'active';
          user.isPlanActive = true;
          user.planPaidAmount = 0;
          await Subscription.updateMany(
            { ...subscriptionFilter, status: 'payment_pending' },
            { $set: { status: 'active', price: 0, emailType: 'corporate' } }
          );
        }
      }
      if (user.hasCustomPassword === undefined) {
        user.hasCustomPassword = user.authProvider === 'local';
      }
      if (user.authProvider !== 'google') {
        user.authProvider = 'google';
      }

      // If user provided a phone and it's verified, update it
      if (phone) {
        const cleanPhone = TwoFactorService.cleanPhoneNumber(phone);
        if (cleanPhone && cleanPhone.length >= 10) {
          let isPhoneValid = false;
          if (phoneVerificationToken && TwoFactorService.validateVerificationToken(phoneVerificationToken, cleanPhone)) {
            isPhoneValid = true;
          } else if (otpSessionId && otp) {
            const verifyRes = await TwoFactorService.verifyOtp(otpSessionId, otp, cleanPhone);
            if (verifyRes.success) isPhoneValid = true;
          }
          if (isPhoneValid) {
            user.phone = cleanPhone;
            user.isPhoneVerified = true;
          }
        }
      }

      if (company && !user.company) user.company = company;
      if (city && !user.city) user.city = city;
      if (designation && !user.designation) user.designation = designation;
      if (user.role === 'visitor' && visitorInterests.length > 0) {
        user.interests = visitorInterests;
      }

      // If user has no organization yet and is organizer/exhibitor, create one
      if (!user.organization && (user.role === 'organizer' || user.role === 'exhibitor')) {
        const organization = await Organization.create({
          name: finalOrgName,
          website: website || '',
          contact: { email: normalizedEmail, phone: user.phone || '' },
          address: { city: city || '' },
          description: industry ? `Industry Sector: ${industry}` : '',
          teamMembers: [{ user: user._id, role: user.role }]
        });
        user.organization = organization._id;
      } else if (user.organization && organizationName) {
        // If organization already exists but user provided an updated organization name during registration
        await Organization.findByIdAndUpdate(user.organization, {
          ...(organizationName ? { name: organizationName } : {}),
          ...(phone ? { 'contact.phone': phone } : {}),
          ...(website ? { website } : {}),
          ...(city ? { 'address.city': city } : {}),
          ...(industry ? { description: `Industry Sector: ${industry}` } : {})
        });
      }

      await user.save();
    }

    // Populate organization if needed
    if (user.organization) {
      user = await user.populate('organization');
    }

    // Generate tokens
    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);
    await UserRepository.addRefreshToken(user._id, refreshToken, expiresAt);

    const isPaidOrganizerGoogle = ['enterprise', 'starter'].includes(user.plan);

    return {
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone || '',
        company: user.company || '',
        designation: user.designation || '',
        city: user.city || '',
        interests: user.interests || [],
        workEmail: user.workEmail || '',
        workEmailVerified: !!user.workEmailVerified,
        workEmailVerificationRequired: !!user.workEmailVerificationRequired,
        role: user.role,
        isVerified: true,
        emailType: user.emailType || (isUserCorporateEmail(user) ? 'corporate' : 'general'),
        plan: user.plan || 'free',
        basePlan: user.plan || 'free',
        planStatus: user.planStatus || (user.isPlanActive ? 'active' : 'payment_pending'),
        isPlanActive: isPaidOrganizerGoogle ? true : !!user.isPlanActive,
        hasGrowthPlan: Boolean(user.hasGrowthPlan || user.plan === 'growth'),
        planPaidAmount: user.planPaidAmount || 0,
        credits: user.credits !== undefined ? user.credits : 100,
        avatar: user.avatar || user.photoURL || '',
        photoURL: user.avatar || user.photoURL || '',
        organization: user.organization,
        authProvider: user.authProvider || 'google',
        hasCustomPassword: user.hasCustomPassword || false
      },
      accessToken,
      refreshToken
    };
  }
}

export default new AuthService();
