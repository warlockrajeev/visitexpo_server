/**
 * @file authRoutes.js
 * @description Production Authentication endpoints with cross-site HttpOnly cookie support.
 */

import express from 'express';
import User from '../models/User.js';
import AuthService from '../services/AuthService.js';
import { protect } from '../middlewares/auth.js';
import { authLimiter } from '../middlewares/rateLimiter.js';

const router = express.Router();

// Helper to set refresh token cookie
const setRefreshTokenCookie = (res, token) => {
  const isProduction = process.env.NODE_ENV === 'production' || process.env.RENDER === 'true';
  
  res.cookie('refreshToken', token, {
    httpOnly: true,
    secure: isProduction, // Requires HTTPS in production (Vercel & Render)
    sameSite: isProduction ? 'none' : 'lax', // 'none' required for cross-domain cookie sharing (vercel.app -> onrender.com)
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
  });
};

router.post('/signup', authLimiter, async (req, res, next) => {
  try {
    const { name, email, password, organizationName } = req.body;
    
    if (!name || !email || !password) {
      return res.status(400).json({ success: false, error: 'Name, email, and password are required' });
    }

    const data = await AuthService.signup(name, email, password, organizationName);
    
    // Set refresh token cookie
    setRefreshTokenCookie(res, data.refreshToken);

    res.status(201).json({
      success: true,
      message: 'Registration successful',
      accessToken: data.accessToken,
      user: data.user
    });
  } catch (error) {
    next(error);
  }
});

router.post('/login', authLimiter, async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Email and password are required' });
    }

    const data = await AuthService.login(email, password);

    // Set refresh token cookie
    setRefreshTokenCookie(res, data.refreshToken);

    res.status(200).json({
      success: true,
      message: 'Login successful',
      accessToken: data.accessToken,
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
    setRefreshTokenCookie(res, data.refreshToken);

    res.status(200).json({
      success: true,
      accessToken: data.accessToken
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

    const isProduction = process.env.NODE_ENV === 'production' || process.env.RENDER === 'true';
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
    const userDoc = await User.findById(req.user.id).select('-password');
    if (!userDoc) {
      return res.status(404).json({ success: false, error: 'User profile not found' });
    }

    res.status(200).json({
      success: true,
      user: {
        id: userDoc._id,
        name: userDoc.name,
        email: userDoc.email,
        role: userDoc.role,
        isVerified: userDoc.isVerified,
        organization: userDoc.organization
      }
    });
  } catch (error) {
    next(error);
  }
});

export default router;
