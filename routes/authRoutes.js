/**
 * @file authRoutes.js
 * @description Production Authentication endpoints with cross-site HttpOnly cookie support.
 */

import express from 'express';
import bcrypt from 'bcryptjs';
import User from '../models/User.js';
import Organization from '../models/Organization.js';
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
    const userDoc = await User.findById(req.user.id).select('-password').populate('organization');
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

// Update Organization / Brand Profile
router.put('/organization', protect, async (req, res, next) => {
  try {
    const userDoc = await User.findById(req.user.id);
    if (!userDoc) return res.status(404).json({ success: false, error: 'User not found' });

    let org;
    if (userDoc.organization) {
      org = await Organization.findById(userDoc.organization);
    }

    if (!org) {
      org = new Organization({
        name: req.body.name || `${userDoc.name}'s Organization`,
        teamMembers: [{ user: userDoc._id, role: userDoc.role || 'organizer' }]
      });
      userDoc.organization = org._id;
      await userDoc.save();
    }

    const { name, logo, website, phone, email, address, gst, description, socialLinkedIn, socialFacebook, socialInstagram, socialX } = req.body;

    if (name) org.name = name;
    if (logo !== undefined) org.logo = logo;
    if (website !== undefined) org.website = website;
    if (gst !== undefined) org.gst = gst;
    if (description !== undefined) org.description = description;
    if (phone !== undefined || email !== undefined) {
      org.contact = {
        ...org.contact,
        phone: phone !== undefined ? phone : org.contact?.phone,
        email: email !== undefined ? email : org.contact?.email
      };
    }
    if (address !== undefined) {
      if (typeof address === 'string') {
        org.address = { ...org.address, street: address };
      } else if (typeof address === 'object') {
        org.address = { ...org.address, ...address };
      }
    }
    if (socialLinkedIn !== undefined || socialFacebook !== undefined || socialInstagram !== undefined || socialX !== undefined) {
      org.social = {
        linkedIn: socialLinkedIn || '',
        facebook: socialFacebook || '',
        instagram: socialInstagram || '',
        x: socialX || ''
      };
    }

    await org.save();

    const updatedUser = await User.findById(userDoc._id).select('-password').populate('organization');

    res.status(200).json({
      success: true,
      message: 'Organizer profile updated successfully',
      organization: org,
      user: {
        id: updatedUser._id,
        name: updatedUser.name,
        email: updatedUser.email,
        role: updatedUser.role,
        isVerified: updatedUser.isVerified,
        organization: updatedUser.organization
      }
    });
  } catch (error) {
    next(error);
  }
});

// Update Account Profile details (name, email)
router.put('/profile', protect, async (req, res, next) => {
  try {
    const { name, email } = req.body;
    const userDoc = await User.findById(req.user.id);
    if (!userDoc) {
      return res.status(404).json({ success: false, error: 'User account not found' });
    }

    if (name) userDoc.name = name;
    if (email && email.toLowerCase() !== userDoc.email.toLowerCase()) {
      const existingUser = await User.findOne({ email: email.toLowerCase() });
      if (existingUser && existingUser._id.toString() !== userDoc._id.toString()) {
        return res.status(400).json({ success: false, error: 'Email address is already in use' });
      }
      userDoc.email = email.toLowerCase();
    }

    await userDoc.save();

    const updatedUser = await User.findById(userDoc._id).select('-password').populate('organization');

    res.status(200).json({
      success: true,
      message: 'Account details updated successfully!',
      user: {
        id: updatedUser._id,
        name: updatedUser.name,
        email: updatedUser.email,
        role: updatedUser.role,
        isVerified: updatedUser.isVerified,
        organization: updatedUser.organization
      }
    });
  } catch (error) {
    next(error);
  }
});

// Update Security & Password Credentials
router.put('/change-password', protect, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ success: false, error: 'Current password and new password are required' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ success: false, error: 'New password must be at least 6 characters long' });
    }

    const userDoc = await User.findById(req.user.id).select('+password');
    if (!userDoc) {
      return res.status(404).json({ success: false, error: 'User account not found' });
    }

    const isMatch = await bcrypt.compare(currentPassword, userDoc.password);
    if (!isMatch) {
      return res.status(400).json({ success: false, error: 'Current password does not match' });
    }

    userDoc.password = newPassword;
    await userDoc.save();

    res.status(200).json({
      success: true,
      message: 'Password changed successfully!'
    });
  } catch (error) {
    next(error);
  }
});

export default router;
