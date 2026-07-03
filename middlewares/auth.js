/**
 * @file auth.js
 * @description JWT authentication and RBAC authorization middlewares.
 */

import { verifyAccessToken } from '../utils/jwt.js';

export const protect = async (req, res, next) => {
  let token;

  // 1. Check for token in Authorization Header (Bearer Token)
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  } 
  // 2. Check for token in cookies
  else if (req.cookies && req.cookies.token) {
    token = req.cookies.token;
  }

  // Verify token exists
  if (!token) {
    const err = new Error('Access denied. No authentication token provided.');
    err.statusCode = 401;
    return next(err);
  }

  try {
    // Verify token
    const decoded = verifyAccessToken(token);
    if (!decoded) {
      const err = new Error('Session expired or invalid token. Please log in again.');
      err.statusCode = 401;
      return next(err);
    }

    // Set user info on request
    req.user = {
      id: decoded.id,
      email: decoded.email,
      role: decoded.role,
      organization: decoded.organization
    };

    next();
  } catch (error) {
    const err = new Error('Authentication failed');
    err.statusCode = 401;
    return next(err);
  }
};

// Role authorization check
export const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      const err = new Error(`User role '${req.user?.role || 'anonymous'}' is not authorized to access this resource.`);
      err.statusCode = 403;
      return next(err);
    }
    next();
  };
};
