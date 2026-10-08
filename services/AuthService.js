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
import { generateAccessToken, generateRefreshToken, verifyRefreshToken } from '../utils/jwt.js';
import { isCorporateEmail } from '../utils/emailValidator.js';

export const getRoleLabel = (role) => {
  if (!role) return 'User';
  const r = role.toLowerCase();
  if (r === 'organizer') return 'Organizer';
  if (r === 'exhibitor') return 'Exhibitor';
  if (r === 'visitor') return 'Visitor';
  if (r === 'super_admin' || r === 'admin') return 'Administrator';
  return role.charAt(0).toUpperCase() + role.slice(1);
};

class AuthService {
  async signup(name, email, password, orgName = '', role = 'organizer', phone = '', city = '', phoneVerificationToken = '', otpSessionId = '', otp = '') {
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
    if (assignedRole !== 'visitor' && (!orgName || orgName.trim().length < 2)) {
      const err = new Error(
        assignedRole === 'exhibitor'
          ? 'Company / Exhibitor Name is required (minimum 2 characters).'
          : 'Organization Name is required (minimum 2 characters).'
      );
      err.statusCode = 400;
      throw err;
    }

    // 3. Mandatory Mobile OTP Verification Check
    const cleanPhone = TwoFactorService.cleanPhoneNumber(phone);
    if (!cleanPhone || cleanPhone.length < 10) {
      const err = new Error('A valid 10-digit mobile number is mandatory for registration.');
      err.statusCode = 400;
      throw err;
    }

    let isPhoneValid = false;
    if (phoneVerificationToken && TwoFactorService.validateVerificationToken(phoneVerificationToken, cleanPhone)) {
      isPhoneValid = true;
    } else if (otpSessionId && otp) {
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
      const err = new Error('Mandatory mobile number verification failed. Please verify your phone number via OTP.');
      err.statusCode = 400;
      throw err;
    }

    // 4. Determine corporate vs general email & plan activation
    const isCorporate = isCorporateEmail(normalizedEmail);
    const emailType = isCorporate ? 'corporate' : 'general';

    let isVerified = false;
    let planStatus = 'payment_pending';
    let isPlanActive = false;
    let planPaidAmount = 0;

    if (assignedRole === 'visitor') {
      isVerified = true;
      planStatus = 'active';
      isPlanActive = true;
    } else if (assignedRole === 'organizer') {
      const freePlanDoc = await Plan.findOne({ planId: 'free' });
      const generalEmailPrice = freePlanDoc?.pricing?.generalEmailPrice !== undefined ? freePlanDoc.pricing.generalEmailPrice : 1499;
      const isGeneralFree = generalEmailPrice === 0;

      if (isCorporate || isGeneralFree) {
        // Corporate business email or no charge for general email configured by admin: Free Organizer plan is automatically active!
        isVerified = true;
        planStatus = 'active';
        isPlanActive = true;
        planPaidAmount = 0;
      } else {
        // General personal email: requires ₹1,499 verification charge to activate
        isVerified = false;
        planStatus = 'payment_pending';
        isPlanActive = false;
        planPaidAmount = 0;
      }
    }

    // Create the User (password hashing handled by Mongoose pre-save hook)
    const user = await UserRepository.create({
      name: name.trim(),
      email: normalizedEmail,
      password,
      role: assignedRole,
      phone: cleanPhone,
      city: city.trim(),
      emailType,
      plan: 'free',
      planStatus,
      isPlanActive,
      planPaidAmount,
      isVerified,
      isPhoneVerified: true,
      authProvider: 'local',
      hasCustomPassword: true
    });

    // 5. Create default Organization & Subscription if organizer or name specified
    if (orgName || assignedRole === 'organizer') {
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
          price: isCorporate ? 0 : 1499,
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

    return {
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        adminRole: user.adminRole || '',
        permissions: user.permissions || [],
        isVerified: user.isVerified,
        emailType: user.emailType,
        plan: user.plan,
        planStatus: user.planStatus,
        isPlanActive: user.isPlanActive,
        planPaidAmount: user.planPaidAmount,
        credits: user.credits !== undefined ? user.credits : 100,
        organization: user.organization,
        phone: user.phone || '',
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

    // 4. Auto-sync organizer corporate email plan & verification
    if (user.role === 'organizer') {
      const isCorporate = isCorporateEmail(user.email);
      let needsSave = false;
      if (!user.emailType) {
        user.emailType = isCorporate ? 'corporate' : 'general';
        needsSave = true;
      }
      if (isCorporate && !user.isPlanActive) {
        // Corporate business email: 100% Free Organizer plan automatically active!
        user.isVerified = true;
        user.plan = 'free';
        user.planStatus = 'active';
        user.isPlanActive = true;
        user.planPaidAmount = 0;
        needsSave = true;
      } else if (!isCorporate && !user.isPlanActive) {
        user.plan = 'free';
        user.planStatus = user.isVerified ? 'active' : 'payment_pending';
        needsSave = true;
      }
      if (needsSave) {
        await user.save();
      }
    }

    if (user.role === 'exhibitor' && !user.isVerified) {
      const err = new Error('Your exhibitor onboarding request is pending Organizer approval. Access will be granted once approved.');
      err.statusCode = 403;
      throw err;
    }

    // 5. Generate tokens
    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);

    // Save refresh token
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7 days
    await UserRepository.addRefreshToken(user._id, refreshToken, expiresAt);

    return {
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        adminRole: user.adminRole || '',
        permissions: user.permissions || [],
        isVerified: user.isVerified,
        emailType: user.emailType || (isCorporateEmail(user.email) ? 'corporate' : 'general'),
        plan: user.plan || 'free',
        planStatus: user.planStatus || (user.isVerified ? 'active' : 'payment_pending'),
        isPlanActive: !!user.isPlanActive,
        planPaidAmount: user.planPaidAmount || 0,
        credits: user.credits !== undefined ? user.credits : 100,
        organization: user.organization,
        phone: user.phone || '',
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

  async googleAuth({ email, name, role = 'organizer', organizationName, phone, city, website, company, designation, industry, phoneVerificationToken, otpSessionId, otp }) {
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
      // Mandatory Mobile OTP verification for new Google registration
      const cleanPhone = TwoFactorService.cleanPhoneNumber(phone);
      if (!cleanPhone || cleanPhone.length < 10) {
        const err = new Error('A valid 10-digit mobile number is mandatory to complete Google registration.');
        err.statusCode = 400;
        throw err;
      }

      let isPhoneValid = false;
      if (phoneVerificationToken && TwoFactorService.validateVerificationToken(phoneVerificationToken, cleanPhone)) {
        isPhoneValid = true;
      } else if (otpSessionId && otp) {
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
        const err = new Error('Mobile number OTP verification is required to complete Google registration.');
        err.statusCode = 400;
        throw err;
      }

      // Mandatory Organization Name check for Organizer/Exhibitor
      if (assignedRole !== 'visitor' && (!organizationName || !organizationName.trim())) {
        const err = new Error(assignedRole === 'exhibitor' ? 'Company / Brand Name is required.' : 'Organization Name is required.');
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

      // Auto-register new user authenticated via Google
      const randomPassword = crypto.randomBytes(24).toString('hex');
      const userName = name || normalizedEmail.split('@')[0];
      const isCorporate = isCorporateEmail(normalizedEmail);
      const emailType = isCorporate ? 'corporate' : 'general';

      let isVerified = false;
      let planStatus = 'payment_pending';
      let isPlanActive = false;

      if (assignedRole === 'visitor') {
        isVerified = true;
        planStatus = 'active';
        isPlanActive = true;
      } else if (assignedRole === 'organizer') {
        const freePlanDoc = await Plan.findOne({ planId: 'free' });
        const generalEmailPrice = freePlanDoc?.pricing?.generalEmailPrice !== undefined ? freePlanDoc.pricing.generalEmailPrice : 1499;
        const isGeneralFree = generalEmailPrice === 0;

        if (isCorporate || isGeneralFree) {
          isVerified = true;
          planStatus = 'active';
          isPlanActive = true;
        } else {
          isVerified = false;
          planStatus = 'payment_pending';
          isPlanActive = false;
        }
      } else if (assignedRole === 'exhibitor') {
        isVerified = false;
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
        emailType,
        plan: 'free',
        planStatus,
        isPlanActive,
        planPaidAmount: 0,
        isVerified,
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
            price: isCorporate ? 0 : 1499,
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
    } else {
      // If user exists, sync corporate email plan if organizer
      if (user.role === 'organizer') {
        const isCorporate = isCorporateEmail(user.email);
        if (!user.emailType) user.emailType = isCorporate ? 'corporate' : 'general';
        if (isCorporate && !user.isPlanActive) {
          user.isVerified = true;
          user.plan = 'free';
          user.planStatus = 'active';
          user.isPlanActive = true;
          user.planPaidAmount = 0;
        }
      }
      if (!user.authProvider) {
        user.authProvider = 'google';
      }
      if (user.hasCustomPassword === undefined) {
        user.hasCustomPassword = false;
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

    return {
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone || '',
        company: user.company || '',
        designation: user.designation || '',
        city: user.city || '',
        role: user.role,
        isVerified: user.isVerified,
        emailType: user.emailType || (isCorporateEmail(user.email) ? 'corporate' : 'general'),
        plan: user.plan || 'free',
        planStatus: user.planStatus || (user.isVerified ? 'active' : 'payment_pending'),
        isPlanActive: !!user.isPlanActive,
        planPaidAmount: user.planPaidAmount || 0,
        credits: user.credits !== undefined ? user.credits : 100,
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
