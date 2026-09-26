/**
 * @file AuthService.js
 * @description Authentication service managing registrations, logins, and refresh token verification.
 */

import crypto from 'crypto';
import UserRepository from '../repositories/UserRepository.js';
import Organization from '../models/Organization.js';
import TwoFactorService from './twoFactorService.js';
import { generateAccessToken, generateRefreshToken, verifyRefreshToken } from '../utils/jwt.js';

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

    // 2. Mandatory Mobile OTP Verification Check
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

    const assignedRole = ['visitor', 'organizer', 'exhibitor'].includes(role) ? role : 'organizer';
    const isVerified = assignedRole === 'visitor'; // Visitors are auto-verified

    // 3. Create the User (password hashing handled by Mongoose pre-save hook)
    const user = await UserRepository.create({
      name,
      email: normalizedEmail,
      password,
      role: assignedRole,
      phone: cleanPhone,
      city: (city || '').trim(),
      isVerified,
      isPhoneVerified: true
    });

    // 3. Create default Organization if name is specified
    if (orgName) {
      const organization = await Organization.create({
        name: orgName,
        contact: { email },
        teamMembers: [{ user: user._id, role: assignedRole }]
      });

      // Link Organization to User
      user.organization = organization._id;
      await user.save();
    }

    // 4. Generate JWT tokens
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
        isVerified: user.isVerified,
        credits: user.credits !== undefined ? user.credits : 100,
        organization: user.organization
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

    // 4. Block login if account is pending admin/organizer verification
    if (user.role === 'organizer' && !user.isVerified) {
      const err = new Error('Your organizer account registration is pending Super Admin approval. Access will be granted once approved.');
      err.statusCode = 403;
      throw err;
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
        isVerified: user.isVerified,
        credits: user.credits !== undefined ? user.credits : 100,
        organization: user.organization
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

    // 2. Find user containing this token in active list
    const user = await UserRepository.findOne({
      _id: decoded.id,
      'refreshTokens.token': token
    });

    if (!user) {
      const err = new Error('Refresh token revoked or user not found');
      err.statusCode = 401;
      throw err;
    }

    // 3. Clean up the used refresh token and issue new pair (rotation)
    await UserRepository.removeRefreshToken(user._id, token);

    const newAccessToken = generateAccessToken(user);
    const newRefreshToken = generateRefreshToken(user);

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);
    await UserRepository.addRefreshToken(user._id, newRefreshToken, expiresAt);

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

      // Auto-register new user authenticated via Google
      const randomPassword = crypto.randomBytes(24).toString('hex');
      const userName = name || normalizedEmail.split('@')[0];

      user = await UserRepository.create({
        name: userName,
        email: normalizedEmail,
        password: randomPassword,
        role: assignedRole,
        phone: cleanPhone,
        company: company || organizationName || '',
        designation: designation || '',
        city: city || '',
        isVerified: true,
        isPhoneVerified: true
      });

      // Create organization if registering as organizer or exhibitor
      if (assignedRole === 'organizer' || assignedRole === 'exhibitor') {
        const organization = await Organization.create({
          name: finalOrgName,
          website: website || '',
          contact: { email: normalizedEmail, phone: cleanPhone },
          address: { city: city || '' },
          description: industry ? `Industry Sector: ${industry}` : '',
          teamMembers: [{ user: user._id, role: 'organizer' }]
        });

        user.organization = organization._id;
        await user.save();
      }
    } else {
      // If user exists, ensure they are verified since Google verified their email
      if (!user.isVerified) {
        user.isVerified = true;
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
          teamMembers: [{ user: user._id, role: 'organizer' }]
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
        organization: user.organization
      },
      accessToken,
      refreshToken
    };
  }
}

export default new AuthService();
