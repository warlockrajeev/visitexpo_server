/**
 * @file AuthService.js
 * @description Authentication service managing registrations, logins, and refresh token verification.
 */

import UserRepository from '../repositories/UserRepository.js';
import Organization from '../models/Organization.js';
import { generateAccessToken, generateRefreshToken, verifyRefreshToken } from '../utils/jwt.js';

class AuthService {
  async signup(name, email, password, orgName = '') {
    // 1. Check if email already registered
    const existingUser = await UserRepository.findOne({ email });
    if (existingUser) {
      const err = new Error('Email address already registered');
      err.statusCode = 400;
      throw err;
    }

    // 2. Create the User (password hashing handled by Mongoose pre-save hook)
    const user = await UserRepository.create({
      name,
      email,
      password,
      role: 'organizer'
    });

    // 3. Create default Organization if name is specified
    if (orgName) {
      const organization = await Organization.create({
        name: orgName,
        contact: { email },
        teamMembers: [{ user: user._id, role: 'organizer' }]
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

    // 3. Generate tokens
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
}

export default new AuthService();
