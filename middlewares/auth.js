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
      adminRole: decoded.adminRole || '',
      permissions: decoded.permissions || [],
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
    if (!req.user) {
      const err = new Error('Access denied. Authentication required.');
      err.statusCode = 401;
      return next(err);
    }

    const userRole = req.user.role;
    // Seamlessly match both 'sub_admin' and 'subadmin', and include 'admin' / 'super_admin'
    const isAuthorized = roles.some(role => {
      if (role === userRole) return true;
      if ((role === 'sub_admin' || role === 'subadmin') && (userRole === 'sub_admin' || userRole === 'subadmin')) return true;
      if (role === 'admin' && (userRole === 'super_admin' || userRole === 'sub_admin' || userRole === 'subadmin' || userRole === 'admin')) return true;
      return false;
    });

    if (!isAuthorized) {
      const err = new Error(`User role '${req.user?.role || 'anonymous'}' is not authorized to access this resource.`);
      err.statusCode = 403;
      return next(err);
    }
    next();
  };
};

// Granular permission check for admin / subadmin operations
export const requirePermission = (permission) => {
  return (req, res, next) => {
    if (!req.user) {
      const err = new Error('Access denied. Authentication required.');
      err.statusCode = 401;
      return next(err);
    }

    // Super admin has full unconstrained access
    if (req.user.role === 'super_admin') {
      return next();
    }

    // Subadmin or admin with granular permissions
    if (req.user.role === 'sub_admin' || req.user.role === 'admin') {
      const userPerms = Array.isArray(req.user.permissions) ? req.user.permissions : [];
      if (userPerms.includes('*') || userPerms.includes(permission)) {
        return next();
      }
    }

    const err = new Error(`Access forbidden. Missing required permission: '${permission}'`);
    err.statusCode = 403;
    return next(err);
  };
};
