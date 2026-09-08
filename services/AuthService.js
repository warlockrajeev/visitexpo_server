/**
 * @file AuthService.js
 * @description Authentication service managing registrations, logins, and refresh token verification.
 */

import crypto from 'crypto';
import UserRepository from '../repositories/UserRepository.js';
import Organization from '../models/Organization.js';
import { generateAccessToken, generateRefreshToken, verifyRefreshToken } from '../utils/jwt.js';

class AuthService {
  async signup(name, email, password, orgName = '', role = 'organizer') {
    // 1. Check if email already registered
    const existingUser = await UserRepository.findOne({ email });
    if (existingUser) {
      const err = new Error('Email address already registered');
      err.statusCode = 400;
      throw err;
    }

    const assignedRole = ['visitor', 'organizer', 'exhibitor'].includes(role) ? role : 'organizer';
    const isVerified = assignedRole === 'visitor'; // Visitors are auto-verified

    // 2. Create the User (password hashing handled by Mongoose pre-save hook)
    const user = await UserRepository.create({
      name,
      email,
      password,
      role: assignedRole,
      isVerified
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
        organization: user.organization
      },
      accessToken,
      refreshToken
    };
  }

  async login(email, password) {
    // 1. Find user with password field
    const user = await UserRepository.findByEmailWithPassword(email);
    if (!user) {
      const err = new Error('Invalid email or password credentials');
      err.statusCode = 401;
      throw err;
    }

    // 2. Match password
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      const err = new Error('Invalid email or password credentials');
      err.statusCode = 401;
      throw err;
    }

    // 3. Block login if account is pending admin/organizer verification
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

    // 4. Generate tokens
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

  async googleAuth({ email, name, role = 'organizer', organizationName, phone, city, website, company, designation, industry }) {
    if (!email) {
      const err = new Error('Email is required for Google authentication');
      err.statusCode = 400;
      throw err;
    }

    const normalizedEmail = email.toLowerCase().trim();
    let user = await UserRepository.findOne({ email: normalizedEmail });

    const assignedRole = role === 'visitor' ? 'visitor' : role === 'exhibitor' ? 'exhibitor' : 'organizer';
    const finalOrgName = organizationName || company || `${name || normalizedEmail.split('@')[0]}'s ${assignedRole === 'exhibitor' ? 'Exhibition Enterprise' : 'Organization'}`;

    if (!user) {
      // Auto-register new user authenticated via Google
      const randomPassword = crypto.randomBytes(24).toString('hex');
      const userName = name || normalizedEmail.split('@')[0];

      user = await UserRepository.create({
        name: userName,
        email: normalizedEmail,
        password: randomPassword,
        role: assignedRole,
        phone: phone || '',
        company: company || organizationName || '',
        designation: designation || '',
        city: city || '',
        isVerified: true
      });

      // Create organization if registering as organizer or exhibitor
      if (assignedRole === 'organizer' || assignedRole === 'exhibitor') {
        const organization = await Organization.create({
          name: finalOrgName,
          website: website || '',
          contact: { email: normalizedEmail, phone: phone || '' },
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

      // If user is explicitly registering/switching to organizer or exhibitor
      if (assignedRole !== 'visitor' && user.role === 'visitor') {
        user.role = assignedRole;
      }

      if (phone && !user.phone) user.phone = phone;
      if (company && !user.company) user.company = company;
      if (city && !user.city) user.city = city;
      if (designation && !user.designation) user.designation = designation;

      // If user has no organization yet and is organizer/exhibitor, create one
      if (!user.organization && (user.role === 'organizer' || user.role === 'exhibitor')) {
        const organization = await Organization.create({
          name: finalOrgName,
          website: website || '',
          contact: { email: normalizedEmail, phone: phone || '' },
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
