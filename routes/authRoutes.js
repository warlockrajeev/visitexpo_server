/**
 * @file authRoutes.js
 * @description Production Authentication endpoints with cross-site HttpOnly cookie support.
 */

import express from 'express';
import bcrypt from 'bcryptjs';
import User from '../models/User.js';
import Organization from '../models/Organization.js';
import AuthService from '../services/AuthService.js';
import TwoFactorService from '../services/twoFactorService.js';
import { protect } from '../middlewares/auth.js';
import { authLimiter } from '../middlewares/rateLimiter.js';

const router = express.Router();

// Helper to set refresh token cookie with environment & protocol detection
const setRefreshTokenCookie = (res, token, req) => {
  const origin = req?.get('origin') || '';
  const host = req?.get('host') || '';
  const isLocalhost = host.includes('localhost') || host.includes('127.0.0.1') || origin.includes('localhost') || origin.includes('127.0.0.1');
  const isProduction = !isLocalhost && (process.env.NODE_ENV === 'production' || process.env.RENDER === 'true');
  
  res.cookie('refreshToken', token, {
    httpOnly: true,
    secure: isProduction, // False on localhost HTTP so browser never rejects cookie; True on production HTTPS
    sameSite: isProduction ? 'none' : 'lax', // 'none' for cross-domain production, 'lax' for local development
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
  });
};

// ============================================================================
// MOBILE OTP VERIFICATION ENDPOINTS (2Factor.in)
// ============================================================================

router.post('/otp/send', authLimiter, async (req, res, next) => {
  try {
    const { phone } = req.body;
    if (!phone) {
      return res.status(400).json({ success: false, error: 'Mobile number is required' });
    }

    const result = await TwoFactorService.sendOtp(phone);
    if (!result.success) {
      return res.status(400).json(result);
    }

    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
});

router.post('/otp/verify', authLimiter, async (req, res, next) => {
  try {
    const { sessionId, otp, phone } = req.body;
    if (!sessionId || !otp) {
      return res.status(400).json({ success: false, error: 'Session ID and OTP code are required' });
    }

    const result = await TwoFactorService.verifyOtp(sessionId, otp, phone);
    if (!result.success) {
      return res.status(400).json(result);
    }

    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
});

router.post('/signup', authLimiter, async (req, res, next) => {
  try {
    const { name, email, password, organizationName, role, phone, city, phoneVerificationToken, otpSessionId, otp } = req.body;
    
    if (!name || !email || !password) {
      return res.status(400).json({ success: false, error: 'Name, email, and password are required' });
    }

    const data = await AuthService.signup(name, email, password, organizationName, role, phone, city, phoneVerificationToken, otpSessionId, otp);
    
    // Set refresh token cookie
    setRefreshTokenCookie(res, data.refreshToken, req);

    res.status(201).json({
      success: true,
      message: 'Registration successful',
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      user: data.user
    });
  } catch (error) {
    next(error);
  }
});

router.post('/login', authLimiter, async (req, res, next) => {
  try {
    const { email, password, role } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Email and password are required' });
    }

    const data = await AuthService.login(email, password, role);

    // Set refresh token cookie
    setRefreshTokenCookie(res, data.refreshToken, req);

    res.status(200).json({
      success: true,
      message: 'Login successful',
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      user: data.user
    });
  } catch (error) {
    next(error);
  }
});

// Check if user exists and whether they have completed organizer/exhibitor profile
router.post('/google/check', authLimiter, async (req, res, next) => {
  try {
    const { email, role } = req.body;
    if (!email) {
      return res.status(400).json({ success: false, error: 'Google email is required' });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const user = await User.findOne({ email: normalizedEmail }).populate('organization');
    if (!user) {
      return res.status(200).json({ success: true, exists: false, hasDetails: false });
    }

    // Role mismatch check for Google pre-check
    const assignedRole = role === 'visitor' ? 'visitor' : role === 'exhibitor' ? 'exhibitor' : 'organizer';
    const existingRole = user.role || 'organizer';

    if (role && existingRole !== assignedRole) {
      const getRoleLabel = (r) => {
        if (!r) return 'User';
        const str = r.toLowerCase();
        if (str === 'organizer') return 'Organizer';
        if (str === 'exhibitor') return 'Exhibitor';
        if (str === 'visitor') return 'Visitor';
        if (str === 'super_admin' || str === 'admin') return 'Administrator';
        return r.charAt(0).toUpperCase() + r.slice(1);
      };
      const existingLabel = getRoleLabel(existingRole);
      return res.status(409).json({
        success: false,
        error: `This Google account (${normalizedEmail}) is already registered as an ${existingLabel}. Please switch to the ${existingLabel} tab to sign in.`,
        registeredRole: existingRole,
        exists: true
      });
    }

    // A user has complete details if:
    // - Has phone registered and verified (mandatory for all roles)
    // - For visitor: has verified phone
    // - For organizer: has verified phone and an explicit organization
    // - For exhibitor: has verified phone and company/organization set
    const hasOrg = !!(user.organization && user.organization.name && !user.organization.name.includes("'s Organization"));
    const hasPhone = !!user.phone && user.isPhoneVerified !== false;
    const hasDetails = user.role === 'visitor' ? hasPhone : (hasPhone && (hasOrg || !!user.company));

    return res.status(200).json({
      success: true,
      exists: true,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        hasDetails,
        organizationName: user.organization?.name || user.company || '',
        phone: user.phone || user.organization?.contact?.phone || '',
        city: user.city || user.organization?.address?.city || ''
      }
    });
  } catch (error) {
    next(error);
  }
});

router.post('/google', authLimiter, async (req, res, next) => {
  try {
    const {
      email,
      name,
      photoURL,
      uid,
      idToken,
      role,
      organizationName,
      phone,
      city,
      website,
      company,
      designation,
      industry,
      phoneVerificationToken,
      otpSessionId,
      otp
    } = req.body;

    if (!email) {
      return res.status(400).json({ success: false, error: 'Google email is required' });
    }

    const data = await AuthService.googleAuth({
      email,
      name,
      photoURL,
      uid,
      idToken,
      role,
      organizationName,
      phone,
      city,
      website,
      company,
      designation,
      industry,
      phoneVerificationToken,
      otpSessionId,
      otp
    });

    // Set refresh token cookie
    setRefreshTokenCookie(res, data.refreshToken, req);

    res.status(200).json({
      success: true,
      message: 'Google login successful',
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
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
    setRefreshTokenCookie(res, data.refreshToken, req);

    res.status(200).json({
      success: true,
      accessToken: data.accessToken,
      refreshToken: data.refreshToken
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

    const origin = req?.get('origin') || '';
    const host = req?.get('host') || '';
    const isLocalhost = host.includes('localhost') || host.includes('127.0.0.1') || origin.includes('localhost') || origin.includes('127.0.0.1');
    const isProduction = !isLocalhost && (process.env.NODE_ENV === 'production' || process.env.RENDER === 'true');
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
        phone: userDoc.phone || '',
        company: userDoc.company || '',
        designation: userDoc.designation || '',
        city: userDoc.city || '',
        role: userDoc.role,
        isVerified: userDoc.isVerified,
        credits: userDoc.credits !== undefined ? userDoc.credits : 100,
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

// Update Account Profile details (name, email, phone, company, designation, city)
router.put('/profile', protect, async (req, res, next) => {
  try {
    const { name, email, phone, company, designation, city } = req.body;
    const userDoc = await User.findById(req.user.id);
    if (!userDoc) {
      return res.status(404).json({ success: false, error: 'User account not found' });
    }

    if (name) userDoc.name = name;
    if (phone !== undefined) userDoc.phone = phone;
    if (company !== undefined) userDoc.company = company;
    if (designation !== undefined) userDoc.designation = designation;
    if (city !== undefined) userDoc.city = city;

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
        phone: updatedUser.phone || '',
        company: updatedUser.company || '',
        designation: updatedUser.designation || '',
        city: updatedUser.city || '',
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
