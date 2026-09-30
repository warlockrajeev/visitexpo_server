/**
 * @file jwt.js
 * @description Utilities to issue and verify JSON Web Tokens (Access & Refresh tokens).
 */

import jwt from 'jsonwebtoken';

const getAccessSecret = () => process.env.JWT_SECRET || 'visitexpo_access_key_super_secret';
const getRefreshSecret = () => process.env.JWT_REFRESH_SECRET || 'visitexpo_refresh_key_super_secret';

export const generateAccessToken = (user) => {
  return jwt.sign(
    {
      id: user._id,
      email: user.email,
      role: user.role,
      adminRole: user.adminRole || '',
      permissions: user.permissions || [],
      organization: user.organization
    },
    getAccessSecret(),
    { expiresIn: process.env.JWT_ACCESS_EXPIRE || '7d' }
  );
};

export const generateRefreshToken = (user) => {
  return jwt.sign(
    { id: user._id },
    getRefreshSecret(),
    { expiresIn: process.env.JWT_REFRESH_EXPIRE || '7d' }
  );
};

export const verifyAccessToken = (token) => {
  try {
    return jwt.verify(token, getAccessSecret());
  } catch (error) {
    return null;
  }
};

export const verifyRefreshToken = (token) => {
  try {
    return jwt.verify(token, getRefreshSecret());
  } catch (error) {
    return null;
  }
};
