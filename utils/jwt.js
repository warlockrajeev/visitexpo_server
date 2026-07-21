/**
 * @file jwt.js
 * @description Utilities to issue and verify JSON Web Tokens (Access & Refresh tokens).
 */

import jwt from 'jsonwebtoken';

const ACCESS_SECRET = process.env.JWT_SECRET || 'visitexpo_access_key_super_secret';
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'visitexpo_refresh_key_super_secret';

export const generateAccessToken = (user) => {
  return jwt.sign(
    {
      id: user._id,
      email: user.email,
      role: user.role,
      organization: user.organization
    },
    ACCESS_SECRET,
    { expiresIn: process.env.JWT_ACCESS_EXPIRE || '7d' }
  );
};

export const generateRefreshToken = (user) => {
  return jwt.sign(
    { id: user._id },
    REFRESH_SECRET,
    { expiresIn: process.env.JWT_REFRESH_EXPIRE || '7d' }
  );
};

export const verifyAccessToken = (token) => {
  try {
    return jwt.verify(token, ACCESS_SECRET);
  } catch (error) {
    return null;
  }
};

export const verifyRefreshToken = (token) => {
  try {
    return jwt.verify(token, REFRESH_SECRET);
  } catch (error) {
    return null;
  }
};
