/**
 * @file engagementRoutes.js
 * @description Express routes for Event Interest & Followers system.
 */

import express from 'express';
import {
  toggleEngagement,
  getEventEngagements,
  getUserEngagements,
  getOrganizerEngagements,
  getAllEngagements
} from '../controllers/engagementController.js';
import { verifyAccessToken } from '../utils/jwt.js';

const router = express.Router();

// Optional JWT authentication middleware: extracts req.user if Bearer token is provided
const optionalAuth = (req, res, next) => {
  let token;
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  } else if (req.cookies && req.cookies.token) {
    token = req.cookies.token;
  }

  if (token) {
    try {
      const decoded = verifyAccessToken(token);
      if (decoded) {
        req.user = {
          id: decoded.id,
          _id: decoded.id,
          email: decoded.email,
          role: decoded.role,
          organization: decoded.organization
        };
      }
    } catch (_) {}
  }
  next();
};

// Toggle interested or follower
router.post('/toggle', optionalAuth, toggleEngagement);

// Get real attendees & followers for a specific event
router.get('/event/:slug', optionalAuth, getEventEngagements);

// Get all events a user has shown interest in or followed
router.get('/user/:userIdOrEmail', optionalAuth, getUserEngagements);

// Get all engagements for an organizer's events
router.get('/organizer/:orgIdOrUserId', optionalAuth, getOrganizerEngagements);

// Super admin platform-wide directory
router.get('/all', optionalAuth, getAllEngagements);

export default router;
